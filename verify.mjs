import { createHash } from 'node:crypto';
import { readFile, readdir, lstat } from 'node:fs/promises';
import { resolve, relative, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

export async function verify(directory, expectedManifestHash) {
  const root = resolve(directory);
  const bytes = await readFile(resolve(root, 'manifest.json'));
  const manifestHash = createHash('sha256').update(bytes).digest('hex');
  if (expectedManifestHash && manifestHash !== expectedManifestHash) throw new Error('Manifest hash mismatch');
  const manifest = JSON.parse(bytes);
  if (manifest.schema !== 1 || manifest.license !== 'LGPL-2.1-or-later' || !/^ffmpeg-5\.1\.4-lgpl-[a-f0-9]{16}$/.test(manifest.buildId)) {
    throw new Error('Unsupported core manifest');
  }
  const required = ['ffmpeg-core.js', 'ffmpeg-core.wasm', 'corresponding-source.tar.gz', 'NOTICE.txt',
    'README.md', 'licenses.html', 'config.h', 'licenses/FFmpeg-LGPL-2.1.txt',
    'licenses/Opus-COPYING.txt', 'licenses/ffmpegwasm-MIT.txt', 'licenses/Emscripten-LICENSE.txt',
    'licenses/musl-COPYRIGHT.txt', 'licenses/compiler-rt-LICENSE.txt', 'licenses/zlib-README.txt'];
  for (const name of required) if (!manifest.files[name]) throw new Error(`Missing required artifact: ${name}`);
  for (const [name, entry] of Object.entries(manifest.files)) {
    const path = resolve(root, name);
    if (relative(root, path).startsWith('..' + sep) || path === root || name.includes('\\') || name.split('/').some(part => !part || part === '.' || part === '..')) throw new Error('Invalid artifact path');
    // Every path component must be a real file/directory, never an escaping symlink.
    let cursor = root;
    for (const part of name.split('/')) {
      cursor = resolve(cursor, part);
      if ((await lstat(cursor)).isSymbolicLink()) throw new Error(`Symlink artifact: ${name}`);
    }
    const data = await readFile(path);
    if (data.length !== entry.bytes || createHash('sha256').update(data).digest('hex') !== entry.sha256) throw new Error(`Artifact hash mismatch: ${name}`);
  }
  async function walk(dir) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const p = resolve(dir, entry.name);
      const name = relative(root, p).split(sep).join('/');
      if (entry.isSymbolicLink()) throw new Error(`Unexpected symlink: ${name}`);
      if (entry.isDirectory()) await walk(p);
      else if (!['manifest.json', 'SHA256SUMS'].includes(name) && !manifest.files[name]) throw new Error(`Unmanifested file: ${name}`);
    }
  }
  await walk(root);
  const config = await readFile(resolve(root, 'config.h'), 'utf8');
  for (const key of ['GPL', 'NONFREE', 'VERSION3']) {
    if (!new RegExp(`^#define CONFIG_${key} 0$`, 'm').test(config)) throw new Error(`Forbidden license setting: ${key}`);
  }
  return { manifest, manifestHash };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { manifest, manifestHash } = await verify(process.argv[2] || 'dist', process.argv[3]);
  console.log(JSON.stringify({ buildId: manifest.buildId, manifestHash, status: manifest.status }, null, 2));
}
