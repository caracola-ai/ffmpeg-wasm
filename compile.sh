#!/usr/bin/env bash
set -euo pipefail
trap 'test ! -f /build/ffmpeg/ffbuild/config.log || tail -60 /build/ffmpeg/ffbuild/config.log' ERR
mkdir -p /build/{ffmpeg,opus,ffmpegwasm,zlib} /output/licenses
for name in ffmpeg opus ffmpegwasm zlib; do
  tar -xzf "/recipe/sources/$name.tar.gz" --strip-components=1 -C "/build/$name"
done
cd /build/opus
emconfigure ./autogen.sh
emconfigure ./configure --prefix="$INSTALL_DIR" --host=i686-none --enable-shared=no \
  --disable-asm --disable-rtcd --disable-intrinsics --disable-doc \
  --disable-extra-programs --disable-stack-protector
emmake make -j4 install
cd /build/zlib
emcmake cmake -S . -B build -DCMAKE_INSTALL_PREFIX="$INSTALL_DIR" \
  -DCMAKE_C_FLAGS="$CFLAGS" -DBUILD_SHARED_LIBS=OFF -DSKIP_INSTALL_FILES=ON
emmake make -C build -j4 install
cd /build/ffmpeg
emconfigure ./configure --target-os=none --arch=x86_32 --enable-cross-compile \
  --disable-asm --disable-stripping --disable-programs --disable-doc --disable-debug \
  --disable-runtime-cpudetect --disable-autodetect --nm=emnm --ar=emar --ranlib=emranlib \
  --cc=emcc --cxx=em++ --objcc=emcc --dep-cc=emcc \
  --extra-cflags="$CFLAGS" --extra-cxxflags="$CXXFLAGS" \
  --disable-pthreads --disable-w32threads --disable-os2threads \
  --disable-gpl --disable-nonfree --disable-version3 --disable-postproc --enable-libopus --enable-zlib
grep -q '^#define CONFIG_GPL 0$' config.h
grep -q '^#define CONFIG_NONFREE 0$' config.h
grep -q '^#define CONFIG_VERSION3 0$' config.h
emmake make -j4
mkdir -p src
cp -R /build/ffmpegwasm/src/bind /build/ffmpegwasm/src/fftools src/
# Keep the upstream ABI and Emscripten settings. SDL and postproc are unused
# by the audio conversion command and postproc is GPL-only.
emcc -I. -I./src/fftools -I"$INSTALL_DIR/include" -L"$INSTALL_DIR/lib" \
  -Llibavcodec -Llibavdevice -Llibavfilter -Llibavformat -Llibavutil \
  -Llibswresample -Llibswscale \
  -lavcodec -lavdevice -lavfilter -lavformat -lavutil -lswresample -lswscale \
  -Wno-deprecated-declarations $LDFLAGS \
  -sWASM_BIGINT -sMODULARIZE -sINITIAL_MEMORY=32MB -sALLOW_MEMORY_GROWTH \
  -sEXPORT_NAME=createFFmpegCore -sEXPORT_ES6 \
  "-sEXPORTED_FUNCTIONS=$(node src/bind/ffmpeg/export.js)" \
  "-sEXPORTED_RUNTIME_METHODS=$(node src/bind/ffmpeg/export-runtime.js)" \
  -lworkerfs.js --pre-js src/bind/ffmpeg/bind.js \
  src/fftools/cmdutils.c src/fftools/ffmpeg.c src/fftools/ffmpeg_filter.c \
  src/fftools/ffmpeg_hw.c src/fftools/ffmpeg_mux.c src/fftools/ffmpeg_opt.c \
  src/fftools/opt_common.c -lopus -lz -o /output/ffmpeg-core.js
cp config.h config_components.h ffbuild/config.mak /output/
cp COPYING.LGPLv2.1 /output/licenses/FFmpeg-LGPL-2.1.txt
cp COPYING.GPLv2 /output/licenses/GPL-2.0.txt
cp LICENSE.md /output/licenses/FFmpeg-LICENSE.md
cp /build/opus/COPYING /output/licenses/Opus-COPYING.txt
cp /build/zlib/README /output/licenses/zlib-README.txt
cp /build/ffmpegwasm/LICENSE /output/licenses/ffmpegwasm-MIT.txt
cp /emsdk/upstream/emscripten/LICENSE /output/licenses/Emscripten-LICENSE.txt
dpkg-query -W autoconf automake libtool pkg-config > /output/build-tools.txt
