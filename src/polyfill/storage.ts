/**
 * GM Storage Implementation (Browser-Side)
 *
 * Provides a scoped localStorage-backed storage layer for TamperMonkey's
 * GM_getValue / GM_setValue / GM_deleteValue / GM_listValues APIs.
 *
 * All keys are prefixed with `__tmdev__{scriptId}__` to isolate storage
 * per script. Writes are mirrored to the dev server via REST for dashboard
 * visibility and persistence across restarts.
 */

/** Return type of {@link createGMStorage} */
export interface GMStorage {
  getValue(key: string, defaultValue?: unknown): unknown;
  setValue(key: string, value: unknown): void;
  deleteValue(key: string): void;
  listValues(): string[];
}

/**
 * Creates a scoped storage instance for a specific script.
 * All keys are prefixed with `__tmdev__{scriptId}__` in localStorage.
 *
 * @param scriptId - Unique identifier for the script
 * @returns An object with getValue, setValue, deleteValue, and listValues methods
 */
export function createGMStorage(scriptId: string): GMStorage {
  const prefix = `__tmdev__${scriptId}__`;

  return {
    /**
     * Retrieve a value from storage.
     * Values are JSON-parsed; if parsing fails the raw string is returned.
     *
     * @param key - The storage key (without prefix)
     * @param defaultValue - Returned when the key does not exist
     * @returns The stored value, or `defaultValue` if not found
     */
    getValue(key: string, defaultValue?: unknown): unknown {
      const raw = localStorage.getItem(prefix + key);
      if (raw === null) return defaultValue;
      try {
        return JSON.parse(raw);
      } catch {
        return raw;
      }
    },

    /**
     * Store a value. The value is JSON-serialized before writing.
     * A fire-and-forget sync request is sent to the dev server.
     *
     * @param key - The storage key (without prefix)
     * @param value - The value to store (must be JSON-serializable)
     */
    setValue(key: string, value: unknown): void {
      localStorage.setItem(prefix + key, JSON.stringify(value));
      // Fire-and-forget sync to the dev server
      _syncToServer(scriptId, key, value);
    },

    /**
     * Remove a key from storage.
     * A fire-and-forget delete sync is sent to the dev server.
     *
     * @param key - The storage key to remove (without prefix)
     */
    deleteValue(key: string): void {
      localStorage.removeItem(prefix + key);
      _syncDeleteToServer(scriptId, key);
    },

    /**
     * List all keys stored for this script (without prefix).
     *
     * @returns Array of storage key names
     */
    listValues(): string[] {
      const keys: string[] = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.startsWith(prefix)) {
          keys.push(k.slice(prefix.length));
        }
      }
      return keys;
    },
  };
}

/**
 * Syncs a storage write to the dev server (fire-and-forget).
 * Failures are silently ignored -- localStorage is the source of truth.
 */
function _syncToServer(scriptId: string, key: string, value: unknown): void {
  fetch('/__tmdev__/api/storage', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ scriptId, key, value }),
  }).catch(() => {
    /* ignore sync failures -- localStorage is authoritative */
  });
}

/**
 * Syncs a storage deletion to the dev server (fire-and-forget).
 * Failures are silently ignored.
 */
function _syncDeleteToServer(scriptId: string, key: string): void {
  fetch('/__tmdev__/api/storage', {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ scriptId, key }),
  }).catch(() => {
    /* ignore sync failures */
  });
}
