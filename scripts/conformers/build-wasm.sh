#!/usr/bin/env bash
# Reproducible build of real ETKDGv3/MMFF94; no runtime chemistry service.
set -euo pipefail
script_dir=$(cd "$(dirname "$0")" && pwd)
app_dir=$(cd "$script_dir/../.." && pwd)
build_root=${WEBNMR_CONFORMER_BUILD_ROOT:-/tmp/webnmr-conformer-build}
mkdir -p "$build_root"
if [[ ! -x "$build_root/venv/bin/cmake" ]]; then
  python3 -m venv "$build_root/venv"
  "$build_root/venv/bin/pip" install cmake==4.4.4 ninja==1.13.2
fi
export PATH="$build_root/venv/bin:$PATH"
if [[ ! -d "$build_root/rdkit/.git" ]]; then
  git clone --depth 1 --branch Release_2025_09_1 https://github.com/rdkit/rdkit.git "$build_root/rdkit"
fi
[[ $(git -C "$build_root/rdkit" rev-parse HEAD) == 237a1d9027c800784afed8788540f38a3aa595f8 ]]
if [[ ! -d "$build_root/emsdk/.git" ]]; then
  git clone https://github.com/emscripten-core/emsdk.git "$build_root/emsdk"
  git -C "$build_root/emsdk" checkout 96c657fc60920d2a6a82318aa50e0abf82749604
fi
"$build_root/emsdk/emsdk" install 4.0.10
"$build_root/emsdk/emsdk" activate 4.0.10
source "$build_root/emsdk/emsdk_env.sh"
embuilder build zlib
download() {
  local url=$1 destination=$2 hash=$3
  if [[ ! -f "$destination" ]]; then curl --fail -L "$url" -o "$destination"; fi
  python3 - "$destination" "$hash" <<'PY'
import hashlib,sys
with open(sys.argv[1],'rb') as f: actual=hashlib.file_digest(f,'sha256').hexdigest()
assert actual==sys.argv[2], f'Checksum mismatch: {sys.argv[1]}'
PY
}
if [[ ! -f "$build_root/boost-install/lib/cmake/boost_headers-1.85.0/boost_headers-config.cmake" ]]; then
  download https://archives.boost.io/release/1.85.0/source/boost_1_85_0.tar.bz2 "$build_root/boost.tar.bz2" 7009fe1faa1697476bdc7027703a2badb84e849b7b0baad5086b087b971f8617
  tar -xjf "$build_root/boost.tar.bz2" -C "$build_root"
  (cd "$build_root/boost_1_85_0"; ./bootstrap.sh --prefix="$build_root/boost-install" --with-libraries=headers; ./b2 install --with-headers)
fi
if [[ ! -f "$build_root/eigen-install/share/eigen3/cmake/Eigen3Config.cmake" ]]; then
  download https://gitlab.com/libeigen/eigen/-/archive/3.4.0/eigen-3.4.0.tar.gz "$build_root/eigen.tar.gz" 8586084f71f9bde545ee7fa6d00288b264a2b7ac3607b974e54d13e7162c1c72
  tar -xzf "$build_root/eigen.tar.gz" -C "$build_root"
  cmake -S "$build_root/eigen-3.4.0" -B "$build_root/eigen-build" -DBUILD_TESTING=OFF -DCMAKE_POLICY_VERSION_MINIMUM=3.5 -DCMAKE_INSTALL_PREFIX="$build_root/eigen-install"
  cmake --install "$build_root/eigen-build"
fi
rdkit_source="$build_root/rdkit"
# Only the disposable checkout is patched to include this isolated bridge.
python3 - "$rdkit_source/CMakeLists.txt" "$script_dir" <<'PY'
from pathlib import Path
import sys
p=Path(sys.argv[1]); s=p.read_text()
marker='\n# WebNMR conformer bridge\n'
# Also remove a prior local development bridge entry.
s='\n'.join(line for line in s.split('\n') if not (line.startswith('add_subdirectory(') and line.endswith(' WebNMR)')))
s=s.split(marker)[0]
p.write_text(s+marker+f'add_subdirectory("{sys.argv[2]}" WebNMR)\n')
PY
emcmake cmake -S "$rdkit_source" -B "$build_root/wasm" -G Ninja \
  -DRDK_BUILD_PYTHON_WRAPPERS=OFF -DRDK_BUILD_CPP_TESTS=OFF -DRDK_BUILD_INCHI_SUPPORT=OFF \
  -DRDK_USE_BOOST_SERIALIZATION=OFF -DRDK_USE_BOOST_IOSTREAMS=OFF -DRDK_OPTIMIZE_POPCNT=OFF \
  -DRDK_BUILD_THREADSAFE_SSS=OFF -DRDK_TEST_MULTITHREADED=OFF -DRDK_BUILD_DESCRIPTORS3D=OFF \
  -DRDK_BUILD_MAEPARSER_SUPPORT=OFF -DRDK_BUILD_COORDGEN_SUPPORT=OFF -DRDK_BUILD_SLN_SUPPORT=OFF \
  -DRDK_CHEMDRAW_LIBS= -DRDK_CHEMDRAWREACTION_LIBS= -DRDK_BUILD_CHEMDRAW_SUPPORT=OFF -DRDK_BUILD_PUBCHEMSHAPE_SUPPORT=OFF -DRDK_BUILD_FREETYPE_SUPPORT=OFF \
  -DRDK_INSTALL_STATIC_LIBS=ON -DRDK_BUILD_MINIMAL_LIB=OFF -DCMAKE_POLICY_VERSION_MINIMUM=3.5 \
  -DBoost_DIR="$build_root/boost-install/lib/cmake/Boost-1.85.0" \
  -Dboost_headers_DIR="$build_root/boost-install/lib/cmake/boost_headers-1.85.0" \
  -DEigen3_DIR="$build_root/eigen-install/share/eigen3/cmake" \
  -DCMAKE_CXX_FLAGS='-fwasm-exceptions -O3 -DNDEBUG' -DCMAKE_C_FLAGS='-fwasm-exceptions -O3 -DNDEBUG'
cmake --build "$build_root/wasm" --target WebNMRConformers -j "${WEBNMR_BUILD_JOBS:-8}"
asset_dir="$app_dir/public/prediction/conformers"
mkdir -p "$asset_dir"
cp "$build_root/wasm/WebNMR/WebNMRConformers.mjs" "$build_root/wasm/WebNMR/WebNMRConformers.wasm" "$asset_dir/"
cp "$rdkit_source/license.txt" "$asset_dir/RDKIT-LICENSE.txt"
cp "$build_root/boost_1_85_0/LICENSE_1_0.txt" "$asset_dir/BOOST-LICENSE.txt"
cp "$build_root/eigen-3.4.0/COPYING.MPL2" "$asset_dir/EIGEN-LICENSE.txt"
cp "$rdkit_source/External/RingFamilies/RingDecomposerLib/LICENSE" "$asset_dir/RINGDECOMPOSER-LICENSE.txt"
cp "$build_root/emsdk/upstream/emscripten/LICENSE" "$asset_dir/EMSCRIPTEN-LICENSE.txt"
cp "$build_root/emsdk/upstream/emscripten/cache/ports/zlib/zlib-1.3.1/README" "$asset_dir/ZLIB-LICENSE-README.txt"
node "$script_dir/write-manifest.mjs"
