// Shared by launch.js and module.js: locating and downloading Phpactor.
import { createWriteStream } from 'node:fs';
import { access, mkdir, rename, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

export const PHAR_URL = 'https://github.com/phpactor/phpactor/releases/latest/download/phpactor.phar';

export function pharPath(storage) {
  return join(storage, 'phpactor', 'phpactor.phar');
}

export async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

// Downloads the latest phpactor.phar into storage, replacing any existing copy.
export async function installPhpactor(storage) {
  const target = pharPath(storage);
  await mkdir(join(storage, 'phpactor'), { recursive: true });
  const response = await fetch(PHAR_URL, { redirect: 'follow' });
  if (!response.ok) throw new Error(`Downloading Phpactor failed: HTTP ${response.status}`);
  const partial = `${target}.partial`;
  try {
    await pipeline(Readable.fromWeb(response.body), createWriteStream(partial));
    await rename(partial, target);
  } finally {
    await rm(partial, { force: true });
  }
  return target;
}
