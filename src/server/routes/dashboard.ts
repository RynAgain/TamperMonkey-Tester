/**
 * Dashboard Static Routes
 *
 * Serves the dashboard SPA files (index.html, app.js, styles.css)
 * from the `src/dashboard/` directory during development.
 */

import { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// ---------------------------------------------------------------------------
// Resolve dashboard directory
// ---------------------------------------------------------------------------

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Resolve the dashboard directory.
 * In dev mode the source lives in `src/dashboard/`, in production it would
 * be at `dist/dashboard/`.  We check for the source directory first.
 */
function getDashboardDir(): string {
  // Walk up from dist/server/routes/ or src/server/routes/ to project root
  const projectRoot = resolve(__dirname, '..', '..', '..');
  return resolve(projectRoot, 'src', 'dashboard');
}

// ---------------------------------------------------------------------------
// Content-type map
// ---------------------------------------------------------------------------

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.ts': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
};

// ---------------------------------------------------------------------------
// Plugin
// ---------------------------------------------------------------------------

/**
 * Fastify plugin that serves dashboard static assets.
 *
 * Expected to be registered with prefix `/__tmdev__`.
 */
export const dashboardRoutes: FastifyPluginAsync = async (
  fastify: FastifyInstance,
) => {
  const dashboardDir = getDashboardDir();

  /**
   * GET / -- Serves the dashboard index.html
   */
  fastify.get('/', async (_request, reply) => {
    return serveFile(reply, resolve(dashboardDir, 'index.html'), '.html');
  });

  /**
   * GET /app.js -- Serves the dashboard application JS.
   * Note: The source file is app.ts but browsers expect .js.
   * Serve the .ts source for now; a build step will produce real .js later.
   */
  fastify.get('/app.js', async (_request, reply) => {
    return serveFile(reply, resolve(dashboardDir, 'app.ts'), '.js');
  });

  /**
   * GET /styles.css -- Serves the dashboard CSS.
   */
  fastify.get('/styles.css', async (_request, reply) => {
    return serveFile(reply, resolve(dashboardDir, 'styles.css'), '.css');
  });
};

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

/**
 * Read a file from disk and send it with the appropriate content-type header.
 */
async function serveFile(
  reply: import('fastify').FastifyReply,
  filePath: string,
  ext: string,
): Promise<void> {
  try {
    const content = await readFile(filePath, 'utf-8');
    const contentType = CONTENT_TYPES[ext] ?? 'application/octet-stream';
    void reply.type(contentType).send(content);
  } catch {
    void reply.status(404).send({ error: 'File not found' });
  }
}
