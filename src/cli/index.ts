#!/usr/bin/env node
/**
 * CLI Entry Point
 *
 * Parses command-line arguments, prints a startup banner, creates
 * and starts the dev server, and handles graceful shutdown.
 */

import { createProgram } from './commands.js';
import { createServer } from '../server/index.js';
import pc from 'picocolors';
import type { DevServerConfig } from '../core/types.js';

// ---------------------------------------------------------------------------
// Banner
// ---------------------------------------------------------------------------

function printBanner(config: DevServerConfig): void {
  console.log('');
  console.log(pc.bold(pc.cyan('  [tmdev] TamperMonkey Dev Testing Service')));
  console.log(pc.gray('  ─────────────────────────────────────────'));
  console.log(`  ${pc.green('>')} Server:     ${pc.bold(`http://${config.host}:${config.port}`)}`);
  console.log(`  ${pc.green('>')} Dashboard:  ${pc.bold(`http://${config.host}:${config.port}/__tmdev__/`)}`);
  console.log(`  ${pc.green('>')} Scripts:    ${pc.bold(config.scriptsDir)}`);
  console.log(`  ${pc.green('>')} Verbose:    ${config.verbose ? pc.yellow('on') : pc.gray('off')}`);
  console.log(pc.gray('  ─────────────────────────────────────────'));
  console.log('');
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const program = createProgram();
  program.parse(process.argv);

  // Retrieve parsed options set by the serve command action
  const serveOpts = program.getOptionValue('__serveOpts') as DevServerConfig | undefined;

  // Defaults if no command matched (shouldn't happen with isDefault: true)
  const config: DevServerConfig = serveOpts ?? {
    port: 8432,
    host: '127.0.0.1',
    scriptsDir: './scripts',
    open: false,
    verbose: false,
  };

  printBanner(config);

  // Create and start the server
  const server = await createServer(config);

  // Graceful shutdown handler
  let isShuttingDown = false;

  async function shutdown(): Promise<void> {
    if (isShuttingDown) return;
    isShuttingDown = true;

    console.log('');
    console.log(pc.yellow('  [tmdev] Shutting down...'));

    try {
      await server.stop();
      console.log(pc.green('  [tmdev] Server stopped.'));
    } catch (err) {
      console.error(pc.red(`  [tmdev] Error during shutdown: ${(err as Error).message}`));
    }

    process.exit(0);
  }

  process.on('SIGINT', () => void shutdown());
  process.on('SIGTERM', () => void shutdown());

  try {
    await server.start();
    console.log(pc.green(`  [tmdev] Server listening on http://${config.host}:${config.port}`));
    console.log(pc.gray('  Press Ctrl+C to stop.'));
    console.log('');

    // Optionally open the dashboard in the default browser
    if (config.open) {
      const url = `http://${config.host}:${config.port}/__tmdev__/`;
      try {
        // Dynamic import to avoid issues on systems without `open`
        const { exec } = await import('node:child_process');
        const openCmd =
          process.platform === 'win32'
            ? `start "" "${url}"`
            : process.platform === 'darwin'
              ? `open "${url}"`
              : `xdg-open "${url}"`;
        exec(openCmd);
      } catch {
        console.log(pc.gray(`  Open the dashboard manually: ${url}`));
      }
    }
  } catch (err) {
    console.error(pc.red(`  [tmdev] Failed to start server: ${(err as Error).message}`));
    process.exit(1);
  }
}

// Run
main().catch((err: unknown) => {
  console.error(pc.red(`  [tmdev] Fatal error: ${(err as Error).message}`));
  process.exit(1);
});
