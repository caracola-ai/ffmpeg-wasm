#!/usr/bin/env python3
"""Export one atomic, self-contained core and corresponding-source release."""
import gzip
import hashlib
import html
import io
import json
import shutil
from pathlib import Path
import tarfile

ROOT = Path('/recipe')
OUT = Path('/output')
lock = json.loads((ROOT / 'versions.json').read_text())
epoch = lock['sourceDateEpoch']
emscripten = Path('/emsdk/upstream/emscripten')
for source, name in [
    ('system/lib/libc/musl/COPYRIGHT', 'musl-COPYRIGHT.txt'),
    ('system/lib/compiler-rt/LICENSE.TXT', 'compiler-rt-LICENSE.txt'),
    ('AUTHORS', 'Emscripten-AUTHORS.txt'),
]:
    shutil.copyfile(emscripten / source, OUT / 'licenses' / name)

def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()

# Source archives are the original verified archives, not generated object files.
# All overrides of upstream build scripts are included as the recipe.
with (OUT / 'corresponding-source.tar.gz').open('wb') as stream:
    with gzip.GzipFile(filename='', mode='wb', fileobj=stream, mtime=0) as gz:
        with tarfile.open(fileobj=gz, mode='w') as tar:
            files = [p for p in ROOT.iterdir() if p.is_file()] + list((ROOT / 'sources').glob('*.tar.gz'))
            entries = [('ffmpeg-source/' + str(p.relative_to(ROOT)), p) for p in files]
            # Include the actual linked runtime sources from the pinned compiler
            # image, including libc, builtins and JavaScript runtime glue.
            for tree in ('system', 'src'):
                entries.extend(('ffmpeg-source/toolchain-runtime/' + str(p.relative_to(emscripten)), p)
                               for p in (emscripten / tree).rglob('*') if p.is_file())
            for name, p in sorted(entries):
                info = tarfile.TarInfo(name)
                data = p.read_bytes()
                info.size, info.mtime, info.mode = len(data), epoch, 0o644
                tar.addfile(info, io.BytesIO(data))

configuration = (OUT / 'config.h').read_text()
for flag in ('GPL', 'NONFREE', 'VERSION3'):
    if f'#define CONFIG_{flag} 0' not in configuration:
        raise SystemExit(f'Unexpected license configuration: {flag}')
identity = ''.join(sha(OUT / p) for p in ('ffmpeg-core.js', 'ffmpeg-core.wasm', 'corresponding-source.tar.gz'))
build_id = 'ffmpeg-5.1.4-lgpl-' + hashlib.sha256(identity.encode()).hexdigest()[:16]

notice = """FFmpeg WASM audio core

This core uses FFmpeg 5.1.4 under LGPL-2.1-or-later, libopus 1.3.1 under
its BSD license and accompanying notices, zlib 1.2.11 under the zlib license,
ffmpeg.wasm MIT bindings and LGPL fftools, and the Emscripten runtime under
its accompanying licenses. See licenses/ and corresponding-source.tar.gz.

GPL, nonfree, version3 and postproc components are disabled. libopus and
zlib are the external libraries enabled in this build. Built-in FFmpeg
filters, demuxers and decoders are retained.

The source archive contains the original source archives, pinned revisions,
complete build recipe and runtime sources from the pinned Emscripten image.
All changes to upstream build settings are expressed in compile.sh and
Dockerfile. See README.md for rebuilding and modifying this library.

Applications using this library must preserve its applicable LGPL rights,
including modification and reverse engineering for debugging modifications,
and provide the required notices, sources and replacement/relinking materials.

This software is provided without warranty; see the included licenses.
"""
(OUT / 'NOTICE.txt').write_text(notice)
(OUT / 'README.md').write_bytes((ROOT / 'README.md').read_bytes())
links = [('corresponding-source.tar.gz', 'Complete corresponding source'),
         ('README.md', 'Build and replacement instructions'), ('NOTICE.txt', 'Copyright and license notices')]
links += [(str(p.relative_to(OUT)), p.name) for p in sorted((OUT / 'licenses').iterdir())]
items = ''.join(f'<li><a href="{html.escape(path)}">{html.escape(title)}</a></li>' for path, title in links)
(OUT / 'licenses.html').write_text('<!doctype html><html lang="en"><meta charset="utf-8">'
    '<meta name="viewport" content="width=device-width"><title>FFmpeg licenses and source</title>'
    '<h1>FFmpeg licenses and source</h1><p>This core uses FFmpeg under LGPL-2.1-or-later.</p>'
    f'<p>Build: {build_id}</p><ul>{items}</ul><pre>{html.escape(notice)}</pre></html>')
files = {str(p.relative_to(OUT)): {'sha256': sha(p), 'bytes': p.stat().st_size}
         for p in sorted(OUT.rglob('*')) if p.is_file()}
manifest = {'schema': 1, 'buildId': build_id, 'license': 'LGPL-2.1-or-later',
            'status': 'candidate', 'files': files, 'provenance': lock,
            'configuration': configuration,
            'pendingReleaseGates': ['integration license review', 'release approval']}
(OUT / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
(OUT / 'SHA256SUMS').write_text(''.join(f'{sha(p)}  {p.relative_to(OUT)}\n'
    for p in sorted(OUT.rglob('*')) if p.is_file() and p.name != 'SHA256SUMS'))
print(f'Packaged {build_id}')
