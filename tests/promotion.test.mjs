import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync, spawnSync } from 'node:child_process';
import { verify } from '../verify.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
test('promotion preserves the candidate and library, requires approval, and never overwrites a release', async () => {
  const temporary = await mkdtemp(join(tmpdir(), 'ffmpeg-promotion-'));
  const source = join(root, 'dist'), target = join(temporary, 'approved');
  const original = await readFile(join(source, 'manifest.json'));
  const command = [join(root, 'promote.mjs'), `--from=${source}`, `--output=${target}`];
  try {
    assert.notEqual(spawnSync(process.execPath, command).status, 0);
    execFileSync(process.execPath, [...command, '--integration-reviewed=yes', '--release-approved=yes']);
    const approved = await verify(target);
    const candidate = await verify(source);
    assert.equal(approved.manifest.status, 'approved');
    assert.deepEqual(approved.manifest.pendingReleaseGates, []);
    assert.notEqual(approved.manifest.buildId, candidate.manifest.buildId);
    assert.equal(approved.manifest.sourceBuildId, candidate.manifest.buildId);
    for (const name of ['ffmpeg-core.js', 'ffmpeg-core.wasm', 'corresponding-source.tar.gz']) {
      assert.deepEqual(await readFile(join(source, name)), await readFile(join(target, name)));
    }
    assert.deepEqual(await readFile(join(source, 'manifest.json')), original);
    assert.notEqual(spawnSync(process.execPath, [...command, '--integration-reviewed=yes', '--release-approved=yes']).status, 0);
  } finally { await rm(temporary, { recursive: true, force: true }); }
});
