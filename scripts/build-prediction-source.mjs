import { readFile, readdir, mkdir, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { zipSync, strToU8 } from "fflate";

// Make the corresponding application source available with the prediction distribution.
// Static lookup chunks are distributed individually and documented by the manifest.
const root = process.cwd(),
  files = {};
async function collect(directory) {
  for (const entry of await readdir(join(root, directory), {
    withFileTypes: true,
  })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) await collect(path);
    else if (!/\.(?:class|pyc)$/.test(path))
      files[relative(root, join(root, path))] = new Uint8Array(
        await readFile(join(root, path)),
      );
  }
}
for (const directory of ["src", "scripts"]) await collect(directory);
for (const path of [
  "package.json",
  "package-lock.json",
  "tsconfig.json",
  "vite.config.ts",
  "index.html",
])
  files[path] = new Uint8Array(await readFile(join(root, path)));
for (const path of [
  "public/prediction/manifest.json",
  "public/prediction/about.html",
])
  files[path] = new Uint8Array(await readFile(join(root, path)));
await collect("public/prediction/licenses");
async function collectModelMetadata(directory) {
  for (const entry of await readdir(join(root,directory), {withFileTypes:true})) {
    const path=join(directory,entry.name);
    if (entry.isDirectory()) await collectModelMetadata(path);
    else if (/\.(json|txt|mjs|html)$/.test(path)) files[path]=new Uint8Array(await readFile(join(root,path)));
  }
}
for (const directory of ["public/cascade","public/prediction/conformers","public/prediction/couplings"]) await collectModelMetadata(directory);
const oclLicense = "node_modules/openchemlib/LICENSE";
try {
  files["licenses/OpenChemLib-BSD-3-Clause.txt"] = new Uint8Array(
    await readFile(join(root, oclLicense)),
  );
} catch {
  /* Package may use a differently named license; its package.json records BSD-3-Clause. */
}
files["README-source.txt"] = strToU8(
  "Web NMR corresponding application source\n\nInstall dependencies with npm ci and build with npm run build. The static nmrshiftdb lookup tables are distributed at /prediction/1H/<00-ff>.json.gz and /prediction/13C/<00-ff>.json.gz. Their exact source hashes and extraction procedure are in public/prediction/manifest.json and scripts/prediction/README.md. CASCADE, RDKit and FullSSPrUCe rebuild scripts, pinned manifests, runtime glue, original licenses and independent fixtures are included. Large binary weights/WASM are distributed separately at /cascade and /prediction/conformers and /prediction/couplings; their filenames and SHA-256 hashes are in the included manifests. Use the included scripts to rebuild from pinned upstream sources or obtain these static assets from the same hosted website. See src/prediction/cascade/README.md, src/prediction/couplings/README.md and scripts/conformers/README.md. This archive excludes user projects, credentials, hosting metadata and dependency caches. See included prediction/licenses for CDK and nmrshiftdb terms.\n",
);
await mkdir(join(root, "public/prediction"), { recursive: true });
await writeFile(
  join(root, "public/prediction/source.zip"),
  zipSync(files, { level: 6 }),
);
console.log(
  `Prepared prediction source download (${Object.keys(files).length} files).`,
);
