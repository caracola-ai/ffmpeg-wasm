import { cp, readFile, writeFile, mkdir, access } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { verify } from './verify.mjs';

// Promotion changes distribution metadata; the compiled library and sources stay identical.
const args = Object.fromEntries(process.argv.slice(2).map(arg => arg.replace(/^--/, '').split('=')));
if (!args.from || !args.output || args['integration-reviewed'] !== 'yes' || args['release-approved'] !== 'yes') {
  throw new Error('Usage: node promote.mjs --from=dist --output=/new/directory --integration-reviewed=yes --release-approved=yes');
}
const source = resolve(args.from), target = resolve(args.output);
if (target === source || target.startsWith(source + '/')) throw new Error('Use a separate release directory');
if (await access(target).then(() => true, () => false)) throw new Error('Release directory already exists');
const { manifest, manifestHash } = await verify(source);
if (manifest.status !== 'candidate') throw new Error('Only a reviewed candidate can be promoted');
const sourceBuildId = manifest.buildId;
const digest = data => createHash('sha256').update(data).digest('hex');
const buildId = sourceBuildId.replace(/[a-f0-9]{16}$/, digest(manifestHash + ':approved').slice(0, 16));
await mkdir(target, { recursive: true });
await cp(source, target, { recursive: true });
const page = await readFile(resolve(target, 'licenses.html'), 'utf8');
await writeFile(resolve(target, 'licenses.html'), page.replaceAll(sourceBuildId, buildId));
manifest.buildId = buildId;
manifest.sourceBuildId = sourceBuildId;
manifest.status = 'approved';
manifest.pendingReleaseGates = [];
for (const name of Object.keys(manifest.files)) {
  const bytes = await readFile(resolve(target, name));
  manifest.files[name] = { sha256: digest(bytes), bytes: bytes.length };
}
await writeFile(resolve(target, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
const names = [...Object.keys(manifest.files), 'manifest.json'].sort();
await writeFile(resolve(target, 'SHA256SUMS'), (await Promise.all(names.map(async name =>
  `${digest(await readFile(resolve(target, name)))}  ${name}\n`))).join(''));
const result = await verify(target);
console.log(JSON.stringify({ buildId, sourceBuildId, manifestHash: result.manifestHash, status: result.manifest.status }, null, 2));
