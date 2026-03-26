/**
 * REST API Routes
 *
 * Registers the `/__tmdev__/api/` route group on the Fastify instance.
 * Provides endpoints for script management, XHR relay, and server-side
 * storage mirroring.
 */

import { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { request } from 'undici';
import { ScriptRegistry } from '../../core/script-registry.js';

// ---------------------------------------------------------------------------
// Server-side storage (in-memory mirror of browser localStorage)
// ---------------------------------------------------------------------------

/** Keyed by scriptId, then by storage key. */
const storageMap = new Map<string, Map<string, unknown>>();

// ---------------------------------------------------------------------------
// Plugin
// ---------------------------------------------------------------------------

/**
 * Fastify plugin that registers the REST API routes.
 *
 * Expected to be registered with prefix `/__tmdev__/api`.
 */
export const apiRoutes: FastifyPluginAsync<{ registry: ScriptRegistry }> = async (
  fastify: FastifyInstance,
  opts,
) => {
  const { registry } = opts;

  // -----------------------------------------------------------------------
  // Scripts
  // -----------------------------------------------------------------------

  /**
   * GET /scripts -- List all scripts (without source for brevity).
   */
  fastify.get('/scripts', async (_request, _reply) => {
    const scripts = registry.getAllScripts();
    return scripts.map((s) => ({
      id: s.id,
      filePath: s.filePath,
      metadata: s.metadata,
      enabled: s.enabled,
      lastModified: s.lastModified,
    }));
  });

  /**
   * GET /scripts/:id -- Get a single script including full source.
   */
  fastify.get<{ Params: { id: string } }>('/scripts/:id', async (req, reply) => {
    const script = registry.getScript(req.params.id);
    if (!script) {
      return reply.status(404).send({ error: 'Script not found' });
    }
    return script;
  });

  /**
   * PATCH /scripts/:id -- Update script properties (currently only `enabled`).
   */
  fastify.patch<{ Params: { id: string }; Body: { enabled: boolean } }>(
    '/scripts/:id',
    async (req, reply) => {
      const script = registry.getScript(req.params.id);
      if (!script) {
        return reply.status(404).send({ error: 'Script not found' });
      }

      const body = req.body as { enabled?: boolean };
      if (typeof body.enabled === 'boolean') {
        registry.toggleScript(req.params.id, body.enabled);
      }

      // Return the updated script
      return registry.getScript(req.params.id);
    },
  );

  // -----------------------------------------------------------------------
  // XHR Relay
  // -----------------------------------------------------------------------

  /**
   * POST /xhr -- Execute an HTTP request on behalf of a userscript.
   *
   * This allows GM_xmlhttpRequest to work for cross-origin requests
   * by relaying them through the server.
   */
  fastify.post<{
    Body: {
      method?: string;
      url: string;
      headers?: Record<string, string>;
      data?: string | null;
      timeout?: number;
    };
  }>('/xhr', async (req, reply) => {
    const { method = 'GET', url, headers: reqHeaders, data, timeout = 30000 } = req.body as {
      method?: string;
      url: string;
      headers?: Record<string, string>;
      data?: string | null;
      timeout?: number;
    };

    if (!url) {
      return reply.status(400).send({ error: 'Missing required field: url' });
    }

    try {
      // Build request options
      const abortController = new AbortController();
      const timeoutId = setTimeout(() => abortController.abort(), Math.min(timeout, 60000));

      const response = await request(url, {
        method: method as 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH' | 'HEAD' | 'OPTIONS',
        headers: reqHeaders,
        body: data ?? undefined,
        signal: abortController.signal,
      });

      clearTimeout(timeoutId);

      // Read response body as text
      const chunks: Buffer[] = [];
      for await (const chunk of response.body) {
        chunks.push(Buffer.from(chunk));
      }
      const responseText = Buffer.concat(chunks).toString('utf-8');

      // Convert response headers to a plain object
      const responseHeaders: Record<string, string> = {};
      for (const [key, value] of Object.entries(response.headers)) {
        if (Array.isArray(value)) {
          responseHeaders[key] = value.join(', ');
        } else if (value !== undefined) {
          responseHeaders[key] = String(value);
        }
      }

      return {
        status: response.statusCode,
        statusText: '',
        responseHeaders,
        responseText,
        finalUrl: url,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return reply.status(502).send({
        error: `XHR relay error: ${message}`,
      });
    }
  });

  // -----------------------------------------------------------------------
  // Storage
  // -----------------------------------------------------------------------

  /**
   * GET /storage/:scriptId -- Get all stored key-value pairs for a script.
   */
  fastify.get<{ Params: { scriptId: string } }>(
    '/storage/:scriptId',
    async (req, _reply) => {
      const entries = storageMap.get(req.params.scriptId);
      if (!entries) {
        return {};
      }
      // Convert the inner Map to a plain object
      const result: Record<string, unknown> = {};
      for (const [key, value] of entries) {
        result[key] = value;
      }
      return result;
    },
  );

  /**
   * PUT /storage -- Store a value in server-side memory.
   * Body: { scriptId, key, value }
   */
  fastify.put<{
    Body: { scriptId: string; key: string; value: unknown };
  }>('/storage', async (req, _reply) => {
    const { scriptId, key, value } = req.body as {
      scriptId: string;
      key: string;
      value: unknown;
    };

    if (!storageMap.has(scriptId)) {
      storageMap.set(scriptId, new Map());
    }
    storageMap.get(scriptId)!.set(key, value);

    return { ok: true };
  });

  /**
   * DELETE /storage -- Delete a value from server-side memory.
   * Body: { scriptId, key }
   */
  fastify.delete<{
    Body: { scriptId: string; key: string };
  }>('/storage', async (req, _reply) => {
    const { scriptId, key } = req.body as { scriptId: string; key: string };

    const entries = storageMap.get(scriptId);
    if (entries) {
      entries.delete(key);
    }

    return { ok: true };
  });
};
