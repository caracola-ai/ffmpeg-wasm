import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, cp, rm, writeFile, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { verify } from '../verify.mjs';

const source = fileURLToPath(new URL('../dist/', import.meta.url));
test('rejects corruption, missing legal materials and extra unmanifested files', async () => {
  const tmp = await mkdtemp(join(tmpdir(), 'ffmpeg-distribution-'));
  try {
    const original = await verify(source);
    await cp(source, tmp, { recursive: true });
    await verify(tmp, original.manifestHash);
    await assert.rejects(verify(tmp, '0'.repeat(64)), /Manifest hash mismatch/);
    await writeFile(join(tmp, 'ffmpeg-core.wasm'), 'corrupt');
    await assert.rejects(verify(tmp), /Artifact hash mismatch/);
    await cp(join(source, 'ffmpeg-core.wasm'), join(tmp, 'ffmpeg-core.wasm'));
    await writeFile(join(tmp, 'unexpected.js'), 'unreviewed');
    await assert.rejects(verify(tmp), /Unmanifested file/);
    await unlink(join(tmp, 'unexpected.js'));
    await unlink(join(tmp, 'corresponding-source.tar.gz'));
    await assert.rejects(verify(tmp), /ENOENT/);
  } finally { await rm(tmp, { recursive: true, force: true }); }
});
