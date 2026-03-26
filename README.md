# TMDev -- TamperMonkey Dev Testing Service

A local Node.js development server for authoring, testing, and debugging TamperMonkey/Greasemonkey userscripts without installing them in a browser extension.

---

## Features

- **Proxy-based script injection** -- fetches target websites, strips Content-Security-Policy headers, and injects your userscripts automatically
- **Full GM_* API polyfill** -- localStorage-backed storage, cross-origin XHR relay, notifications, clipboard, resource loading, menu commands, and more
- **GM4 Promise-based API** -- `GM.getValue`, `GM.setValue`, `GM.xmlHttpRequest`, etc. alongside classic `GM_*` functions
- **File watcher with hot-reload** -- monitors your scripts directory for changes and pushes updates via WebSocket in real time
- **Web dashboard** -- manage scripts, view live console output, inspect GM storage, and navigate proxied pages from a single UI
- **CLI tool (`tmdev`)** -- start the server with a single command, configure port/host/directory via flags
- **@grant-based API filtering** -- only APIs declared in your script's `@grant` metadata are exposed, matching real TamperMonkey behavior
- **@run-at timing support** -- scripts are injected at `document-start`, `document-end`, or `document-idle` positions
- **URL pattern matching** -- supports Chrome match-pattern syntax (`*://...`) and glob-style `@include` patterns

---

## Quick Start

```bash
# 1. Clone the repository
git clone <repo-url> tampermonkey-tester
cd tampermonkey-tester

# 2. Install dependencies
npm install

# 3. Create a scripts directory
mkdir scripts

# 4. Add a userscript
cat > scripts/hello.user.js << 'EOF'
// ==UserScript==
// @name        Hello World
// @namespace   http://localhost
// @version     1.0
// @match       *://*/*
// @grant       GM_log
// ==/UserScript==

GM_log('Hello from TMDev!');
document.title = '[TMDev] ' + document.title;
EOF

# 5. Start the dev server
npm run dev
```

Then open `http://localhost:8432/__tmdev__/` in your browser to access the dashboard.

---

## Installation

### Local development (recommended for contributing)

```bash
npm install
npm run build
npm start
```

### Global install (use `tmdev` from anywhere)

```bash
# From the project root
npm install -g .

# Now available system-wide
tmdev serve --dir ./my-scripts --open
```

### npm scripts

| Script | Command | Description |
|--------|---------|-------------|
| `dev` | `npm run dev` | Start TypeScript compiler in watch mode |
| `build` | `npm run build` | Compile TypeScript to `dist/` |
| `start` | `npm start` | Run the compiled CLI entry point |
| `test` | `npm test` | Run tests via vitest |
| `lint` | `npm run lint` | Lint source files with ESLint |

---

## Usage

### CLI Options

```
tmdev serve [options]
```

| Flag | Alias | Default | Description |
|------|-------|---------|-------------|
| `--port <number>` | `-p` | `8432` | Port number to listen on |
| `--host <string>` | `-H` | `127.0.0.1` | Host to bind the server to |
| `--dir <path>` | `-d` | `./scripts` | Scripts directory to watch for `.user.js` files |
| `--open` | `-o` | `false` | Open the dashboard in the default browser on startup |
| `--verbose` | `-v` | `false` | Enable verbose/debug logging output |

### URL Patterns

Once the server is running, use these URL patterns:

| Purpose | URL |
|---------|-----|
| Dashboard | `http://localhost:8432/__tmdev__/` |
| Proxy (path-based) | `http://localhost:8432/https://example.com` |
| Proxy (query-based) | `http://localhost:8432/?url=https://example.com` |
| REST API | `http://localhost:8432/__tmdev__/api/scripts` |
| WebSocket | `ws://localhost:8432/__tmdev__/ws` |
| Polyfill bundle | `http://localhost:8432/__tmdev__/polyfill.js` |

### Navigating to Proxied URLs

To test your userscript against a target site, prepend the TMDev server URL:

```
# Direct in browser address bar:
http://localhost:8432/https://news.ycombinator.com

# Or use the query parameter form:
http://localhost:8432/?url=https://news.ycombinator.com
```

The server fetches the target page, strips security headers, rewrites relative URLs to absolute, injects the GM_* polyfill bundle, and injects any matching userscripts based on their `@match` / `@include` patterns.

### Using the Dashboard

The dashboard at `http://localhost:8432/__tmdev__/` provides:

1. **Proxy URL bar** -- enter a target URL and click "Go" to load it through the proxy
2. **Scripts panel** -- lists all discovered `.user.js` files with name, version, match patterns, and an enable/disable toggle
3. **Console tab** -- live log viewer receiving `GM_log` output and script change events via WebSocket
4. **Storage tab** -- inspect GM_getValue/GM_setValue data stored by each script
5. **Info tab** -- view script metadata details

---

## Writing Userscripts

Create a `.user.js` file in your scripts directory (default: `./scripts/`) with a standard TamperMonkey metadata block:

```javascript
// ==UserScript==
// @name        My Script
// @namespace   https://example.com
// @version     1.0
// @description Enhances example.com with custom features
// @match       https://example.com/*
// @match       https://www.example.com/*
// @exclude     https://example.com/admin/*
// @grant       GM_addStyle
// @grant       GM_getValue
// @grant       GM_setValue
// @grant       GM_xmlhttpRequest
// @connect     api.example.com
// @run-at      document-end
// ==/UserScript==

// Your script code here
const visitCount = GM_getValue('visits', 0);
GM_setValue('visits', visitCount + 1);

GM_addStyle(`
  body { font-family: system-ui, sans-serif; }
  .my-banner { background: #2196F3; color: white; padding: 8px 16px; }
`);

const banner = document.createElement('div');
banner.className = 'my-banner';
banner.textContent = `Visit #${visitCount + 1} -- enhanced by TMDev`;
document.body.prepend(banner);
```

### Metadata Fields in TMDev Context

| Field | Purpose |
|-------|---------|
| `@name` | Display name shown in the dashboard script list |
| `@namespace` | Namespace URI for the script (informational) |
| `@version` | Version string shown in the dashboard |
| `@description` | Human-readable description |
| `@match` | URL patterns (Chrome match-pattern syntax) that determine which proxied pages receive this script |
| `@include` | Glob/regex URL patterns (alternative to `@match`) |
| `@exclude` | URL patterns to skip, even if `@match`/`@include` would match |
| `@grant` | Which GM_* APIs the script needs. Use `none` for no API injection. If omitted, all APIs are available. |
| `@run-at` | Injection timing: `document-start` (after `<head>`), `document-end` (before `</body>`), or `document-idle` (default, via `requestIdleCallback` wrapper) |
| `@connect` | Allowed domains for `GM_xmlhttpRequest` (enforced server-side) |
| `@resource` | Named external resources (format: `name url`) accessible via `GM_getResourceText`/`GM_getResourceURL` |
| `@noframes` | If present, script does not execute in iframes |
| `@require` | External JS URLs to load before script (placeholder -- not yet implemented) |

---

## Supported GM_* APIs

### Classic API (synchronous)

| API | Status | Notes |
|-----|--------|-------|
| `GM_info` | Implemented | Script metadata and handler info; always available |
| `GM_getValue(key, default?)` | Implemented | localStorage-backed, scoped per script |
| `GM_setValue(key, value)` | Implemented | JSON-serialized, mirrored to server for dashboard visibility |
| `GM_deleteValue(key)` | Implemented | Removes from localStorage and syncs deletion to server |
| `GM_listValues()` | Implemented | Returns all key names stored by the script |
| `GM_xmlhttpRequest(details)` | Implemented | Relayed through `POST /__tmdev__/api/xhr` on the server; supports onload/onerror/ontimeout/onprogress callbacks |
| `GM_addStyle(css)` | Implemented | Injects a `<style>` element into `document.head` |
| `GM_notification(details)` | Implemented | Uses browser Notification API with console.log fallback |
| `GM_setClipboard(text)` | Implemented | Uses `navigator.clipboard.writeText()` |
| `GM_getResourceText(name)` | Partial | Returns the resource URL string from metadata; full pre-fetch not yet implemented |
| `GM_getResourceURL(name)` | Partial | Returns the resource URL string; blob URL generation not yet implemented |
| `GM_registerMenuCommand(caption, fn, accessKey?)` | Implemented | Stored locally and reported to dashboard via WebSocket |
| `GM_unregisterMenuCommand(caption)` | Implemented | Removes a previously registered command |
| `GM_openInTab(url, options?)` | Implemented | Opens via `window.open()`; returns handle with `close()` method |
| `GM_log(...args)` | Implemented | Wraps `console.log()` and streams to dashboard via WebSocket |
| `unsafeWindow` | Implemented | Direct reference to `window` (no sandbox isolation in dev mode) |

### GM4 Promise-Based API

| API | Status | Notes |
|-----|--------|-------|
| `GM.info` | Implemented | Same as `GM_info` |
| `GM.getValue(key, default?)` | Implemented | Promise wrapper around `GM_getValue` |
| `GM.setValue(key, value)` | Implemented | Promise wrapper around `GM_setValue` |
| `GM.deleteValue(key)` | Implemented | Promise wrapper around `GM_deleteValue` |
| `GM.listValues()` | Implemented | Promise wrapper around `GM_listValues` |
| `GM.xmlHttpRequest(details)` | Implemented | Returns Promise that resolves on success, rejects on error/timeout |
| `GM.notification(details)` | Implemented | Promise wrapper around `GM_notification` |
| `GM.setClipboard(text)` | Implemented | Promise wrapper around `GM_setClipboard` |
| `GM.getResourceUrl(name)` | Partial | Promise wrapper around `GM_getResourceURL` |

---

## API Reference

All REST endpoints are prefixed with `/__tmdev__/api`.

### Scripts

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/scripts` | List all discovered scripts (without source) |
| `GET` | `/api/scripts/:id` | Get a single script including full source |
| `PATCH` | `/api/scripts/:id` | Update script properties (e.g., `{ "enabled": false }`) |

### XHR Relay

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/xhr` | Execute an HTTP request on behalf of a userscript's `GM_xmlhttpRequest` |

**Request body:**

```json
{
  "scriptId": "abc123",
  "method": "GET",
  "url": "https://api.example.com/data",
  "headers": { "Accept": "application/json" },
  "data": null,
  "responseType": "json",
  "connectDomains": ["api.example.com"]
}
```

### Storage

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/storage/:scriptId` | Get all stored key-value pairs for a script |
| `PUT` | `/api/storage` | Set a storage value (`{ scriptId, key, value }`) |
| `DELETE` | `/api/storage` | Delete a storage value (`{ scriptId, key }`) |

### WebSocket

| Endpoint | Description |
|----------|-------------|
| `ws://localhost:8432/__tmdev__/ws` | Bidirectional channel for hot-reload events, log streaming, and storage sync |

**Server-to-client messages:**

| Type | Trigger |
|------|---------|
| `script-change` | File watcher detects add/remove/update of a `.user.js` file |

**Client-to-server messages:**

| Type | Purpose |
|------|---------|
| `log` | Forward `GM_log` output to dashboard console panel |
| `storage:sync` | Mirror storage write to server for dashboard visibility |
| `menu:register` / `menu:unregister` | Report menu command changes |

---

## How It Works

TMDev operates as a local HTTP proxy that intercepts, transforms, and re-serves web pages with your userscripts injected. Here is the pipeline:

```
  .user.js files          File Watcher            Script Registry
  in ./scripts/  -------> (chokidar monitors) --> (in-memory store with
                           *.user.js changes       parsed metadata, source,
                                                   enabled state)

  Browser request         Dev Server              Target Website
  GET /https://...  ----> (Fastify)         ----> fetch via undici
                                            <---- HTML response

                          Proxy Handler
                          1. Strip CSP / X-Frame-Options headers
                          2. Rewrite relative URLs to absolute
                          3. Query Registry for scripts matching target URL
                          4. Injection Engine groups scripts by @run-at timing

                          Injection Engine
                          5. Generate polyfill loader <script> tag (after <head>)
                          6. Wrap each script in IIFE with scoped GM_* APIs
                          7. Insert document-start scripts after <head>
                          8. Insert document-end/idle scripts before </body>

  Browser                 Modified HTML
  <---- receives page with polyfill + userscripts injected

  Browser                 WebSocket
  <---->  /__tmdev__/ws   real-time script change notifications, log streaming
```

**Step by step:**

1. The **file watcher** ([`FileWatcher`](src/core/file-watcher.ts)) discovers `.user.js` files in the configured scripts directory using chokidar
2. The **metadata parser** ([`parseMetadata()`](src/core/metadata-parser.ts:42)) extracts `@match`, `@grant`, `@run-at`, and other directives from each script's `==UserScript==` block
3. Scripts are stored in the **script registry** ([`ScriptRegistry`](src/core/script-registry.ts)) with their metadata, source, and enabled state
4. When you visit a proxied URL, the **proxy handler** ([`proxyRequest()`](src/server/proxy-handler.ts:49)) fetches the target page via undici
5. The HTML is rewritten: CSP headers are stripped, relative URLs are made absolute via [`rewriteRelativeUrls()`](src/server/proxy-handler.ts:205)
6. The **injection engine** ([`InjectionEngine`](src/server/injection-engine.ts:18)) queries the registry for matching scripts and generates wrapped `<script>` tags
7. Each script is wrapped in an IIFE via [`createScriptWrapper()`](src/polyfill/index.ts:161) that initializes only the `@grant`-specified GM_* APIs in a local scope
8. The dashboard receives real-time updates via WebSocket when scripts change, enabling hot-reload workflows

---

## Configuration

### CLI Arguments

The primary configuration method is through CLI flags passed to `tmdev serve`:

```bash
tmdev serve --port 3000 --host 0.0.0.0 --dir ./my-scripts --verbose --open
```

See the [CLI Options](#cli-options) table above for all available flags.

### Configuration Precedence

CLI arguments take highest priority. The server configuration is defined by the [`DevServerConfig`](src/core/types.ts:32) interface:

```typescript
interface DevServerConfig {
  port: number;       // default: 8432
  host: string;       // default: '127.0.0.1'
  scriptsDir: string; // default: './scripts'
  open: boolean;      // default: false
  verbose: boolean;   // default: false
}
```

### Security Note

The default host is `127.0.0.1` (localhost only). Binding to `0.0.0.0` exposes the proxy to your network -- since the proxy can fetch arbitrary URLs, this is a security risk. Only bind to `0.0.0.0` on trusted networks.

---

## Development

### Prerequisites

- Node.js 18 or later
- npm 9 or later

### Working on TMDev Itself

```bash
# Install dependencies
npm install

# Start TypeScript compiler in watch mode (recompiles on save)
npm run dev

# In a separate terminal, run the server
npm start -- --dir ./scripts --verbose

# Run tests
npm test

# Lint the codebase
npm run lint

# Production build
npm run build
```

### Project Structure

```
src/
  cli/                        -- CLI entry point and command definitions
    index.ts                  -- Main entry, banner, shutdown handling
    commands.ts               -- Commander program with `serve` command
  core/                       -- Core logic: parsing, registry, file watching
    types.ts                  -- Shared TypeScript interfaces
    metadata-parser.ts        -- ==UserScript== block parser and URL matcher
    script-registry.ts        -- In-memory script store with event emitter
    file-watcher.ts           -- chokidar-based directory watcher
  server/                     -- Fastify HTTP server and proxy
    index.ts                  -- Server setup, plugin registration, proxy catch-all
    proxy-handler.ts          -- Target URL fetching, CSP stripping, URL rewriting
    injection-engine.ts       -- Script tag generation grouped by @run-at timing
    routes/
      api.ts                  -- REST API: scripts, XHR relay, storage
      dashboard.ts            -- Dashboard static file serving
  polyfill/                   -- Browser-side GM_* API implementations
    index.ts                  -- Polyfill entry point, grant-based API filtering
    gm-api.ts                 -- Classic GM_* synchronous API factory
    gm4-api.ts                -- GM4 Promise-based API wrapper
    storage.ts                -- localStorage-backed scoped storage
    xhr.ts                    -- XHR relay through dev server
  dashboard/                  -- Web UI (served as static files)
    index.html                -- SPA shell
    styles.css                -- Dashboard styles
    app.ts                    -- Dashboard application logic
docs/
  ARCHITECTURE.md             -- Detailed technical architecture document
  USAGE.md                    -- Extended usage guide and troubleshooting
```

### Key Dependencies

| Package | Purpose |
|---------|---------|
| [fastify](https://www.npmjs.com/package/fastify) | HTTP server framework |
| [@fastify/websocket](https://www.npmjs.com/package/@fastify/websocket) | WebSocket support for hot-reload and log streaming |
| [@fastify/static](https://www.npmjs.com/package/@fastify/static) | Static file serving for dashboard |
| [undici](https://www.npmjs.com/package/undici) | HTTP client for proxy requests |
| [htmlparser2](https://www.npmjs.com/package/htmlparser2) | Fast, tolerant HTML parsing for rewriting proxied pages |
| [dom-serializer](https://www.npmjs.com/package/dom-serializer) | HTML serialization from parsed DOM |
| [domhandler](https://www.npmjs.com/package/domhandler) / [domutils](https://www.npmjs.com/package/domutils) | DOM manipulation utilities |
| [chokidar](https://www.npmjs.com/package/chokidar) | Cross-platform file watching |
| [commander](https://www.npmjs.com/package/commander) | CLI argument parsing |
| [picocolors](https://www.npmjs.com/package/picocolors) | Terminal color output |
| [minimatch](https://www.npmjs.com/package/minimatch) | Glob matching for URL patterns |
| [esbuild](https://www.npmjs.com/package/esbuild) | Bundling polyfill and dashboard TypeScript for the browser |
| [vitest](https://www.npmjs.com/package/vitest) | Test runner |

---

## Known Limitations

- **Complex SPAs may break under proxying** -- sites that rely heavily on client-side routing, service workers, or WebSocket connections may not function correctly when served through the proxy. Try simpler target pages first.
- **GM_xmlhttpRequest is relayed through the server** -- cross-origin requests are proxied via `POST /__tmdev__/api/xhr`, which means timing and streaming behavior differ slightly from real TamperMonkey. Streaming progress (`onprogress`) reports completion after the full response is received, not incrementally.
- **No `@require` loading** -- the `@require` metadata field is parsed but external scripts are not fetched or injected. This is a planned enhancement.
- **Sandbox isolation is approximate** -- in real TamperMonkey, scripts run in an isolated content-script context. In TMDev, the polyfill and userscripts execute directly in the page's JavaScript context. While each script gets its own scoped API instance via IIFE wrapping, there is no true isolation from page scripts or between userscripts.
- **`unsafeWindow` is just `window`** -- since there is no sandbox, `unsafeWindow` is a direct reference to the page's `window` object.
- **`GM_getResourceText` / `GM_getResourceURL` are partial** -- resources declared in `@resource` return the URL string from metadata rather than pre-fetched content or blob URLs.
- **Storage is scoped to the proxy origin** -- `localStorage` is keyed to `localhost:8432`, not the target site's origin. This means storage data is shared across all proxied sites (but isolated per script via key prefixing).
- **`localStorage` has a ~5MB limit** -- per-origin storage cap applies to all scripts collectively. Rarely an issue for userscript storage.
- **No config file support yet** -- configuration is CLI-only. A `tmdev.config.json` file format is planned but not yet implemented.
- **No HTTPS proxy support** -- the dev server runs on HTTP only. Target HTTPS sites are fetched server-side, but the browser connection to TMDev is plain HTTP.

---

## License

MIT
