FROM --platform=linux/amd64 emscripten/emsdk:3.1.40@sha256:c1e807a6e03ac5bd5b37bae2ace3c46c08579e2ddeb951037a3b8dac7067f2cc AS compiler
RUN apt-get update && apt-get install -y --no-install-recommends autoconf=2.71-2 automake=1:1.16.5-1.3 libtool=2.4.6-15build2 pkg-config=0.29.2-1ubuntu3 && rm -rf /var/lib/apt/lists/*
ENV INSTALL_DIR=/opt/audio SOURCE_DATE_EPOCH=1699572784 LC_ALL=C TZ=UTC
ENV CFLAGS="-I/opt/audio/include -O3 -msimd128" CXXFLAGS="-I/opt/audio/include -O3 -msimd128" LDFLAGS="-L/opt/audio/lib -O3 -msimd128"
ENV PKG_CONFIG_PATH=/opt/audio/lib/pkgconfig FFMPEG_ST=yes
ENV EM_PKG_CONFIG_PATH=/opt/audio/lib/pkgconfig:/emsdk/upstream/emscripten/system/lib/pkgconfig
WORKDIR /recipe
COPY versions.json prepare.py compile.sh /recipe/
COPY sources/ /recipe/sources/
RUN python3 prepare.py
RUN bash compile.sh
COPY Dockerfile build.sh package.py README.md /recipe/
RUN python3 package.py
FROM scratch AS artifacts
COPY --from=compiler /output/ /
