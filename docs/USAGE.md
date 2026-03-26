# TMDev Usage Guide

A detailed walkthrough for using TMDev to develop and test TamperMonkey/Greasemonkey userscripts locally.

---

## Table of Contents

1. [Setup Walkthrough](#setup-walkthrough)
2. [Example Workflow](#example-workflow)
3. [Example Userscript](#example-userscript)
4. [Dashboard Features](#dashboard-features)
5. [Troubleshooting](#troubleshooting)

---

## Setup Walkthrough

### Step 1: Install Dependencies

Ensure you have Node.js 18+ installed, then install the project dependencies:

```bash
cd tampermonkey-tester
npm install
```

**Expected output:** npm installs all packages listed in [`package.json`](../package.json) including fastify, undici, htmlparser2, chokidar, commander, and dev dependencies (TypeScript, esbuild, vitest, eslint).

### Step 2: Build the Project

Compile the TypeScript source to JavaScript:

```bash
npm run build
```

This runs `tsc -p tsconfig.build.json` and outputs compiled files to the `dist/` directory. The CLI entry point is [`dist/cli/index.js`](../src/cli/index.ts).

### Step 3: Create a Scripts Directory

TMDev watches a directory for `.user.js` files. Create one if it does not exist:

```bash
mkdir scripts
```

By default, the server watches `./scripts`. You can specify a different path with the `--dir` flag.

### Step 4: Add Your First Userscript

Create a file ending in `.user.js` inside the scripts directory. The file must contain a valid `==UserScript==` metadata block:

```bash
# Example: scripts/hello.user.js
```

```javascript
// ==UserScript==
// @name        Hello World
// @namespace   http://localhost
// @version     1.0
// @description A simple test script
// @match       *://*/*
// @grant       GM_log
// @run-at      document-end
// ==/UserScript==

GM_log('Hello World script loaded!');
document.body.style.border = '3px solid #4CAF50';
```

The file watcher ([`FileWatcher`](../src/core/file-watcher.ts)) picks up any file matching the `*.user.js` glob pattern. The metadata parser ([`parseMetadata()`](../src/core/metadata-parser.ts:42)) extracts the `@match`, `@grant`, `@run-at`, and other directives.

### Step 5: Start the Server

```bash
# Using npm
npm start

# Or with options
npm start -- --port 8432 --dir ./scripts --verbose --open
```

**Expected terminal output:**

```
  [tmdev] TamperMonkey Dev Testing Service
  -----------------------------------------
  > Server:     http://127.0.0.1:8432
  > Dashboard:  http://127.0.0.1:8432/__tmdev__/
  > Scripts:    ./scripts
  > Verbose:    off
  -----------------------------------------

  [tmdev] Server listening on http://127.0.0.1:8432
  Press Ctrl+C to stop.
```

### Step 6: Open the Dashboard

Navigate to `http://localhost:8432/__tmdev__/` in your browser. You will see:

- The **TMDev header** with a connection status indicator (green dot = WebSocket connected)
- The **Proxy URL bar** at the top for entering target site URLs
- The **Scripts panel** on the left showing your discovered scripts
- The **Detail panel** on the right with Console, Storage, and Info tabs
- The **Status footer** showing script count and connection state

### Step 7: Test Against a Target Site

Enter a URL in the proxy bar (e.g., `example.com`) and click "Go", or navigate directly to:

```
http://localhost:8432/https://example.com
```

The server fetches `https://example.com`, strips CSP headers, rewrites relative URLs, and injects any scripts whose `@match` patterns match the target URL.

---

## Example Workflow

This section walks through a complete development cycle: creating a script, testing it, modifying it, and observing hot-reload.

### 1. Create the Script

Create `scripts/hn-enhancer.user.js`:

```javascript
// ==UserScript==
// @name        HN Enhancer
// @namespace   https://tmdev.local
// @version     1.0
// @description Highlights top stories on Hacker News
// @match       https://news.ycombinator.com/*
// @grant       GM_addStyle
// @grant       GM_getValue
// @grant       GM_setValue
// @grant       GM_log
// @run-at      document-end
// ==/UserScript==

GM_log('HN Enhancer loaded');

// Track visit count
const visits = GM_getValue('visitCount', 0);
GM_setValue('visitCount', visits + 1);
GM_log('Visit count: ' + (visits + 1));

// Add custom styles
GM_addStyle(`
  .titleline > a {
    font-size: 14px;
  }
  .titleline > a:visited {
    opacity: 0.6;
  }
  tr.athing:hover {
    background-color: #f6f6ef;
  }
`);
```

### 2. Start the Server

```bash
npm start -- --dir ./scripts --verbose
```

The file watcher detects `hn-enhancer.user.js`, parses its metadata, and registers it in the script registry. With `--verbose`, you will see log output confirming the script was discovered.

### 3. Open the Dashboard

Go to `http://localhost:8432/__tmdev__/`. The Scripts panel shows:

```
Scripts [1]
+----------------------------------------------+
| [*] HN Enhancer  v1.0                       |
|     https://news.ycombinator.com/*           |
+----------------------------------------------+
```

The `[*]` indicates the script is enabled. Click the toggle to enable/disable it. The toggle sends a `PATCH /__tmdev__/api/scripts/:id` request to the server.

### 4. Navigate to the Target Site

Enter `news.ycombinator.com` in the proxy URL bar and click Go, or open directly:

```
http://localhost:8432/https://news.ycombinator.com
```

**What happens behind the scenes:**

1. The catch-all route in [`src/server/index.ts`](../src/server/index.ts:188) receives the request
2. [`proxyRequest()`](../src/server/proxy-handler.ts:49) fetches `https://news.ycombinator.com` via undici
3. CSP and X-Frame-Options headers are stripped
4. Relative URLs (`href`, `src`, `action` attributes) are rewritten to absolute
5. [`InjectionEngine.getInjectionPayload()`](../src/server/injection-engine.ts:43) queries the registry -- `HN Enhancer` matches `https://news.ycombinator.com/*`
6. The polyfill bundle loader `<script>` is inserted after `<head>`
7. The script body is wrapped in an IIFE via [`createScriptWrapper()`](../src/polyfill/index.ts:161) with `GM_addStyle`, `GM_getValue`, `GM_setValue`, and `GM_log` destructured into local scope
8. Since `@run-at` is `document-end`, the wrapped script goes before `</body>`
9. The modified HTML is returned to the browser

You should see the Hacker News page with the enhanced font sizing and hover effects. The Console tab in the dashboard shows:

```
[log] HN Enhancer loaded
[log] Visit count: 1
```

### 5. Modify the Script (Hot Reload)

Edit `scripts/hn-enhancer.user.js` -- for example, add a score highlight:

```javascript
// Add this at the end of the script body:
document.querySelectorAll('.score').forEach(el => {
  const points = parseInt(el.textContent || '0');
  if (points > 100) {
    el.style.color = '#ff6600';
    el.style.fontWeight = 'bold';
  }
});
GM_log('Score highlighting applied');
```

Save the file. The file watcher detects the change and:

1. Re-parses the metadata
2. Updates the registry entry
3. Emits a `script-updated` event
4. Broadcasts a `script-change` WebSocket message to all connected dashboard clients

The dashboard Console tab shows:

```
[system] Script updated: HN Enhancer
```

Refresh the proxied page to see the changes take effect.

### 6. Inspect Storage

After visiting the proxied page, click the **Storage** tab in the dashboard. You will see:

```
HN Enhancer
  visitCount: 1
```

Each `GM_setValue` call writes to `localStorage` (prefixed with `__tmdev__{scriptId}__`) and syncs to the server via `PUT /__tmdev__/api/storage`. The dashboard reads the server-side mirror to display stored values.

---

## Example Userscript

The following is a complete example demonstrating multiple GM_* features. Save it as `scripts/multi-feature-demo.user.js`:

```javascript
// ==UserScript==
// @name        TMDev Multi-Feature Demo
// @namespace   https://tmdev.local
// @version     1.0
// @description Demonstrates GM_addStyle, GM_getValue, GM_setValue,
//              GM_xmlhttpRequest, GM_notification, GM_log, and
//              GM_registerMenuCommand
// @match       https://example.com/*
// @grant       GM_addStyle
// @grant       GM_getValue
// @grant       GM_setValue
// @grant       GM_xmlhttpRequest
// @grant       GM_notification
// @grant       GM_log
// @grant       GM_registerMenuCommand
// @grant       GM_setClipboard
// @connect     jsonplaceholder.typicode.com
// @run-at      document-end
// ==/UserScript==

// ---- Logging ----
GM_log('Multi-Feature Demo script started');

// ---- Persistent Storage ----
const runCount = GM_getValue('runCount', 0) + 1;
GM_setValue('runCount', runCount);
GM_log('This script has run ' + runCount + ' time(s)');

// ---- Custom Styles ----
GM_addStyle(`
  #tmdev-demo-panel {
    position: fixed;
    top: 10px;
    right: 10px;
    z-index: 99999;
    background: #1a1a2e;
    color: #e0e0e0;
    border: 1px solid #16213e;
    border-radius: 8px;
    padding: 16px;
    font-family: monospace;
    font-size: 13px;
    max-width: 320px;
    box-shadow: 0 4px 12px rgba(0,0,0,0.3);
  }
  #tmdev-demo-panel h3 {
    margin: 0 0 8px 0;
    color: #e94560;
    font-size: 14px;
  }
  #tmdev-demo-panel .stat {
    margin: 4px 0;
  }
  #tmdev-demo-panel .stat-label {
    color: #999;
  }
  #tmdev-demo-panel button {
    background: #0f3460;
    color: #e0e0e0;
    border: 1px solid #16213e;
    padding: 4px 12px;
    margin: 4px 4px 4px 0;
    border-radius: 4px;
    cursor: pointer;
    font-family: monospace;
    font-size: 12px;
  }
  #tmdev-demo-panel button:hover {
    background: #16213e;
  }
  #tmdev-demo-result {
    margin-top: 8px;
    padding: 8px;
    background: #0f3460;
    border-radius: 4px;
    white-space: pre-wrap;
    word-break: break-all;
    max-height: 150px;
    overflow-y: auto;
    display: none;
  }
`);

// ---- Build UI Panel ----
const panel = document.createElement('div');
panel.id = 'tmdev-demo-panel';
panel.innerHTML = `
  <h3>[TMDev] Multi-Feature Demo</h3>
  <div class="stat">
    <span class="stat-label">Run count:</span> ${runCount}
  </div>
  <div class="stat">
    <span class="stat-label">Page:</span> ${location.hostname}
  </div>
  <div style="margin-top: 8px;">
    <button id="tmdev-btn-fetch">Fetch API Data</button>
    <button id="tmdev-btn-notify">Notify</button>
    <button id="tmdev-btn-copy">Copy URL</button>
  </div>
  <div id="tmdev-demo-result"></div>
`;
document.body.appendChild(panel);

// ---- Cross-Origin XHR via GM_xmlhttpRequest ----
document.getElementById('tmdev-btn-fetch').addEventListener('click', () => {
  const resultEl = document.getElementById('tmdev-demo-result');
  resultEl.style.display = 'block';
  resultEl.textContent = 'Fetching...';

  GM_xmlhttpRequest({
    method: 'GET',
    url: 'https://jsonplaceholder.typicode.com/posts/1',
    responseType: 'json',
    onload(response) {
      GM_log('XHR response status: ' + response.status);
      const data = response.response;
      resultEl.textContent = JSON.stringify(data, null, 2);
    },
    onerror(response) {
      GM_log('XHR error: ' + response.statusText);
      resultEl.textContent = 'Error: ' + response.statusText;
    },
  });
});

// ---- Notifications ----
document.getElementById('tmdev-btn-notify').addEventListener('click', () => {
  GM_notification({
    title: 'TMDev Demo',
    text: 'This is a test notification from your userscript!',
    onclick() {
      GM_log('Notification clicked');
    },
  });
});

// ---- Clipboard ----
document.getElementById('tmdev-btn-copy').addEventListener('click', () => {
  GM_setClipboard(location.href);
  GM_log('Copied URL to clipboard: ' + location.href);
  const resultEl = document.getElementById('tmdev-demo-result');
  resultEl.style.display = 'block';
  resultEl.textContent = 'Copied: ' + location.href;
});

// ---- Menu Commands ----
GM_registerMenuCommand('Reset Run Count', () => {
  GM_setValue('runCount', 0);
  GM_log('Run count reset to 0');
  GM_notification('Run count has been reset.');
});

GM_registerMenuCommand('Show Script Info', () => {
  GM_log('Script: ' + GM_info.script.name + ' v' + GM_info.script.version);
  GM_log('Handler: ' + GM_info.scriptHandler + ' v' + GM_info.version);
});

GM_log('Multi-Feature Demo fully initialized');
```

### Running the Example

1. Save the file to `scripts/multi-feature-demo.user.js`
2. Start (or restart) the server: `npm start -- --dir ./scripts`
3. Open the dashboard: `http://localhost:8432/__tmdev__/`
4. Navigate to: `http://localhost:8432/https://example.com`
5. You will see a dark panel in the top-right corner of the page
6. Click "Fetch API Data" to test `GM_xmlhttpRequest` -- data is relayed through the server's XHR endpoint
7. Click "Notify" to test `GM_notification` -- browser notification or console fallback
8. Click "Copy URL" to test `GM_setClipboard`
9. Check the Console tab for `GM_log` output
10. Check the Storage tab to see `runCount` incrementing

### GM4 API Variant

The same script can use the Promise-based GM4 API by declaring `GM.*` grants:

```javascript
// ==UserScript==
// @name        GM4 API Demo
// @namespace   https://tmdev.local
// @version     1.0
// @match       https://example.com/*
// @grant       GM.getValue
// @grant       GM.setValue
// @grant       GM.xmlHttpRequest
// @run-at      document-end
// ==/UserScript==

(async () => {
  const count = await GM.getValue('count', 0);
  await GM.setValue('count', count + 1);
  console.log('GM4 visit count:', count + 1);

  try {
    const response = await GM.xmlHttpRequest({
      method: 'GET',
      url: 'https://jsonplaceholder.typicode.com/posts/1',
    });
    console.log('GM4 XHR status:', response.status);
    console.log('GM4 XHR body:', response.responseText.slice(0, 100));
  } catch (err) {
    console.error('GM4 XHR failed:', err);
  }
})();
```

The [`createGM4Api()`](../src/polyfill/gm4-api.ts:55) factory wraps each classic `GM_*` function in a Promise. `GM.xmlHttpRequest` is special: it returns a Promise that resolves with the full response on success and rejects on error or timeout.

---

## Dashboard Features

### Overview Layout

The dashboard ([`index.html`](../src/dashboard/index.html)) is a single-page application with this layout:

```
+-------------------------------------------------------------+
| [</>] TMDev  TamperMonkey Dev Tester      [*] Connected     |
+-------------------------------------------------------------+
| Proxy URL: [http://] [example.com/page          ] [Go]      |
+-------------------------------------------------------------+
|                          |                                   |
|  Scripts [2]             |  [Console] [Storage] [Info]       |
|                          |                                   |
|  +--------------------+  |  Console output:                  |
|  | [*] HN Enhancer    |  |  > HN Enhancer loaded             |
|  |     v1.0           |  |  > Visit count: 3                 |
|  |     hn.com/*       |  |  > Score highlighting applied     |
|  +--------------------+  |  > [system] Script updated: ...   |
|  | [*] Demo Script    |  |                                   |
|  |     v1.0           |  |                                   |
|  |     example.com/*  |  |                                   |
|  +--------------------+  |                                   |
|                          |                                   |
+-------------------------------------------------------------+
| [*] Connected  |  2 scripts  |  2 enabled                   |
+-------------------------------------------------------------+
```

### Connection Status Indicator

The header displays a colored dot and label showing the WebSocket connection state:

- **Green dot + "Connected"** -- WebSocket to `/__tmdev__/ws` is open; hot-reload events and log streaming are active
- **Red dot + "Disconnected"** -- WebSocket is closed; real-time features are unavailable (the dashboard will attempt to reconnect)

### Proxy URL Bar

The URL bar at the top of the dashboard lets you navigate to target sites through the proxy:

1. Enter a URL (e.g., `example.com/page` or `https://example.com/page`)
2. Click "Go" or press Enter
3. The dashboard constructs the proxy URL and navigates to it

The proxy URL bar prefixes `http://` to your input. Full URLs with `https://` are also accepted.

### Scripts Panel

The left panel lists all `.user.js` files discovered in the watched directory:

- **Script name and version** from `@name` and `@version` metadata
- **Match patterns** from `@match` showing which sites the script targets
- **Enable/disable toggle** -- click to toggle. Disabled scripts are not injected into proxied pages. The toggle calls `PATCH /__tmdev__/api/scripts/:id` with `{ "enabled": true/false }`
- **Script count badge** -- shows total number of discovered scripts

Scripts appear automatically when you add `.user.js` files to the watched directory. The file watcher sends WebSocket events that update the list in real time without page refresh.

### Console Tab

The Console tab displays a live log feed:

- **`GM_log()` output** -- messages logged by userscripts are sent to the server via WebSocket and displayed here
- **System events** -- script add/remove/update notifications from the file watcher
- **Log levels** -- each message includes a timestamp and the originating script's ID

Log messages flow through this path:
1. Userscript calls [`GM_log()`](../src/polyfill/gm-api.ts:372)
2. The polyfill calls `console.log()` locally and sends a `{ type: "log", ... }` message via WebSocket
3. The server broadcasts the message to all other connected WebSocket clients
4. The dashboard receives the message and appends it to the console output

### Storage Tab

The Storage tab provides a tree view of all `GM_getValue`/`GM_setValue` data:

- **Grouped by script** -- each script's storage is shown under its name
- **Key-value pairs** -- displays all keys and their JSON-serialized values
- **Real-time updates** -- when scripts write to storage, the browser-side polyfill ([`storage.ts`](../src/polyfill/storage.ts)) syncs writes to the server via `PUT /__tmdev__/api/storage`, and the dashboard can poll or receive updates

Storage is backed by `localStorage` in the browser, prefixed with `__tmdev__{scriptId}__` to isolate scripts from each other. The server maintains an in-memory mirror for dashboard access.

### Info Tab

The Info tab shows detailed metadata for the selected script:

- Script name, namespace, version, description, author
- Match and include patterns
- Granted API permissions
- Run-at timing
- Connect domains (for `GM_xmlhttpRequest`)
- File path on disk

### Status Footer

The bottom bar shows:

- **Connection dot** -- mirrors the header connection state
- **Status text** -- "Connected", "Disconnected", or "Initializing..."
- **Script statistics** -- total scripts discovered and how many are enabled

---

## Troubleshooting

### Page looks broken or fails to load

**Symptoms:** The proxied page renders incorrectly, shows broken images, missing styles, or fails entirely.

**Causes and solutions:**

- **Complex SPAs** -- single-page applications with client-side routing often break under proxying because their JavaScript expects the original origin. Try a simpler static site first to confirm TMDev is working.
- **Relative URL resolution** -- the proxy rewrites `href`, `src`, and `action` attributes to absolute URLs based on the target origin. If a site uses JavaScript-constructed URLs, those are not rewritten. Check the browser console for 404 errors on resource loads.
- **CSP still blocking** -- verify in the browser's developer tools Network tab that `Content-Security-Policy` headers are not present. The proxy strips them in [`proxy-handler.ts`](../src/server/proxy-handler.ts:30), but redirects or sub-frames may re-add them.
- **WebSocket / SSE connections** -- the proxy does not handle persistent connections (WebSocket, Server-Sent Events) from the target site. Sites that depend on these will lose real-time functionality.
- **Try the query-based URL form** -- if path-based proxying (`/https://example.com`) causes issues, try `/?url=https://example.com`.

### Scripts not loading

**Symptoms:** You visit a proxied page, but your userscript does not execute.

**Check these:**

1. **File name** -- the file must end in `.user.js`. The file watcher only monitors `*.user.js` glob patterns.
2. **File location** -- the file must be in the directory specified by `--dir` (default: `./scripts`).
3. **Metadata block** -- the file must contain a valid `// ==UserScript==` ... `// ==/UserScript==` block. Run the server with `--verbose` to see parser errors.
4. **`@match` patterns** -- verify your patterns match the target URL. Common issues:
   - Missing scheme: use `https://example.com/*`, not `example.com/*`
   - Missing wildcard: `https://example.com` does not match `https://example.com/page` -- use `https://example.com/*`
   - Use `*://` to match both HTTP and HTTPS
5. **Script is disabled** -- check the dashboard Scripts panel. If the toggle is off, the script is not injected.
6. **Browser console** -- open the browser's developer tools (F12) and check for JavaScript errors in the console. Look for `[TMDev]` or `[tmdev]` prefixed messages.

### GM_xmlhttpRequest not working

**Symptoms:** Cross-origin requests via `GM_xmlhttpRequest` fail or return errors.

**Check these:**

1. **`@connect` domains** -- ensure the target domain is listed in your script's `@connect` metadata. Example: `// @connect api.example.com`
2. **`@grant`** -- ensure `GM_xmlhttpRequest` is in your `@grant` list. Without it, the function is not available.
3. **Server logs** -- run with `--verbose` and check server output for XHR relay errors. The relay endpoint is `POST /__tmdev__/api/xhr`.
4. **Target URL** -- ensure the URL is a fully-qualified `https://` or `http://` URL.
5. **Timeout** -- the server imposes a maximum timeout of 60 seconds (capped from whatever `timeout` value you specify). Long requests may time out.
6. **Response format** -- if you set `responseType: 'json'` but the response is not valid JSON, the `response` field will contain the raw text string.

### Hot reload not working

**Symptoms:** You edit a `.user.js` file, but the dashboard does not show updates and the script is not re-injected.

**Check these:**

1. **File extension** -- only `*.user.js` files are watched. Files named `.js` or `.ts` without the `.user.js` suffix are ignored.
2. **Correct directory** -- the file must be in the `--dir` path. Check the server startup banner to confirm which directory is being watched.
3. **WebSocket connected** -- check the dashboard header for the connection indicator. If it shows "Disconnected", the browser is not receiving change events. Try refreshing the dashboard page.
4. **File system events** -- on some systems (network drives, Docker volumes), chokidar may not detect changes. Try saving the file again or restarting the server.
5. **Refresh the proxied page** -- hot-reload sends a notification to the dashboard, but the proxied page itself must be refreshed to pick up script changes. The dashboard receives the event; you need to reload the target page manually.

### Storage not persisting

**Symptoms:** `GM_getValue` returns the default value even after `GM_setValue` was called.

**Check these:**

1. **`@grant`** -- ensure both `GM_getValue` and `GM_setValue` are in your `@grant` list.
2. **Same script ID** -- storage is keyed by a deterministic hash of the script's file path. Renaming or moving the file changes the script ID and creates a new storage scope.
3. **Browser localStorage** -- open the browser's developer tools, go to Application > Local Storage > `http://localhost:8432`, and look for keys prefixed with `__tmdev__`. This confirms whether writes are happening.
4. **JSON serialization** -- values must be JSON-serializable. Functions, DOM elements, and circular structures cannot be stored. Non-serializable values will cause `JSON.stringify` to throw or produce `null`.

### Dashboard shows "Disconnected"

**Symptoms:** The connection indicator in the dashboard header shows a red dot and "Disconnected" label.

**Check these:**

1. **Server is running** -- ensure the TMDev server process is still running in your terminal.
2. **Correct port** -- if you started the server on a non-default port, ensure you are accessing the dashboard on that same port.
3. **Browser WebSocket support** -- verify your browser supports WebSocket connections. All modern browsers do; this is only an issue in restricted environments.
4. **Firewall / proxy** -- local firewalls or corporate proxies may block WebSocket upgrades on localhost. Try a different port.

### Server fails to start

**Symptoms:** `npm start` exits with an error.

**Common causes:**

1. **Port already in use** -- if port 8432 is taken, use `--port <number>` to choose another port.
2. **TypeScript not compiled** -- run `npm run build` before `npm start`. The `start` script runs `node dist/cli/index.js`, which requires compiled output.
3. **Node.js version** -- TMDev requires Node.js 18+. Check with `node --version`.
4. **Missing dependencies** -- run `npm install` to ensure all packages are installed.

### Performance tips

- **Use simple target pages for initial testing** -- complex pages with many sub-resources are slower to proxy.
- **Limit the number of watched scripts** -- each file change triggers re-parsing. Keep only active scripts in the watched directory.
- **Use `@match` instead of `*://*/*`** -- broad patterns cause scripts to be injected into every proxied page, including sub-resource navigations.
- **Disable verbose mode** -- `--verbose` enables debug-level Fastify logging, which adds overhead. Use it only when debugging server behavior.
