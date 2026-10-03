import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { deflateSync } from 'node:zlib';

const dir = fileURLToPath(new URL('./fixtures/', import.meta.url));
mkdirSync(dir, { recursive: true });
const ffmpeg = process.env.FFMPEG || 'ffmpeg';
const signal = 'aevalsrc=0.3*sin(2*PI*(220+80*sin(2*PI*t/3))*t)|0.25*sin(2*PI*440*t):s=48000:d=8';
const rows = [];
function make(name, inputs, output, expected = 'success', group = 'standard') {
  execFileSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', ...inputs, ...output, join(dir, name)]);
  rows.push({ name, expected, group });
}
const input = ['-f', 'lavfi', '-i', signal];
make('stereo.wav', input, ['-c:a', 'pcm_s16le']);
make('mono-44100.wav', input, ['-ac', '1', '-ar', '44100', '-c:a', 'pcm_s16le']);
make('vbr.mp3', input, ['-c:a', 'libmp3lame', '-q:a', '4']);
make('audio.m4a', input, ['-c:a', 'aac', '-b:a', '96k']);
make('audio.webm', input, ['-c:a', 'libopus', '-b:a', '64k']);
make('audio.ogg', input, ['-c:a', 'vorbis', '-strict', '-2', '-q:a', '4']);
make('audio.flac', input, ['-c:a', 'flac']);
make('audio.aiff', input, ['-c:a', 'pcm_s16be']);
make('audio.wma', input, ['-c:a', 'wmav2']);
make('silence.wav', ['-f', 'lavfi', '-i', 'anullsrc=r=16000:cl=mono', '-t', '5'], ['-c:a', 'pcm_s16le']);
make('video.mp4', ['-f', 'lavfi', '-i', 'color=c=black:s=64x64:r=5:d=8', ...input], ['-c:v', 'mpeg4', '-c:a', 'aac', '-shortest']);
// QuickTime's cmov header compression requires zlib even when video is discarded.
const atom = (type, payload) => {
  const header = Buffer.alloc(8); header.writeUInt32BE(payload.length + 8); header.write(type, 4);
  return Buffer.concat([header, payload]);
};
const mp4 = readFileSync(join(dir, 'video.mp4'));
const atoms = [];
for (let offset = 0; offset < mp4.length;) {
  const size = mp4.readUInt32BE(offset);
  if (size < 8 || offset + size > mp4.length) throw new Error('Unexpected fixture atom');
  const original = mp4.subarray(offset, offset + size);
  if (original.toString('ascii', 4, 8) === 'moov') {
    if (offset + size !== mp4.length) throw new Error('Compressed-header fixture requires moov at end');
    const payload = original.subarray(8);
    const length = Buffer.alloc(4); length.writeUInt32BE(payload.length);
    atoms.push(atom('moov', atom('cmov', Buffer.concat([
      atom('dcom', Buffer.from('zlib')), atom('cmvd', Buffer.concat([length, deflateSync(payload)]))
    ]))));
  } else atoms.push(original);
  offset += size;
}
writeFileSync(join(dir, 'compressed-header.mov'), Buffer.concat(atoms));
rows.push({ name: 'compressed-header.mov', expected: 'success', group: 'standard' });
make('multiple-tracks.mp4', [...input, '-f', 'lavfi', '-i', 'sine=frequency=1200:duration=8'], ['-map', '0:a', '-map', '1:a', '-c:a', 'aac']);
make('no-audio.mp4', ['-f', 'lavfi', '-i', 'color=c=black:s=64x64:r=5:d=2'], ['-c:v', 'mpeg4'], 'error');
for (const [name, data] of [['empty.wav', Buffer.alloc(0)], ['corrupt.mp4', Buffer.from('invalid container')]]) {
  writeFileSync(join(dir, name), data); rows.push({ name, expected: 'error', group: 'standard' });
}
// Synthetic large files exercise memory and conversion across several sizes.
for (const threshold of [16, 96]) {
  for (const delta of [-1, 1]) {
    const size = threshold * 1024 * 1024 + delta * 1024;
    const duration = (size - 44) / (48000 * 2 * 2);
    make(`large-${threshold}-${delta < 0 ? 'below' : 'above'}.wav`,
      ['-f', 'lavfi', '-i', `sine=frequency=330:sample_rate=48000:duration=${duration}`],
      ['-ac', '2', '-c:a', 'pcm_s16le'], 'success', 'large');
  }
}
for (const row of rows) {
  const bytes = readFileSync(join(dir, row.name));
  row.bytes = bytes.length; row.sha256 = createHash('sha256').update(bytes).digest('hex');
}
writeFileSync(join(dir, 'manifest.json'), JSON.stringify(rows, null, 2) + '\n');
console.log(`Generated ${rows.length} synthetic fixtures in ${dir}`);
