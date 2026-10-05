#!/usr/bin/env python3
"""Split the exact pinned ONNX bytes into deployment-safe static files.

Usage: python chunk_model.py /path/to/original.onnx --output /path/to/assets
Requires only Python's standard library. No model conversion or quantization.
"""
import argparse, hashlib, json
from pathlib import Path

MODEL_ID = 'fullsspruce-etkdg-coupling'
MODEL_SHA = '58b7f73427439c05fdd4c9689801bb2fe2d34ac960f818ebba122f731a0d91f4'
MODEL_BYTES = 28383464
CHUNK_BYTES = 16 * 1024 * 1024

def write_model_chunks(onnx_bytes, output):
    if len(onnx_bytes) != MODEL_BYTES or hashlib.sha256(onnx_bytes).hexdigest() != MODEL_SHA:
        raise ValueError('Exported ONNX does not match the pinned original model.')
    output.mkdir(parents=True, exist_ok=True)
    chunks = []
    for index, offset in enumerate(range(0, len(onnx_bytes), CHUNK_BYTES)):
        data = onnx_bytes[offset:offset + CHUNK_BYTES]
        name = f'{MODEL_ID}.part-{index:03d}.bin'
        (output / name).write_bytes(data)
        chunks.append({'file': name, 'byteOffset': offset, 'byteLength': len(data),
                       'sha256': hashlib.sha256(data).hexdigest()})
    return chunks

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('source', type=Path)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    manifest_path = args.output / f'{MODEL_ID}.json'
    manifest = json.loads(manifest_path.read_text())
    manifest['weightsChunks'] = write_model_chunks(args.source.read_bytes(), args.output)
    manifest['format'] = 'fullsspruce-onnx-chunks-v2'
    manifest.pop('weightsFile', None)
    manifest_path.write_text(json.dumps(manifest, indent=2) + '\n')
    print(json.dumps(manifest['weightsChunks'], indent=2))
