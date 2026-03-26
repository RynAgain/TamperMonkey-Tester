/**
 * Classic GM_* API Implementation (Browser-Side)
 *
 * Provides the traditional TamperMonkey/Greasemonkey synchronous API surface.
 * Each script receives its own scoped instance created by {@link createGMApi}
 * to prevent cross-script pollution.
 *
 * This module is browser-only -- it uses DOM APIs and will be bundled
 * by esbuild for injection into proxied pages.
 */

import type { GMStorage } from './storage.js';
import type { GMXHRDetails, GMXHRAbortHandle } from './xhr.js';
import { createGMXmlHttpRequest } from './xhr.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Minimal script metadata needed by the polyfill layer */
export interface ScriptMetadataLite {
  /** Script display name from @name */
  name: string;
  /** Script version from @version */
  version: string;
  /** Named resources from @resource (name -> URL or data) */
  resource: Record<string, string>;
  /** Allowed XHR domains from @connect */
  connect: string[];
  /** Requested API permissions from @grant */
  grant: string[];
}

/** GM_info object shape exposed to userscripts */
export interface GMInfoObject {
  script: {
    name: string;
    version: string;
    description: string;
  };
  scriptHandler: string;
  version: string;
}

/** Menu command entry stored in the local registry */
interface MenuCommandEntry {
  caption: string;
  commandFunc: () => void;
  accessKey?: string;
}

/** Return type of {@link createGMApi} -- the full GM_* API surface */
export interface GMApi {
  GM_info: GMInfoObject;
  GM_getValue: (key: string, defaultValue?: unknown) => unknown;
  GM_setValue: (key: string, value: unknown) => void;
  GM_deleteValue: (key: string) => void;
  GM_listValues: () => string[];
  GM_xmlhttpRequest: (details: GMXHRDetails) => GMXHRAbortHandle;
  GM_addStyle: (css: string) => HTMLStyleElement;
  GM_notification: (details: GMNotificationDetails | string) => void;
  GM_setClipboard: (text: string, type?: string) => void;
  GM_getResourceText: (name: string) => string;
  GM_getResourceURL: (name: string) => string;
  GM_registerMenuCommand: (caption: string, commandFunc: () => void, accessKey?: string) => void;
  GM_unregisterMenuCommand: (caption: string) => void;
  GM_openInTab: (url: string, options?: GMOpenInTabOptions) => { close: () => void };
  GM_log: (...args: unknown[]) => void;
  unsafeWindow: typeof globalThis;
}

/** Options for GM_notification */
export interface GMNotificationDetails {
  text: string;
  title?: string;
  image?: string;
  onclick?: () => void;
  ondone?: () => void;
}

/** Options for GM_openInTab */
export interface GMOpenInTabOptions {
  active?: boolean;
  insert?: boolean;
  setParent?: boolean;
}

// ---------------------------------------------------------------------------
// WebSocket helper
// ---------------------------------------------------------------------------

/** Lazily-initialized shared WebSocket connection for log streaming */
let _ws: WebSocket | null = null;
let _wsConnecting = false;
const _wsQueue: string[] = [];

/**
 * Returns the shared WebSocket connection, creating it if needed.
 * Messages queued during connection are flushed once open.
 */
function _getWs(): WebSocket | null {
  if (_ws && _ws.readyState === WebSocket.OPEN) return _ws;

  if (!_wsConnecting) {
    _wsConnecting = true;
    try {
      const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
      _ws = new WebSocket(`${protocol}//${location.host}/__tmdev__/ws`);

      _ws.addEventListener('open', () => {
        // Flush queued messages
        while (_wsQueue.length > 0) {
          const msg = _wsQueue.shift();
          if (msg && _ws) _ws.send(msg);
        }
      });

      _ws.addEventListener('close', () => {
        _ws = null;
        _wsConnecting = false;
      });

      _ws.addEventListener('error', () => {
        _ws = null;
        _wsConnecting = false;
      });
    } catch {
      _wsConnecting = false;
      return null;
    }
  }

  return _ws;
}

/**
 * Sends a JSON message via WebSocket. If the connection is not yet open,
 * the message is queued and flushed when connected.
 */
function _wsSend(data: Record<string, unknown>): void {
  const msg = JSON.stringify(data);
  const ws = _getWs();

  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(msg);
  } else {
    _wsQueue.push(msg);
    // Ensure connection attempt is initiated
    _getWs();
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Creates a complete GM_* API instance scoped to a specific script.
 *
 * @param scriptId - Unique identifier for the script
 * @param metadata - Lite metadata object with name, version, resource, connect, grant
 * @param storage - Storage instance created by {@link createGMStorage}
 * @returns An object containing all GM_* functions and properties
 */
export function createGMApi(
  scriptId: string,
  metadata: ScriptMetadataLite,
  storage: GMStorage,
): GMApi {
  // -- Internal state -------------------------------------------------------

  /** Local registry of menu commands for this script */
  const menuCommands = new Map<string, MenuCommandEntry>();

  /** GM_xmlhttpRequest bound to this script's connect domains */
  const gmXhr = createGMXmlHttpRequest(scriptId, metadata.connect);

  // -- API implementation ---------------------------------------------------

  /** Static GM_info object */
  const GM_info: GMInfoObject = {
    script: {
      name: metadata.name,
      version: metadata.version,
      description: '',
    },
    scriptHandler: 'TMDev',
    version: '0.1.0',
  };

  /**
   * Retrieve a value from script-scoped storage.
   * @param key - Storage key
   * @param defaultValue - Returned if the key does not exist
   */
  function GM_getValue(key: string, defaultValue?: unknown): unknown {
    return storage.getValue(key, defaultValue);
  }

  /**
   * Store a value in script-scoped storage.
   * @param key - Storage key
   * @param value - Value to store (must be JSON-serializable)
   */
  function GM_setValue(key: string, value: unknown): void {
    storage.setValue(key, value);
  }

  /**
   * Remove a value from script-scoped storage.
   * @param key - Storage key to delete
   */
  function GM_deleteValue(key: string): void {
    storage.deleteValue(key);
  }

  /**
   * List all keys in script-scoped storage.
   * @returns Array of key names
   */
  function GM_listValues(): string[] {
    return storage.listValues();
  }

  /**
   * Perform a cross-origin HTTP request via the dev server relay.
   * @param details - Request configuration
   * @returns Handle with abort() method
   */
  function GM_xmlhttpRequest(details: GMXHRDetails): GMXHRAbortHandle {
    return gmXhr(details);
  }

  /**
   * Inject a CSS stylesheet into the page.
   * @param css - CSS text to inject
   * @returns The created <style> element
   */
  function GM_addStyle(css: string): HTMLStyleElement {
    const style = document.createElement('style');
    style.textContent = css;
    style.setAttribute('data-tmdev-script', scriptId);
    document.head.appendChild(style);
    return style;
  }

  /**
   * Display a notification. Uses the browser Notification API if available,
   * otherwise falls back to console.log.
   * @param details - Notification details or a simple string message
   */
  function GM_notification(details: GMNotificationDetails | string): void {
    const opts: GMNotificationDetails =
      typeof details === 'string' ? { text: details } : details;

    if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
      const n = new Notification(opts.title || metadata.name, {
        body: opts.text,
        icon: opts.image,
      });
      if (opts.onclick) n.addEventListener('click', opts.onclick);
      if (opts.ondone) n.addEventListener('close', opts.ondone);
    } else if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
      // Request permission, then try again
      Notification.requestPermission()
        .then((perm) => {
          if (perm === 'granted') {
            GM_notification(opts);
          } else {
            console.log(`[TMDev Notification] ${opts.title || metadata.name}: ${opts.text}`);
          }
        })
        .catch(() => {
          console.log(`[TMDev Notification] ${opts.title || metadata.name}: ${opts.text}`);
        });
    } else {
      console.log(`[TMDev Notification] ${opts.title || metadata.name}: ${opts.text}`);
    }
  }

  /**
   * Copy text to the clipboard (fire-and-forget).
   * @param text - Text to copy
   * @param _type - MIME type hint (ignored; writeText always uses text/plain)
   */
  function GM_setClipboard(text: string, _type?: string): void {
    navigator.clipboard.writeText(text).catch(() => {
      /* silently ignore clipboard failures */
    });
  }

  /**
   * Get the text content of a pre-loaded @resource.
   * @param name - Resource name as declared in metadata
   * @returns The resource text, or empty string if not found
   */
  function GM_getResourceText(name: string): string {
    return metadata.resource[name] ?? '';
  }

  /**
   * Get a URL for a pre-loaded @resource.
   * Returns the original URL from metadata. In a full implementation
   * this would return a blob: URL of the pre-fetched content.
   * @param name - Resource name as declared in metadata
   * @returns The resource URL, or empty string if not found
   */
  function GM_getResourceURL(name: string): string {
    return metadata.resource[name] ?? '';
  }

  /**
   * Register a menu command that appears in the dashboard.
   * The command is stored locally and reported to the dev server via WebSocket.
   * @param caption - Display label for the command
   * @param commandFunc - Function to invoke when the command is triggered
   * @param accessKey - Optional keyboard shortcut character
   */
  function GM_registerMenuCommand(
    caption: string,
    commandFunc: () => void,
    accessKey?: string,
  ): void {
    menuCommands.set(caption, { caption, commandFunc, accessKey });
    console.log(`[TMDev] Registered menu command: "${caption}"`);

    _wsSend({
      type: 'menu:register',
      scriptId,
      caption,
      accessKey: accessKey ?? null,
    });
  }

  /**
   * Unregister a previously registered menu command.
   * @param caption - The caption of the command to remove
   */
  function GM_unregisterMenuCommand(caption: string): void {
    menuCommands.delete(caption);
    console.log(`[TMDev] Unregistered menu command: "${caption}"`);

    _wsSend({
      type: 'menu:unregister',
      scriptId,
      caption,
    });
  }

  /**
   * Open a URL in a new browser tab.
   * @param url - URL to open
   * @param _options - Tab options (active, insert, setParent) -- best-effort
   * @returns An object with a close() method to close the opened tab
   */
  function GM_openInTab(
    url: string,
    _options?: GMOpenInTabOptions,
  ): { close: () => void } {
    const w = window.open(url, '_blank');
    return {
      close(): void {
        if (w && !w.closed) w.close();
      },
    };
  }

  /**
   * Log a message to the console and stream it to the dashboard via WebSocket.
   * @param args - Values to log
   */
  function GM_log(...args: unknown[]): void {
    console.log('[TMDev]', ...args);

    _wsSend({
      type: 'log',
      scriptId,
      level: 'log',
      message: args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' '),
      timestamp: Date.now(),
    });
  }

  // -- Return assembled API -------------------------------------------------

  return {
    GM_info,
    GM_getValue,
    GM_setValue,
    GM_deleteValue,
    GM_listValues,
    GM_xmlhttpRequest,
    GM_addStyle,
    GM_notification,
    GM_setClipboard,
    GM_getResourceText,
    GM_getResourceURL,
    GM_registerMenuCommand,
    GM_unregisterMenuCommand,
    GM_openInTab,
    GM_log,
    unsafeWindow: window,
  };
}
