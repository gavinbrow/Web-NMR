#!/usr/bin/env python3
"""Extract the bundled standalone nmrshiftdb tables; never query a prediction service.
Usage: python3 scripts/prediction/build-data.py /path/to/cdk/vendor
"""
import gzip, hashlib, json, pathlib, struct, sys, zipfile
root = pathlib.Path(__file__).resolve().parents[2]
out = root / 'public/prediction'
source = pathlib.Path(sys.argv[1])
manifest = {'version': 'nmrshiftdb-2023-09-30-cdk-2.9-v1', 'solvent': 'Unreported', 'buckets': 256, 'nuclei': {}}
def bucket(key):
    h = 2166136261
    for char in key:
        h = ((h ^ ord(char)) * 16777619) & 0xffffffff
    return h % 256
def f32(x): return struct.unpack('<f', struct.pack('<f', float(x)))[0]
for nucleus, suffix in [('1H','h'), ('13C','c')]:
    archive = source / ('predictor'+suffix+'.jar')
    tables = [{} for _ in range(256)]
    with zipfile.ZipFile(archive) as jar:
        raw = jar.read('nmrshiftdb.csv')
        for line in raw.decode().splitlines():
            if line.startswith('#') or line == '///': continue
            fields = line.split('_')
            if fields[1] != 'Unreported': continue
            key = fields[2]
            tables[bucket(key)][key] = [f32(v) for v in fields[3:6]] + [int(fields[6])]
        (out/'licenses'/'nmrshiftdb-AGPL-3.0.txt').write_bytes(jar.read('License.txt'))
    target = out / nucleus
    target.mkdir(parents=True, exist_ok=True)
    total = 0
    for i, table in enumerate(tables):
        payload = gzip.compress(json.dumps(table,separators=(',',':'),ensure_ascii=True).encode(), compresslevel=9,mtime=0)
        (target/f'{i:02x}.json.gz').write_bytes(payload)
        total += len(payload)
    manifest['nuclei'][nucleus] = {'entries':sum(map(len,tables)), 'compressedBytes':total,'sourceJarSha256':hashlib.sha256(archive.read_bytes()).hexdigest(),'sourceCsvSha256':hashlib.sha256(raw).hexdigest()}
    print(nucleus, manifest['nuclei'][nucleus])
(out/'manifest.json').write_text(json.dumps(manifest, indent=2)+'\n')
