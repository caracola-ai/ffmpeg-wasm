# FFmpeg WASM audio core

A reproducible WebAssembly build of FFmpeg with libopus and zlib, configured
without GPL, nonfree or version3 components. Uses FFmpeg 5.1.4, Opus 1.3.1,
zlib 1.2.11 and Emscripten 3.1.40. Versions and source hashes are pinned in
[versions.json](versions.json).

## Build

Requires Python 3, curl and Docker Buildx:

```sh
bash build.sh
node verify.mjs dist
```

`dist/` contains the JavaScript/WASM pair, configuration, checksums, notices,
licenses and `corresponding-source.tar.gz`. Distribute the corresponding
sources and notices alongside the binaries.

To rebuild from the source archive, extract it, enter `ffmpeg-source/` and
run `bash build.sh`. Docker and its pinned toolchain image remain build
prerequisites. The build uses linux/amd64, including on ARM hosts.

## License and modifications

The build scripts are MIT licensed. The generated core is LGPL-2.1-or-later;
its dependencies retain their respective licenses. Optional upstream source
components may have other licenses; the generated configuration identifies
which are enabled. See the generated `licenses/` directory and `NOTICE.txt`.

To modify the library, edit a source archive and update its hash in
`versions.json`, then rebuild. Preserve the exported `createFFmpegCore` ABI
and use the matching JS/WASM pair. Applications distributing this library
must satisfy the applicable LGPL conditions, including notices, source
availability and the ability to use a compatible modified library.
See [LGPL 2.1](https://opensource.org/license/lgpl-2-1) and
[FFmpeg's guidance](https://ffmpeg.org/legal.html).

## Release promotion

Builds are candidates by default. After reviewing the integration and approving
a release, generate a separate distribution:

```sh
node promote.mjs --from=dist --output=.ffmpeg-work/approved-dist \
  --integration-reviewed=yes --release-approved=yes
node verify.mjs .ffmpeg-work/approved-dist
```

Promotion records approval; it does not perform the review. It gives the
distribution a new ID and updates its manifest and checksums, preserving the
compiled JS/WASM and corresponding source bytes. Publish all files under a new
immutable release tag. Keep the candidate intact. GitHub release assets have
flat filenames; consumers must restore the paths recorded in the manifest.

## Tests

Requires Node 22 or newer and native ffmpeg/ffprobe:

```sh
npm ci
npx playwright install chromium firefox webkit
node tests/fixtures.mjs
node --test tests/distribution.test.mjs
node tests/compare.mjs --baseline=/path/to/reference --browser=chromium --repetitions=3
```

The comparison reference is the public npm package `@ffmpeg/core@0.12.9`;
both JS and WASM hashes are checked. Tests use generated media, compare
decoded PCM and check errors and recovery. Downloaded references, generated
fixtures and test outputs are excluded from Git.

To check reproducibility, build a second time with
`docker buildx build --no-cache-filter compiler` and compare artifact hashes.
