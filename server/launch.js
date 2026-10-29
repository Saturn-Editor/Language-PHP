// Starts the PHP language server (Phpactor) over stdio for Saturn.
// argv[2] is the "serverPath" setting: empty for the managed phpactor.phar,
// otherwise a .phar or a phpactor executable chosen by the user.
import { spawn } from 'node:child_process';
import { exists, installPhpactor, pharPath } from './phpactor.js';
import { readChoices } from './versions.js';

const custom = (process.argv[2] ?? '').trim();
const storage = process.env.SATURN_MODULE_STORAGE;

async function resolveCommand() {
  // Saturn runs the server in the project folder; use that project's chosen PHP.
  const php = (storage && (await readChoices(storage))[process.cwd()]) || 'php';
  if (custom) {
    return custom.toLowerCase().endsWith('.phar')
      ? [php, [custom, 'language-server']]
      : [custom, ['language-server']];
  }
  if (!storage) throw new Error('SATURN_MODULE_STORAGE is not set; set the "Language server" path in settings.');
  let phar = pharPath(storage);
  if (!(await exists(phar))) {
    // stdout belongs to LSP, so progress goes to stderr.
    process.stderr.write('Phpactor not found, downloading it...\n');
    phar = await installPhpactor(storage);
  }
  return [php, [phar, 'language-server']];
}

try {
  const [command, args] = await resolveCommand();
  const child = spawn(command, args, { stdio: 'inherit' });
  child.on('error', (error) => {
    process.stderr.write(`Failed to start ${command}: ${error.message}\n`);
    process.exit(1);
  });
  child.on('exit', (code, signal) => process.exit(signal ? 1 : (code ?? 0)));
  for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, () => child.kill(sig));
} catch (error) {
  process.stderr.write(`${error.message}\n`);
  process.exit(1);
}
