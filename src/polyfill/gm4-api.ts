/**
 * GM4 Promise-Based API Implementation (Browser-Side)
 *
 * Wraps the classic synchronous GM_* functions in Promise-returning
 * equivalents under the `GM` namespace, matching the Greasemonkey 4+
 * (GM4) API specification.
 *
 * @see https://wiki.greasespot.net/Greasemonkey_Manual:API
 */

import type { GMApi, GMInfoObject, GMNotificationDetails } from './gm-api.js';
import type { GMXHRDetails, GMXHRResponse } from './xhr.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** The GM4 Promise-based API surface */
export interface GM4Api {
  /** Script info object (same as GM_info) */
  info: GMInfoObject;
  /** Async version of GM_getValue */
  getValue: (key: string, defaultValue?: unknown) => Promise<unknown>;
  /** Async version of GM_setValue */
  setValue: (key: string, value: unknown) => Promise<void>;
  /** Async version of GM_deleteValue */
  deleteValue: (key: string) => Promise<void>;
  /** Async version of GM_listValues */
  listValues: () => Promise<string[]>;
  /** Promise-based xmlHttpRequest -- resolves on load, rejects on error */
  xmlHttpRequest: (details: GMXHRDetails) => Promise<GMXHRResponse>;
  /** Async version of GM_notification */
  notification: (details: GMNotificationDetails | string) => Promise<void>;
  /** Async version of GM_setClipboard */
  setClipboard: (text: string) => Promise<void>;
  /** Async version of GM_getResourceURL (note: lowercase 'url' in GM4 spec) */
  getResourceUrl: (name: string) => Promise<string>;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Creates a GM4 (Promise-based) API wrapper around the classic GM_* API.
 *
 * All methods return Promises that resolve with the result of the
 * corresponding synchronous GM_* call. `xmlHttpRequest` is special:
 * it returns a Promise that resolves with the response on success
 * and rejects on error or timeout.
 *
 * @param gmApi - The classic GM_* API instance from {@link createGMApi}
 * @returns The GM4-style `GM` object with Promise-based methods
 */
export function createGM4Api(gmApi: GMApi): GM4Api {
  return {
    /** Script info -- identical to GM_info */
    info: gmApi.GM_info,

    /**
     * Retrieve a value from script-scoped storage.
     * @param key - Storage key
     * @param defaultValue - Returned if the key does not exist
     */
    getValue(key: string, defaultValue?: unknown): Promise<unknown> {
      return Promise.resolve(gmApi.GM_getValue(key, defaultValue));
    },

    /**
     * Store a value in script-scoped storage.
     * @param key - Storage key
     * @param value - Value to store
     */
    setValue(key: string, value: unknown): Promise<void> {
      gmApi.GM_setValue(key, value);
      return Promise.resolve();
    },

    /**
     * Remove a value from script-scoped storage.
     * @param key - Storage key to delete
     */
    deleteValue(key: string): Promise<void> {
      gmApi.GM_deleteValue(key);
      return Promise.resolve();
    },

    /**
     * List all keys in script-scoped storage.
     */
    listValues(): Promise<string[]> {
      return Promise.resolve(gmApi.GM_listValues());
    },

    /**
     * Perform a cross-origin HTTP request.
     * Resolves with the response on success; rejects on error or timeout.
     *
     * @param details - Request configuration (onload/onerror callbacks are
     *                  overridden internally to drive the Promise)
     */
    xmlHttpRequest(details: GMXHRDetails): Promise<GMXHRResponse> {
      return new Promise<GMXHRResponse>((resolve, reject) => {
        gmApi.GM_xmlhttpRequest({
          ...details,
          onload(response: GMXHRResponse) {
            // Also call the user's onload if they provided one
            if (details.onload) details.onload(response);
            resolve(response);
          },
          onerror(response: GMXHRResponse) {
            if (details.onerror) details.onerror(response);
            reject(response);
          },
          ontimeout(response: GMXHRResponse) {
            if (details.ontimeout) details.ontimeout(response);
            reject(response);
          },
        });
      });
    },

    /**
     * Display a notification.
     * @param details - Notification details or a simple string message
     */
    notification(details: GMNotificationDetails | string): Promise<void> {
      gmApi.GM_notification(details);
      return Promise.resolve();
    },

    /**
     * Copy text to the clipboard.
     * @param text - Text to copy
     */
    setClipboard(text: string): Promise<void> {
      gmApi.GM_setClipboard(text);
      return Promise.resolve();
    },

    /**
     * Get a URL for a pre-loaded @resource.
     * Note: GM4 uses lowercase 'url' (`getResourceUrl`) unlike GM_getResourceURL.
     * @param name - Resource name
     */
    getResourceUrl(name: string): Promise<string> {
      return Promise.resolve(gmApi.GM_getResourceURL(name));
    },
  };
}
