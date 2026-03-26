/**
 * CLI Command Definitions
 *
 * Defines the `serve` command (default) and its options using Commander.
 */

import { Command } from 'commander';

// ---------------------------------------------------------------------------
// createProgram
// ---------------------------------------------------------------------------

/**
 * Create and configure the Commander program with the `serve` command.
 *
 * @returns A configured Commander {@link Command} instance.
 */
export function createProgram(): Command {
  const program = new Command();

  program
    .name('tmdev')
    .description('TamperMonkey Dev Testing Service -- local userscript development proxy')
    .version('0.1.0');

  program
    .command('serve', { isDefault: true })
    .description('Start the development proxy server')
    .option('-p, --port <number>', 'Port number to listen on', '8432')
    .option('-H, --host <string>', 'Host to bind the server to', '127.0.0.1')
    .option('-d, --dir <path>', 'Scripts directory to watch', './scripts')
    .option('-o, --open', 'Open the dashboard in the default browser', false)
    .option('-v, --verbose', 'Enable verbose logging output', false)
    .action((opts: { port: string; host: string; dir: string; open: boolean; verbose: boolean }) => {
      // Store parsed options on the program for the CLI entry point to read
      program.setOptionValue('__serveOpts', {
        port: parseInt(opts.port, 10),
        host: opts.host,
        scriptsDir: opts.dir,
        open: opts.open,
        verbose: opts.verbose,
      });
    });

  return program;
}
