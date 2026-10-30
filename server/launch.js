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

const initializationOptions = {
  'language_server_worse_reflection.inlay_hints.enable': true,
  'language_server_worse_reflection.inlay_hints.types': true,
  'language_server_worse_reflection.inlay_hints.params': true,
};

function rewriteInitialize(body) {
  let message;
  try {
    message = JSON.parse(body.toString('utf8'));
  } catch {
    return body;
  }
  if (message?.method !== 'initialize') return body;
  message.params = message.params ?? {};
  message.params.initializationOptions = { ...(message.params.initializationOptions ?? {}), ...initializationOptions };
  return Buffer.from(JSON.stringify(message), 'utf8');
}

function forwardClient(input, output) {
  let buffer = Buffer.alloc(0);
  let rewritten = false;
  input.on('data', (chunk) => {
    if (rewritten) {
      output.write(chunk);
      return;
    }
    buffer = Buffer.concat([buffer, chunk]);
    for (;;) {
      const end = buffer.indexOf('\r\n\r\n');
      if (end < 0) return;
      const length = Number(buffer.subarray(0, end).toString('ascii').match(/Content-Length:\s*(\d+)/i)?.[1]);
      if (!Number.isFinite(length)) {
        output.write(buffer);
        buffer = Buffer.alloc(0);
        rewritten = true;
        return;
      }
      if (buffer.length < end + 4 + length) return;
      const original = buffer.subarray(end + 4, end + 4 + length);
      const body = rewriteInitialize(original);
      rewritten = body !== original;
      output.write(`Content-Length: ${body.length}\r\n\r\n`);
      output.write(body);
      buffer = buffer.subarray(end + 4 + length);
      if (rewritten) {
        if (buffer.length) output.write(buffer);
        return;
      }
    }
  });
  input.on('end', () => output.end());
}

try {
  const [command, args] = await resolveCommand();
  const child = spawn(command, args, { stdio: ['pipe', 'inherit', 'inherit'] });
  forwardClient(process.stdin, child.stdin);
  child.stdin.on('error', () => {});
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
