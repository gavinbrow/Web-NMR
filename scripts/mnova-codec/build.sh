#!/usr/bin/env bash
set -euo pipefail
# Requires Emscripten 6.0.11 (emcc/emcmake), CMake and Python 3 on PATH.
project_dir="$(cd "$(dirname "$0")/../.." && pwd)"
build_dir="${WEBNMR_CODEC_BUILD_DIR:-$(mktemp -d /tmp/webnmr-openjpeg.XXXXXX)}"
mkdir -p "$build_dir"
curl --fail --location --silent --show-error "https://github.com/uclouvain/openjpeg/archive/6c4a29b00211eb0430fa0e5e890f1ce5c80f409f.tar.gz" -o "$build_dir/source.tar.gz"
tar -xzf "$build_dir/source.tar.gz" -C "$build_dir"
source_dir="$build_dir/openjpeg-6c4a29b00211eb0430fa0e5e890f1ce5c80f409f"
python3 - "$source_dir/src/lib/openjp2/tcd.c" <<'PY'
import sys
p=sys.argv[1]
s=open(p).read()
needle='        if (l_width == 0 || l_height == 0) {'
assert s.count(needle)==1, 'Unexpected OpenJPEG source; patch not applied'
# Mnova stores normalized scientific values using centered 28-bit floating decoding.
# Restrict the exceptional unclipped reconstruction to that exact component type.
replacement='        if (l_img_comp->prec == 28 && !l_img_comp->sgnd) { l_min = INT_MIN; l_max = INT_MAX; }\n\n'+needle
open(p,'w').write(s.replace(needle,replacement))
PY
emcmake cmake -S "$source_dir" -B "$build_dir/build" -DBUILD_CODEC=OFF -DBUILD_SHARED_LIBS=OFF -DCMAKE_BUILD_TYPE=Release
cmake --build "$build_dir/build" -j4
emcc "$project_dir/scripts/mnova-codec/decode.c" "$build_dir/build/bin/libopenjp2.a" \
  -I"$source_dir/src/lib/openjp2" -I"$build_dir/build/src/lib/openjp2" -O3 \
  -s EXPORTED_FUNCTIONS='["_decode","_malloc","_free"]' \
  -s EXPORTED_RUNTIME_METHODS='["HEAPU8"]' \
  -s INCOMING_MODULE_JS_API='["wasmBinary","locateFile"]' \
  -s MODULARIZE=1 -s EXPORT_ES6=1 -s ENVIRONMENT=web,worker \
  -s ALLOW_MEMORY_GROWTH=1 -s MAXIMUM_MEMORY=268435456 -s FILESYSTEM=0 \
  -o "$project_dir/src/core/mnovaCodec/openjpeg.mjs"
cp "$source_dir/LICENSE" "$project_dir/src/core/mnovaCodec/LICENSE.OpenJPEG"

mkdir -p "$project_dir/public/licenses"
cp "$source_dir/LICENSE" "$project_dir/public/licenses/OpenJPEG.txt"
emscripten_license="$(dirname "$(command -v emcc)")/LICENSE"
if [[ -f "$emscripten_license" ]]; then
  cp "$emscripten_license" "$project_dir/src/core/mnovaCodec/LICENSE.Emscripten"
  cp "$emscripten_license" "$project_dir/public/licenses/Emscripten.txt"
fi
