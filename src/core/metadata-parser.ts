/**
 * TamperMonkey userscript metadata parser.
 *
 * Handles parsing of ==UserScript== metadata blocks, URL pattern matching,
 * and script body extraction.
 */

import type { UserScriptMetadata } from './types.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Regex that captures the full ==UserScript== ... ==/UserScript== block. */
const METADATA_BLOCK_RE =
  /\/\/\s*==UserScript==\s*\n([\s\S]*?)\/\/\s*==\/UserScript==/;

/** Regex for a single `// @key value` directive inside the block. */
const DIRECTIVE_RE = /^\/\/\s*@(\S+)\s*(.*?)\s*$/;

/** Keys that accumulate into arrays rather than overwriting. */
const ARRAY_KEYS = new Set<string>([
  'match',
  'include',
  'exclude',
  'require',
  'grant',
  'connect',
]);

// ---------------------------------------------------------------------------
// parseMetadata
// ---------------------------------------------------------------------------

/**
 * Parse a userscript source string and return its metadata.
 *
 * @param source - Full source text of the `.user.js` file.
 * @returns A fully-populated `UserScriptMetadata` object.
 * @throws {Error} If no `==UserScript==` block is found in the source.
 */
export function parseMetadata(source: string): UserScriptMetadata {
  const blockMatch = METADATA_BLOCK_RE.exec(source);
  if (!blockMatch) {
    throw new Error(
      'No ==UserScript== metadata block found in the provided source.',
    );
  }

  const blockBody = blockMatch[1];
  const lines = blockBody.split('\n');

  // Accumulator with sensible defaults ---------------------------------
  const meta: UserScriptMetadata = {
    name: 'Unnamed Script',
    match: [],
    include: [],
    exclude: [],
    require: [],
    resource: {},
    grant: [],
    runAt: 'document-idle',
    connect: [],
  };

  for (const line of lines) {
    const m = DIRECTIVE_RE.exec(line);
    if (!m) continue;

    const rawKey = m[1];
    const value = m[2];

    // Normalize the key: convert kebab-case keys used in TamperMonkey
    // (e.g. `run-at`, `homepage-url`) to the camelCase property names
    // defined in UserScriptMetadata.
    const key = normalizeKey(rawKey);

    // ---- Array keys ----
    if (ARRAY_KEYS.has(key)) {
      (meta[key as keyof Pick<
        UserScriptMetadata,
        'match' | 'include' | 'exclude' | 'require' | 'grant' | 'connect'
      >] as string[]).push(value);
      continue;
    }

    // ---- @resource: "name url" pairs ----
    if (key === 'resource') {
      const spaceIdx = value.indexOf(' ');
      if (spaceIdx !== -1) {
        const resName = value.slice(0, spaceIdx).trim();
        const resUrl = value.slice(spaceIdx + 1).trim();
        meta.resource[resName] = resUrl;
      }
      continue;
    }

    // ---- @run-at ----
    if (key === 'runAt') {
      const normalized = value.trim() as UserScriptMetadata['runAt'];
      if (
        ['document-start', 'document-end', 'document-idle', 'document-body'].includes(normalized)
      ) {
        meta.runAt = normalized;
      }
      continue;
    }

    // ---- Boolean keys ----
    if (key === 'noframes') {
      meta.noframes = true;
      continue;
    }

    // ---- Simple scalar keys ----
    if (key in meta || isOptionalScalar(key)) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (meta as any)[key] = value;
    }
  }

  return meta;
}

// ---------------------------------------------------------------------------
// matchesUrl
// ---------------------------------------------------------------------------

/**
 * Check whether a URL matches any of the given TamperMonkey-style patterns.
 *
 * Supports both Chrome match-pattern syntax (`scheme://host/path`) and
 * simpler `@include`-style glob patterns using `*` wildcards.
 *
 * @param patterns - Array of match / include patterns.
 * @param url      - The URL to test against.
 * @returns `true` if the URL matches at least one pattern.
 */
export function matchesUrl(patterns: string[], url: string): boolean {
  for (const pattern of patterns) {
    if (matchSinglePattern(pattern, url)) {
      return true;
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// extractScriptBody
// ---------------------------------------------------------------------------

/**
 * Strip the `==UserScript==` metadata block from the source and return
 * only the executable JavaScript body.
 *
 * @param source - Full source text of the `.user.js` file.
 * @returns The source with the metadata block removed.
 */
export function extractScriptBody(source: string): string {
  // Replace the entire metadata block (including the surrounding comment
  // delimiters) with an empty string. Trim leading blank lines.
  return source.replace(/\/\/\s*==UserScript==\s*\n[\s\S]*?\/\/\s*==\/UserScript==\s*\n?/, '').trim();
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Normalize a raw `@key` name to the camelCase property used in
 * `UserScriptMetadata`.
 */
function normalizeKey(raw: string): string {
  const MAP: Record<string, string> = {
    'run-at': 'runAt',
    'homepage-url': 'homepageURL',
    'homepageurl': 'homepageURL',
    'homepage': 'homepageURL',
    'update-url': 'updateURL',
    'updateurl': 'updateURL',
    'download-url': 'downloadURL',
    'downloadurl': 'downloadURL',
    'support-url': 'supportURL',
    'supporturl': 'supportURL',
  };
  return MAP[raw.toLowerCase()] ?? raw;
}

/** Returns true for optional scalar keys that live on UserScriptMetadata. */
function isOptionalScalar(key: string): boolean {
  return [
    'name',
    'namespace',
    'version',
    'description',
    'author',
    'icon',
    'homepageURL',
    'updateURL',
    'downloadURL',
    'supportURL',
  ].includes(key);
}

/**
 * Test a single pattern against a URL.
 *
 * 1. If the pattern looks like a Chrome match pattern (`scheme://host/path`),
 *    parse and test each component.
 * 2. Otherwise treat it as a simple glob (replace `*` with `.*`).
 */
function matchSinglePattern(pattern: string, url: string): boolean {
  // Special catch-all
  if (pattern === '<all_urls>' || pattern === '*') {
    return true;
  }

  // Try Chrome match-pattern syntax: <scheme>://<host><path>
  const matchPatternRe = /^(\*|https?|file|ftp):\/\/(\*|(?:\*\.)?[^/]*)(\/.*)$/;
  const pm = matchPatternRe.exec(pattern);

  if (pm) {
    return testMatchPattern(pm[1], pm[2], pm[3], url);
  }

  // Fall back to simple glob matching (used for @include patterns).
  return testGlob(pattern, url);
}

/**
 * Test a parsed Chrome match-pattern against a URL.
 *
 * @param schemePattern - `*`, `http`, `https`, `file`, or `ftp`.
 * @param hostPattern   - `*`, `*.example.com`, or an exact host.
 * @param pathPattern   - A path like `/*` or `/foo/bar*`.
 * @param url           - The URL to test.
 */
function testMatchPattern(
  schemePattern: string,
  hostPattern: string,
  pathPattern: string,
  url: string,
): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }

  // -- Scheme -----------------------------------------------------------
  if (schemePattern !== '*') {
    if (parsed.protocol !== `${schemePattern}:`) return false;
  } else {
    // `*` matches http and https only
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
  }

  // -- Host -------------------------------------------------------------
  if (hostPattern !== '*') {
    if (hostPattern.startsWith('*.')) {
      // Matches the domain itself or any subdomain.
      const baseDomain = hostPattern.slice(2);
      if (
        parsed.hostname !== baseDomain &&
        !parsed.hostname.endsWith(`.${baseDomain}`)
      ) {
        return false;
      }
    } else {
      if (parsed.hostname !== hostPattern) return false;
    }
  }

  // -- Path -------------------------------------------------------------
  const pathToTest = parsed.pathname + parsed.search + parsed.hash;
  if (!testGlob(pathPattern, pathToTest)) return false;

  return true;
}

/**
 * Simple glob matcher -- replaces `*` with `.*` and does a full-string regex
 * match. Used for both @include globs and path segments of match patterns.
 */
function testGlob(pattern: string, value: string): boolean {
  // Escape regex-special characters except `*`, then replace `*` with `.*`.
  const escaped = pattern
    .replace(/([.+?^${}()|[\]\\])/g, '\\$1')
    .replace(/\*/g, '.*');

  return new RegExp(`^${escaped}$`).test(value);
}
