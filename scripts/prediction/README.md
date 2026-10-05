# Browser-local CDK HOSE prediction

The application runs a TypeScript adaptation of **CDK 2.9's default HOSECodeGenerator and CanonicalLabeler**, with six-sphere codes and nmrshiftdb's progressive six-to-one-sphere lookup. Molecular parsing, implicit hydrogen counts and aromaticity perception use OpenChemLib 9.22.1. Explicit aromatic bonds from SMILES/molfile input are preserved even where OpenChemLib uses a different aromaticity model. Edited/imported molecule documents can supply separate `aromaticBonds` flags so the portable molfile retains ordinary Kekulé bond orders for accurate hydrogen valence while HOSE lookup retains the explicitly declared aromatic environment. This is a port of the CDK environment algorithm, not a browser JVM and not a heuristic shift estimator. All per-molecule work happens in a dedicated browser worker. Requests carry only static table filenames; structures are never sent to a prediction service.

## Sources and reproducibility

- CDK source at the `cdk-2.9` tag: [HOSECodeGenerator](https://github.com/cdk/cdk/blob/cdk-2.9/base/standard/src/main/java/org/openscience/cdk/tools/HOSECodeGenerator.java), [CanonicalLabeler](https://github.com/cdk/cdk/blob/cdk-2.9/base/standard/src/main/java/org/openscience/cdk/graph/invariant/CanonicalLabeler.java), [InvPair](https://github.com/cdk/cdk/blob/cdk-2.9/base/standard/src/main/java/org/openscience/cdk/smiles/InvPair.java). Retained copyright notices and LGPL-2.1-or-later license accompany the adapted code.
- The original `predictorh.jar` and `predictorc.jar`, stamped 2023-09-30, were read from the user's existing NMR-Predict checkout. [Standalone predictor documentation](https://sourceforge.net/p/nmrshiftdb2/wiki/PredictorJars/) describes the embedded CSV and prediction class. The jars' own `License.txt` (AGPL version 3) is retained verbatim under `public/prediction/licenses/`.
- `public/prediction/manifest.json` records the exact SHA-256 of each source jar and CSV, record counts, compressed byte counts and dataset version. No data was fetched from a prediction endpoint.
- Only the original **Unreported** solvent partition is included, matching the reference backend's selected solvent. Exact tabulated minimum, mean, maximum and sample count are retained. Means use Java float32 conversion, matching the standalone predictor; negative chemical shifts remain valid. Missing environments return no value.

Rebuild the assets from those jars with:

```sh
python3 scripts/prediction/build-data.py /path/to/backend/vendor/cdk
```

The generator preserves original row replacement behavior and deterministically partitions the code map into 256 FNV-1a buckets per nucleus. Each bucket is gzip-compressed JSON, far below single-asset hosting limits. Transport decoding accepts both gzip bytes and a body already decompressed by HTTP Content-Encoding. The worker fetches up to four chunks at a time, retains up to 64 decoded chunks in memory, and caches downloaded chunks in the browser when CacheStorage is available. The first prediction needs the selected same-origin static assets; a warm browser can reuse those assets. No claim is made that all references are offline before they have been downloaded.

## Parity verification

`Reference.java` is a build/test utility for the original jars. It parses a SMILES using CDK, configures atom types, adds explicit H and records actual six-sphere codes and standalone-predictor results. It is never part of browser runtime. The 48 committed nucleus/molecule fixtures cover 24 structures, including ethanol, acetone, benzene, ethyl acetate, anisole, pyridine, cyclohexane, tetramethylsilane (including negative reference ranges), methylammonium, acetonitrile, pyrrole, aspirin, caffeine, naphthalene, paracetamol, acetic acid, chiral alanine, nitrobenzene, chlorobenzene and fused saturated rings, for both 1H and 13C. Tests compare exact HOSE strings both on Java-recorded graphs and independently parsed OpenChemLib graphs, then verify exact float32 shifts, matching radius, ranges and positive sample counts against the converted tables.

JVM fixtures can be regenerated using a local JDK, compiling `Reference.java` with the CDK core and one predictor jar at a time (the nucleus jars define the same Java class). `IsotopeMasses.java` records CDK's most-abundant isotope mass ranking constants; these are separate from an entered isotope label.

## Scientific and implementation limits

The predictor performs two-dimensional, solvent-unspecified environment lookup. It does not compute coupling constants, multiplet patterns, conformational populations or quantum chemical shielding. Implicit equivalent protons are combined per original heavy parent atom; stereochemistry may not resolve diastereotopic protons. Broad ranges, small sample counts and low matching sphere counts expose the evidence behind each estimate; missing atoms are omitted with an explicit warning. CDK and OpenChemLib can perceive uncommon valence/aromaticity cases differently: parity is demonstrated on the committed fixtures, not asserted for every possible molecule.

`atomIndex` always denotes the zero-based original input molfile/SMILES atom ordering. Added implicit H points to its heavy parent; an explicit input H retains its own original index. Atom map markers are set before helper arrays can reorder H. Optional `aromaticBonds: [number, number][]` uses that same original input indexing and affects HOSE bond flags only; hydrogen counts come from the molfile chemistry. This distinction preserves caffeine-like heterocycles where a parser may recognize fewer aromatic rings than the original notation. The spectrum renderer must treat these shifts as unsplit predicted lines unless a separately justified coupling model is implemented. `frequencyMHz` and `lineWidthHz` belong to subsequent spectrum synthesis and do not alter chemical-shift lookups.

## Attribution in distribution

Keep the included CDK LGPL copyright notices, nmrshiftdb AGPL license and dataset provenance with distributed source and assets. The adapted files and rebuilding utilities are included in this repository so the prediction implementation and bundled lookup data are reviewable and reproducible.
