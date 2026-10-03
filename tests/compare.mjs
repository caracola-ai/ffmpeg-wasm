import { chromium, firefox, webkit } from 'playwright';
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve, join, extname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { verify } from '../verify.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const args = Object.fromEntries(process.argv.slice(2).map(v => v.replace(/^--/, '').split('=')));
if (!args.baseline) throw new Error('Usage: npm run compare -- --baseline=/path/to/baseline [--browser=chromium|firefox|webkit] [--large=1] [--repetitions=3]');
const baseline = resolve(args.baseline);
const candidate = resolve(args.candidate || join(root, 'dist'));
const referenceOnly = args['reference-only'] === '1';
const { manifest, manifestHash } = referenceOnly
  ? { manifest: { buildId: 'reference-only', provenance: JSON.parse(await readFile(join(root, 'versions.json'))) }, manifestHash: null }
  : await verify(candidate);
const hash = data => createHash('sha256').update(data).digest('hex');
async function deadline(promise, ms, label) {
  let timer;
  try {
    return await Promise.race([promise, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`Timeout: ${label}`)), ms);
    })]);
  } finally { clearTimeout(timer); }
}
const baselineHash = hash(await readFile(join(baseline, 'ffmpeg-core.wasm')));
if (baselineHash !== manifest.provenance.baseline.wasmSha256) throw new Error('Unexpected baseline binary');
if (hash(await readFile(join(baseline, 'ffmpeg-core.js'))) !== '67a48f11645f85439f3fde4f2119042c16b374b910206b7a7a24f342e28dcae3') throw new Error('Unexpected baseline JavaScript');
const browserName = args.browser || 'chromium';
const repetitions = Number(args.repetitions || 1);
if (!Number.isInteger(repetitions) || repetitions < 1) throw new Error('Invalid repetitions');
const output = resolve(args.output || join(root, 'test-results', `${referenceOnly ? 'reference-' : ''}${browserName}-${args.large ? 'large' : 'standard'}`));
await mkdir(output, { recursive: true });
const corpus = JSON.parse(await readFile(join(root, 'tests/fixtures/manifest.json')));
const fixtures = corpus.filter(row => args.large ? row.group === 'large' : row.group === 'standard');
// A successful conversion after invalid files verifies recovery in the same Worker.
if (!args.large) fixtures.push({ ...corpus.find(row => row.name === 'stereo.wav'), recovery: true });
const roots = { baseline, candidate, wrapper: join(root, 'node_modules/@ffmpeg/ffmpeg/dist/esm'), fixtures: join(root, 'tests/fixtures') };
let destination;
const server = createServer(async (req, res) => {
  try {
    const path = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    if (req.method === 'POST' && path === '/result') {
      const parts = []; let size = 0;
      for await (const part of req) { size += part.length; if (size > 128 * 1024 * 1024) throw new Error('Result too large'); parts.push(part); }
      await writeFile(destination, Buffer.concat(parts)); res.end('ok'); return;
    }
    let file;
    if (path === '/') file = join(root, 'tests/harness.html');
    else {
      const [, mount, ...rest] = path.split('/');
      if (!roots[mount]) { res.writeHead(404).end(); return; }
      file = resolve(roots[mount], rest.join('/'));
      if (relative(roots[mount], file).startsWith('..')) throw new Error('Invalid path');
    }
    const content = await readFile(file);
    const type = { '.js': 'application/javascript', '.wasm': 'application/wasm', '.html': 'text/html', '.json': 'application/json' }[extname(file)] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-store' }).end(content);
  } catch (error) { res.writeHead(500).end(String(error)); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const url = `http://127.0.0.1:${server.address().port}`;
const report = { buildId: manifest.buildId, manifestHash, baselineHash, browser: browserName,
  repetitions, referenceOnly, generatedAt: new Date().toISOString(), cases: [], failures: [],
  limitations: ['Desktop automation is not physical mobile validation.', 'Heap measurements are not total WASM memory.',
    'Synthetic audio is not a speech-quality or end-to-end transcription assessment.'] };
let browser;
try {
  browser = await ({ chromium, firefox, webkit }[browserName]).launch({ headless: true });
  report.browserVersion = browser.version();
  for (let rep = 0; rep < repetitions; rep++) {
    for (const variant of referenceOnly ? ['baseline'] : rep % 2 ? ['candidate', 'baseline'] : ['baseline', 'candidate']) {
      const context = await browser.newContext();
      const page = await context.newPage();
      page.setDefaultTimeout(120000);
      await page.goto(url); await page.waitForFunction(() => window.ready);
      const loadMs = await deadline(page.evaluate(v => window.loadCore(v), variant), 120000, `load ${variant}`);
      const license = await page.evaluate(() => window.coreLicense);
      if (variant === 'candidate' && !license.replace(/\s+/g, ' ').includes('GNU Lesser General Public License')) throw new Error('Core runtime does not report LGPL: ' + license);
      report[`${variant}License`] = license;
      for (let index = 0; index < fixtures.length; index++) {
        const fixture = fixtures[index];
        const id = `${rep}-${index}-${fixture.name}`;
        destination = join(output, `${variant}-${id}.ogg`);
        const result = await deadline(page.evaluate(name => window.convert(name), fixture.name), 180000, `convert ${id}`);
        const row = { id, variant, fixture, repetition: rep, loadMs, ...result };
        if (result.ok) {
          const pcm = execFileSync(process.env.FFMPEG || 'ffmpeg', ['-v', 'error', '-i', destination, '-f', 's16le', '-ac', '1', '-ar', '48000', '-'], { maxBuffer: 128 * 1024 * 1024 });
          row.pcmHash = hash(pcm); row.samples = pcm.length / 2; row.duration = row.samples / 48000;
          row.streams = JSON.parse(execFileSync(process.env.FFPROBE || 'ffprobe', ['-v', 'error', '-show_streams', '-of', 'json', destination])).streams;
        }
        report.cases.push(row);
        if (row.ok !== (fixture.expected === 'success')) report.failures.push(`${variant} ${id}: unexpected success/failure`);
        console.log(`${browserName} ${variant} ${id}: ${result.ok ? 'OK' : 'ERROR'} ${Math.round(result.ms)} ms`);
      }
      await context.close();
    }
  }
  for (const base of report.cases.filter(row => row.variant === 'baseline')) {
    if (referenceOnly) continue;
    const next = report.cases.find(row => row.variant === 'candidate' && row.id === base.id);
    const expected = base.fixture.expected === 'success';
    if (base.ok !== expected || next.ok !== expected) report.failures.push(`${base.id}: unexpected success/failure`);
    if (base.ok && next.ok) {
      if (base.pcmHash !== next.pcmHash) report.failures.push(`${base.id}: decoded audio differs`);
      if (next.bytes > base.bytes * 1.05) report.failures.push(`${base.id}: output grows more than 5%`);
      if (next.streams.length !== 1 || next.streams[0].codec_name !== 'opus' || next.streams[0].channels !== 1) report.failures.push(`${base.id}: wrong output format`);
    }
  }
  report.performance = [];
  const median = values => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
  for (const fixture of fixtures.filter(f => !f.recovery && f.expected === 'success')) {
    if (referenceOnly) continue;
    const timings = variant => report.cases.filter(row => row.variant === variant && row.fixture.name === fixture.name && !row.fixture.recovery && row.ok).map(row => row.ms);
    const ratio = median(timings('candidate')) / median(timings('baseline'));
    report.performance.push({ fixture: fixture.name, ratio, evaluated: repetitions >= 3 });
    if (repetitions >= 3 && ratio > 1.10) report.failures.push(`${fixture.name}: median runtime regression ${(100 * (ratio - 1)).toFixed(1)}%`);
  }
} catch (error) { report.failures.push(String(error)); }
finally {
  await browser?.close(); await new Promise(resolve => server.close(resolve));
  await writeFile(join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n');
}
console.log(JSON.stringify({ report: join(output, 'report.json'), cases: report.cases.length, failures: report.failures }));
if (report.failures.length) process.exitCode = 1;
