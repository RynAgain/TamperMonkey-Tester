/**
 * Script Injection Engine
 *
 * Generates the `<script>` tags to inject into proxied HTML pages.
 * Groups scripts by their `@run-at` timing and produces head/body
 * script arrays suitable for {@link injectScriptsIntoHtml}.
 */

import { ScriptRegistry } from '../core/script-registry.js';
import { createScriptWrapper } from '../polyfill/index.js';
import { extractScriptBody } from '../core/metadata-parser.js';
import type { UserScript } from '../core/types.js';

// ---------------------------------------------------------------------------
// InjectionEngine
// ---------------------------------------------------------------------------

export class InjectionEngine {
  /**
   * @param registry          - The script registry to query for matching scripts.
   * @param polyfillBundlePath - URL path to the polyfill bundle (e.g. `/__tmdev__/polyfill.js`).
   */
  constructor(
    private registry: ScriptRegistry,
    private polyfillBundlePath: string,
  ) {}

  /**
   * Given a page URL, returns the script content strings that should be
   * injected into the proxied HTML.
   *
   * Scripts are grouped by `@run-at`:
   * - `document-start` scripts go into `headScripts` (injected after `<head>`)
   * - `document-end`, `document-idle`, `document-body` go into `bodyScripts`
   *   (injected before `</body>`)
   *
   * The first entry in `headScripts` is always the polyfill bundle loader
   * so that the GM_* API is available before any userscript executes.
   *
   * @param url - The target page URL to match scripts against.
   * @returns An object with `headScripts` and `bodyScripts` arrays of raw JS strings.
   */
  getInjectionPayload(url: string): { headScripts: string[]; bodyScripts: string[] } {
    const matching = this.registry.getMatchingScripts(url);

    // If no scripts match, return empty arrays (no injection needed)
    if (matching.length === 0) {
      return { headScripts: [], bodyScripts: [] };
    }

    const headScripts: string[] = [];
    const bodyScripts: string[] = [];

    // First entry: load the polyfill bundle so __tmdev__.initPolyfill is available
    headScripts.push(
      `/* tmdev polyfill loader */\n` +
      `(function() {\n` +
      `  var s = document.createElement('script');\n` +
      `  s.src = '${this.polyfillBundlePath}';\n` +
      `  s.async = false;\n` +
      `  document.head.appendChild(s);\n` +
      `})();`,
    );

    // Generate wrapped script content for each matching userscript
    for (const script of matching) {
      const wrapper = this.buildScriptWrapper(script);

      if (script.metadata.runAt === 'document-start') {
        headScripts.push(wrapper);
      } else {
        // document-end, document-idle, document-body all go before </body>
        bodyScripts.push(wrapper);
      }
    }

    return { headScripts, bodyScripts };
  }

  // -----------------------------------------------------------------------
  // Private helpers
  // -----------------------------------------------------------------------

  /**
   * Build the IIFE wrapper string for a single userscript.
   *
   * Uses {@link createScriptWrapper} from the polyfill module to generate
   * a self-contained IIFE that initialises the GM_* APIs and then runs
   * the script body.
   */
  private buildScriptWrapper(script: UserScript): string {
    const scriptBody = extractScriptBody(script.source);

    // Build the lite metadata object expected by createScriptWrapper
    const metadataLite = {
      name: script.metadata.name,
      version: script.metadata.version ?? '0.0.0',
      resource: script.metadata.resource,
      connect: script.metadata.connect,
      grant: script.metadata.grant,
    };

    return createScriptWrapper(
      script.id,
      metadataLite,
      script.metadata.grant,
      scriptBody,
    );
  }
}
