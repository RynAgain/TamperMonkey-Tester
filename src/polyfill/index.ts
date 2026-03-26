/**
 * Polyfill Entry Point (Browser-Side)
 *
 * This is the main entry module bundled by esbuild for injection into
 * proxied pages. It wires together storage, XHR, GM_* classic API, and
 * GM4 Promise-based API, then attaches the granted subset to the target scope.
 *
 * Usage (injected by the injection engine):
 * ```js
 * __tmdev__.initPolyfill(scriptId, metadata, grants, window);
 * ```
 */

import { createGMStorage } from './storage.js';
import { createGMApi } from './gm-api.js';
import type { ScriptMetadataLite, GMApi } from './gm-api.js';
import { createGM4Api } from './gm4-api.js';
import type { GM4Api } from './gm4-api.js';

// Re-export types and factories for external consumers
export type { ScriptMetadataLite } from './gm-api.js';
export type { GMStorage } from './storage.js';
export type { GMApi } from './gm-api.js';
export type { GM4Api } from './gm4-api.js';
export { createGMStorage } from './storage.js';
export { createGMApi } from './gm-api.js';
export { createGM4Api } from './gm4-api.js';
export { createGMXmlHttpRequest } from './xhr.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * All classic GM_* API names that can appear in @grant.
 * Used to determine which functions to attach when grants are specified.
 */
const CLASSIC_GM_APIS: ReadonlyArray<keyof GMApi> = [
  'GM_getValue',
  'GM_setValue',
  'GM_deleteValue',
  'GM_listValues',
  'GM_xmlhttpRequest',
  'GM_addStyle',
  'GM_notification',
  'GM_setClipboard',
  'GM_getResourceText',
  'GM_getResourceURL',
  'GM_registerMenuCommand',
  'GM_unregisterMenuCommand',
  'GM_openInTab',
  'GM_log',
] as const;

/**
 * Mapping from GM4 grant names (e.g., "GM.getValue") to their
 * corresponding property name on the GM4Api object.
 */
const GM4_GRANT_MAP: Record<string, keyof GM4Api> = {
  'GM.getValue': 'getValue',
  'GM.setValue': 'setValue',
  'GM.deleteValue': 'deleteValue',
  'GM.listValues': 'listValues',
  'GM.xmlHttpRequest': 'xmlHttpRequest',
  'GM.notification': 'notification',
  'GM.setClipboard': 'setClipboard',
  'GM.getResourceUrl': 'getResourceUrl',
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Initializes all GM APIs for a given script and attaches them to the
 * provided scope (or window).
 *
 * The function respects the `@grant` metadata:
 * - If grants includes `'none'` or is empty, only `unsafeWindow` and
 *   `GM_info` are attached (matching TamperMonkey behavior).
 * - If a specific API name is listed (e.g., `'GM_getValue'`), only that
 *   function is attached.
 * - If a GM4-style grant is listed (e.g., `'GM.getValue'`), the `GM`
 *   namespace object is created on scope with the requested methods.
 * - `unsafeWindow` and `GM_info` are always attached regardless of grants.
 *
 * @param scriptId - Unique script identifier
 * @param metadata - Script metadata (lite version with name, version, resource, connect, grant)
 * @param grants - Array of @grant values to determine which APIs to expose
 * @param scope - Target scope to attach APIs to (defaults to window)
 */
export function initPolyfill(
  scriptId: string,
  metadata: ScriptMetadataLite,
  grants: string[],
  scope: Record<string, unknown> = window as unknown as Record<string, unknown>,
): void {
  // 1. Create the storage layer
  const storage = createGMStorage(scriptId);

  // 2. Create the classic GM_* API
  const gmApi = createGMApi(scriptId, metadata, storage);

  // 3. Create the GM4 Promise-based API
  const gm4Api = createGM4Api(gmApi);

  // 4. Always attach unsafeWindow and GM_info
  scope['unsafeWindow'] = gmApi.unsafeWindow;
  scope['GM_info'] = gmApi.GM_info;

  // 5. Determine grant mode
  const isGrantNone = grants.length === 0 || grants.includes('none');

  if (isGrantNone) {
    // @grant none -- only unsafeWindow and GM_info are exposed
    return;
  }

  // 6. Attach classic GM_* APIs based on grants
  for (const apiName of CLASSIC_GM_APIS) {
    if (grants.includes(apiName)) {
      scope[apiName] = gmApi[apiName];
    }
  }

  // 7. Attach GM4 APIs if any GM.* grants are present
  const gm4Grants = grants.filter((g) => g.startsWith('GM.'));
  if (gm4Grants.length > 0) {
    // Create or extend the GM namespace object on scope
    const gmNamespace = (scope['GM'] as Record<string, unknown>) || {};

    // Always include GM.info when any GM.* grant is present
    gmNamespace['info'] = gm4Api.info;

    for (const grant of gm4Grants) {
      const propName = GM4_GRANT_MAP[grant];
      if (propName) {
        gmNamespace[propName] = gm4Api[propName];
      }
    }

    scope['GM'] = gmNamespace;
  }
}

/**
 * Creates a JavaScript string that wraps a userscript body inside an IIFE
 * with all granted GM_* APIs initialized and available.
 *
 * The generated code:
 * 1. Calls `initPolyfill` to set up APIs in a local scope object
 * 2. Executes the script body with those APIs available via `with()` or
 *    explicit variable declarations
 *
 * @param scriptId - Unique script identifier
 * @param metadata - Script metadata (lite version)
 * @param grants - Array of @grant values
 * @param scriptBody - The raw userscript source code
 * @returns A string of JavaScript ready for injection into a <script> tag
 */
export function createScriptWrapper(
  scriptId: string,
  metadata: ScriptMetadataLite,
  grants: string[],
  scriptBody: string,
): string {
  // Serialize metadata and grants as JSON for embedding
  const metadataJson = JSON.stringify(metadata);
  const grantsJson = JSON.stringify(grants);
  const escapedScriptId = JSON.stringify(scriptId);

  // Build the list of API names that need to be destructured into scope
  const apiNames: string[] = ['unsafeWindow', 'GM_info'];

  const isGrantNone = grants.length === 0 || grants.includes('none');

  if (!isGrantNone) {
    for (const apiName of CLASSIC_GM_APIS) {
      if (grants.includes(apiName)) {
        apiNames.push(apiName);
      }
    }
  }

  const hasGM4 = grants.some((g) => g.startsWith('GM.'));

  // Generate the IIFE wrapper
  return `(function() {
  "use strict";
  var __tmdev_scope__ = {};
  var __tmdev_init__ = window.__tmdev__ && window.__tmdev__.initPolyfill;
  if (__tmdev_init__) {
    __tmdev_init__(${escapedScriptId}, ${metadataJson}, ${grantsJson}, __tmdev_scope__);
  }

  // Destructure granted APIs into local variables
  ${apiNames.map((name) => `var ${name} = __tmdev_scope__["${name}"];`).join('\n  ')}
  ${hasGM4 ? 'var GM = __tmdev_scope__["GM"];' : ''}

  // --- Userscript body begins ---
  ${scriptBody}
  // --- Userscript body ends ---
})();`;
}
