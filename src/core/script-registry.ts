/**
 * In-memory registry of loaded userscripts.
 *
 * Keeps track of all scripts, supports CRUD operations, URL matching,
 * and emits events so that other subsystems (server, dashboard) can react
 * to changes.
 */

import { EventEmitter } from 'node:events';
import { createHash } from 'node:crypto';
import { basename } from 'node:path';

import type { UserScript } from './types.js';
import { parseMetadata, matchesUrl } from './metadata-parser.js';

// ---------------------------------------------------------------------------
// Event types (for documentation / typed consumers)
// ---------------------------------------------------------------------------

export interface ScriptRegistryEvents {
  'script-added': [script: UserScript];
  'script-removed': [script: UserScript];
  'script-updated': [script: UserScript];
  'script-toggled': [script: UserScript];
}

// ---------------------------------------------------------------------------
// ScriptRegistry
// ---------------------------------------------------------------------------

/**
 * Manages an in-memory collection of `UserScript` objects.
 *
 * Scripts are keyed by a deterministic ID derived from their namespace + name
 * (falling back to a hash of the file path when metadata is insufficient).
 *
 * Emits the following events via Node `EventEmitter`:
 *  - `script-added`   -- a new script was registered
 *  - `script-removed` -- a script was removed
 *  - `script-updated` -- an existing script was re-parsed (file changed)
 *  - `script-toggled` -- a script's `enabled` flag was changed
 */
export class ScriptRegistry extends EventEmitter {
  /** Primary store -- scripts keyed by their unique ID. */
  private scripts: Map<string, UserScript> = new Map();

  // -----------------------------------------------------------------------
  // ID generation
  // -----------------------------------------------------------------------

  /**
   * Generate a deterministic script ID from namespace + name.
   * Falls back to a SHA-256 hash of the file path if both are missing.
   */
  private generateId(
    namespace: string | undefined,
    name: string,
    filePath: string,
  ): string {
    if (name && name !== 'Unnamed Script') {
      const base = namespace ? `${namespace}/${name}` : name;
      return createHash('sha256').update(base).digest('hex').slice(0, 16);
    }
    // Fallback: hash the filename
    return createHash('sha256')
      .update(basename(filePath))
      .digest('hex')
      .slice(0, 16);
  }

  // -----------------------------------------------------------------------
  // CRUD operations
  // -----------------------------------------------------------------------

  /**
   * Parse a userscript source, create a `UserScript` record, store it, and
   * return the result.
   *
   * @param filePath - Absolute (or workspace-relative) path to the `.user.js` file.
   * @param source   - Full file contents.
   * @returns The newly created `UserScript`.
   */
  addScript(filePath: string, source: string): UserScript {
    const metadata = parseMetadata(source);
    const id = this.generateId(metadata.namespace, metadata.name, filePath);

    const script: UserScript = {
      id,
      filePath,
      metadata,
      source,
      enabled: true,
      lastModified: Date.now(),
    };

    this.scripts.set(id, script);
    this.emit('script-added', script);
    return script;
  }

  /**
   * Remove a script by ID.
   *
   * @returns `true` if the script existed and was removed, `false` otherwise.
   */
  removeScript(id: string): boolean {
    const script = this.scripts.get(id);
    if (!script) return false;

    this.scripts.delete(id);
    this.emit('script-removed', script);
    return true;
  }

  /**
   * Re-parse a script that was already registered (identified by file path)
   * and replace its metadata / source.
   *
   * If no existing script matches the given `filePath` this behaves like
   * `addScript`.
   *
   * @param filePath - Path to the changed file.
   * @param source   - Updated file contents.
   * @returns The updated `UserScript`.
   */
  updateScript(filePath: string, source: string): UserScript {
    const existing = this.getScriptByPath(filePath);

    if (existing) {
      // Remove old entry (ID may change if name/namespace changed)
      this.scripts.delete(existing.id);
    }

    const metadata = parseMetadata(source);
    const id = this.generateId(metadata.namespace, metadata.name, filePath);

    const script: UserScript = {
      id,
      filePath,
      metadata,
      source,
      enabled: existing?.enabled ?? true,
      lastModified: Date.now(),
    };

    this.scripts.set(id, script);
    this.emit('script-updated', script);
    return script;
  }

  /**
   * Retrieve a script by its ID.
   */
  getScript(id: string): UserScript | undefined {
    return this.scripts.get(id);
  }

  /**
   * Return all registered scripts as an array.
   */
  getAllScripts(): UserScript[] {
    return [...this.scripts.values()];
  }

  /**
   * Find a script by its file path.
   */
  getScriptByPath(filePath: string): UserScript | undefined {
    for (const script of this.scripts.values()) {
      if (script.filePath === filePath) return script;
    }
    return undefined;
  }

  // -----------------------------------------------------------------------
  // Matching
  // -----------------------------------------------------------------------

  /**
   * Return all enabled scripts whose `@match` / `@include` patterns match
   * the given URL, excluding those that match any `@exclude` pattern.
   *
   * @param url - The page URL to match against.
   */
  getMatchingScripts(url: string): UserScript[] {
    return this.getAllScripts().filter((script) => {
      if (!script.enabled) return false;

      // Check @exclude first -- if the URL matches an exclude pattern, skip.
      if (
        script.metadata.exclude.length > 0 &&
        matchesUrl(script.metadata.exclude, url)
      ) {
        return false;
      }

      // Match if URL matches any @match or @include pattern.
      const hasMatch =
        script.metadata.match.length > 0 &&
        matchesUrl(script.metadata.match, url);

      const hasInclude =
        script.metadata.include.length > 0 &&
        matchesUrl(script.metadata.include, url);

      return hasMatch || hasInclude;
    });
  }

  // -----------------------------------------------------------------------
  // Toggle
  // -----------------------------------------------------------------------

  /**
   * Enable or disable a script by ID.
   *
   * @throws {Error} If no script with the given ID exists.
   */
  toggleScript(id: string, enabled: boolean): void {
    const script = this.scripts.get(id);
    if (!script) {
      throw new Error(`Script with id "${id}" not found.`);
    }

    script.enabled = enabled;
    this.emit('script-toggled', script);
  }
}
