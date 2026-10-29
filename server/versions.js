// Finds installed PHP binaries and remembers each project's chosen one.
// The choice is mirrored into storage so launch.js (a separate process) can read it.
import { execFile } from 'node:child_process';
import { readdir, readFile, realpath, writeFile } from 'node:fs/promises';
import { delimiter, join } from 'node:path';
import { promisify } from 'node:util';
import { exists } from './phpactor.js';

const run = promisify(execFile);
const EXE = process.platform === 'win32' ? 'php.exe' : 'php';

export async function describePhp(binary) {
  try {
    const { stdout } = await run(binary, ['-r', 'echo PHP_VERSION;'], { timeout: 5000 });
    const version = stdout.trim();
    return /^\d+\.\d+/.test(version) ? { id: binary, label: version.match(/^\d+\.\d+/)[0], detail: `${version} · ${binary}` } : null;
  } catch {
    return null;
  }
}

async function candidates() {
  const found = new Set();
  for (const dir of (process.env.PATH ?? '').split(delimiter)) if (dir) found.add(join(dir, EXE));
  const versioned = ['/opt/homebrew/opt', '/usr/local/opt'];
  for (const root of versioned) {
    try {
      for (const name of await readdir(root)) if (/^php(@[\d.]+)?$/.test(name)) found.add(join(root, name, 'bin', 'php'));
    } catch {}
  }
  for (const dir of ['/usr/bin', '/usr/local/bin']) {
    try {
      for (const name of await readdir(dir)) if (/^php\d+(\.\d+)?$/.test(name)) found.add(join(dir, name));
    } catch {}
  }
  return [...found];
}

export async function listPhpVersions() {
  const seen = new Set();
  const versions = [];
  for (const path of await candidates()) {
    if (!(await exists(path))) continue;
    const real = await realpath(path).catch(() => path);
    if (seen.has(real)) continue;
    seen.add(real);
    const info = await describePhp(path);
    if (info) versions.push(info);
  }
  return versions.sort((a, b) => b.label.localeCompare(a.label, undefined, { numeric: true }));
}

// Accepts a folder containing php, or bin/php beneath it.
export async function phpInFolder(folder) {
  for (const path of [join(folder, EXE), join(folder, 'bin', EXE)]) {
    if (await exists(path)) return describePhp(path);
  }
  return null;
}

function choicesFile(storage) {
  return join(storage, 'php-versions.json');
}

export async function readChoices(storage) {
  try {
    return JSON.parse(await readFile(choicesFile(storage), 'utf8'));
  } catch {
    return {};
  }
}

export async function saveChoice(storage, projectPath, binary) {
  const choices = await readChoices(storage);
  if (binary) choices[projectPath] = binary;
  else delete choices[projectPath];
  await writeFile(choicesFile(storage), JSON.stringify(choices, null, 2));
}
