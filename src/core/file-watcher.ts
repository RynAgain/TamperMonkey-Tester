/**
 * File watcher for userscript directories.
 *
 * Uses `chokidar` to monitor a directory for `*.user.js` files and
 * automatically keeps the `ScriptRegistry` in sync with the filesystem.
 */

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { watch, type FSWatcher } from 'chokidar';

import type { ScriptRegistry } from './script-registry.js';

// ---------------------------------------------------------------------------
// FileWatcher
// ---------------------------------------------------------------------------

/**
 * Watches a directory (recursively) for `*.user.js` files and feeds
 * additions, changes, and removals into a `ScriptRegistry`.
 *
 * Usage:
 * ```ts
 * const watcher = new FileWatcher('./scripts', registry);
 * await watcher.start();
 * // ... later
 * await watcher.stop();
 * ```
 */
export class FileWatcher {
  private watcher: FSWatcher | null = null;
  private scriptsDir: string;
  private registry: ScriptRegistry;

  /**
   * @param scriptsDir - Directory to watch for `*.user.js` files.
   * @param registry   - The `ScriptRegistry` instance to update.
   */
  constructor(scriptsDir: string, registry: ScriptRegistry) {
    this.scriptsDir = resolve(scriptsDir);
    this.registry = registry;
  }

  // -----------------------------------------------------------------------
  // Lifecycle
  // -----------------------------------------------------------------------

  /**
   * Start watching the scripts directory.
   *
   * Returns a promise that resolves once the initial scan is complete
   * (i.e. chokidar has emitted its `ready` event).
   */
  async start(): Promise<void> {
    return new Promise<void>((resolvePromise, rejectPromise) => {
      this.watcher = watch('**/*.user.js', {
        cwd: this.scriptsDir,
        ignoreInitial: false,
        persistent: true,
        awaitWriteFinish: {
          stabilityThreshold: 200,
          pollInterval: 50,
        },
      });

      this.watcher.on('add', (relativePath: string) => {
        void this.handleAdd(relativePath);
      });

      this.watcher.on('change', (relativePath: string) => {
        void this.handleChange(relativePath);
      });

      this.watcher.on('unlink', (relativePath: string) => {
        void this.handleUnlink(relativePath);
      });

      this.watcher.on('error', (err: unknown) => {
        console.error(`[FileWatcher] chokidar error: ${(err as Error).message}`);
      });

      this.watcher.on('ready', () => {
        resolvePromise();
      });

      // Guard against watcher failing to initialise
      this.watcher.on('error', (err: unknown) => {
        rejectPromise(err);
      });
    });
  }

  /**
   * Stop watching and release resources.
   */
  async stop(): Promise<void> {
    if (this.watcher) {
      await this.watcher.close();
      this.watcher = null;
    }
  }

  // -----------------------------------------------------------------------
  // Event handlers
  // -----------------------------------------------------------------------

  /**
   * Handle a new `*.user.js` file appearing in the watched directory.
   */
  private async handleAdd(relativePath: string): Promise<void> {
    const fullPath = resolve(this.scriptsDir, relativePath);
    try {
      const source = await readFile(fullPath, 'utf-8');
      this.registry.addScript(fullPath, source);
    } catch (err) {
      console.error(
        `[FileWatcher] Failed to add script "${relativePath}":`,
        (err as Error).message,
      );
    }
  }

  /**
   * Handle a change to an existing `*.user.js` file.
   */
  private async handleChange(relativePath: string): Promise<void> {
    const fullPath = resolve(this.scriptsDir, relativePath);
    try {
      const source = await readFile(fullPath, 'utf-8');
      this.registry.updateScript(fullPath, source);
    } catch (err) {
      console.error(
        `[FileWatcher] Failed to update script "${relativePath}":`,
        (err as Error).message,
      );
    }
  }

  /**
   * Handle a `*.user.js` file being deleted.
   */
  private async handleUnlink(relativePath: string): Promise<void> {
    const fullPath = resolve(this.scriptsDir, relativePath);
    try {
      const script = this.registry.getScriptByPath(fullPath);
      if (script) {
        this.registry.removeScript(script.id);
      }
    } catch (err) {
      console.error(
        `[FileWatcher] Failed to remove script "${relativePath}":`,
        (err as Error).message,
      );
    }
  }
}
