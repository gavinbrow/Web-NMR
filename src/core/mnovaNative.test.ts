import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { importMnovaNative, setNativeCodecForTests } from "./mnovaNative";
import { unzipSync } from "fflate";
import { importMnovaJson } from "./mnovaJson";
import { encodeProject, decodeProject } from "../features/project";
import { navigatorEntries } from "../features/navigator";
import { spectrumText } from "../features/spectrumText";
const example = new URL(
  "../../../Example Files/400 GB-DAC1_GPC_Time_trials_08-11-26.6.fid.mnova",
  import.meta.url,
);
const converted = new URL(
  "../../../Example Files/Converted for Web NMR/400 GB-DAC1_GPC_Time_trials_08-11-26.6.fid.mnjs",
  import.meta.url,
);
const buf = (b: Uint8Array) => b.slice().buffer as ArrayBuffer;
beforeAll(() =>
  setNativeCodecForTests(
    readFileSync(new URL("./mnovaCodec/openjpeg.wasm", import.meta.url)),
  ),
);
describe("native Mnova local reference verification", () => {
  it.skipIf(!existsSync(example) || !existsSync(converted))(
    "restores 16 document pages while matching all 38 stored member spectra in the independent reference",
    async () => {
      const result = await importMnovaNative(
        buf(readFileSync(example)),
        "Reference",
      );
      const zip = unzipSync(readFileSync(converted)),
        files = new Map(Object.entries(zip).map(([k, v]) => [k, buf(v)]));
      const expected = importMnovaJson(files, "root.json");
      expect(result.spectra).toHaveLength(38);
      expect(
        navigatorEntries(result.spectra, result.stacks ?? []),
      ).toHaveLength(16);
      expect(result.stacks?.map((s) => s.spectrumIds.length)).toEqual(
        expected.stacks?.map((s) => s.spectrumIds.length),
      );
      expect(
        result.stacks?.map((st) => st.spectrumIds.indexOf(st.referenceId!)),
      ).toEqual([0, 0, 11]);
      expect(result.stacks?.map((st) => st.label)).toEqual([
        "400 GB-DAC1_GPC_Time_trials_08-11-26.6.fid",
        "400 GB-DAC1_GPC_Time_trials_08-11-26.8.fid",
        "400 GB-DAC1_GPC_Time_trials_08-11-26.11.fid",
      ]);
      expect(result.spectra[0].savedView).toEqual([
        8.440252831970579, 3.341754477624404,
      ]);
      expect(result.spectra[0].metadata.mnovaIntensityMin).toBe(
        -148.45634468536517,
      );
      expect(result.spectra.reduce((n, s) => n + s.integrals.length, 0)).toBe(
        190,
      );
      expect(result.spectra.every((s) => s.integrals.length === 5)).toBe(true);
      expect(
        result.spectra.reduce(
          (n, s) => n + Number(s.metadata.mnovaReportCount ?? 0),
          0,
        ),
      ).toBe(2);
      expect(result.warnings).toEqual([]);
      for (let i = 0; i < 38; i++) {
        const s = result.spectra[i],
          e = expected.spectra[i];
        expect(s.label).toBe(e.label);
        expect(s.metadata.comment).toBe(e.metadata.Comment);
        expect(spectrumText(s).title).toBe(e.label);
        expect(spectrumText(s).comments).toBe(e.metadata.Comment);
        expect(spectrumText(s).comments.trim()).not.toBe("");
        expect(s.frequencyMHz).toBe(e.frequencyMHz);
        expect(s.nucleus).toBe(e.nucleus);
        expect(s.data.x).toEqual(e.data.x);
        expect(s.data.real).toEqual(e.data.real);
        expect(s.fid?.real).toEqual(e.fid?.real);
        expect(s.fid?.imag).toEqual(e.fid?.imag);
        expect(s.fid?.groupDelay).toBe(e.fid?.groupDelay);
        expect(s.fid?.dwellSeconds).toBe(e.fid?.dwellSeconds);
      }
      const independent = "/tmp/webnmr-native-probes/analysis-reference.json";
      if (existsSync(independent)) {
        const ref = JSON.parse(readFileSync(independent, "utf8")) as {
          normValue: number;
          integrals: {
            min: number;
            max: number;
            raw: number;
            normalized: number;
          }[];
        }[];
        expect(ref).toHaveLength(38);
        result.spectra.forEach((s, i) =>
          s.integrals.forEach((region, j) => {
            const expected = ref[i].integrals[j];
            expect(region.from).toBe(expected.max);
            expect(region.to).toBe(expected.min);
            expect(region.imported?.rawArea).toBe(expected.raw);
            expect(region.imported?.normalizedValue).toBe(expected.normalized);
            expect(region.imported?.referenceArea).toBe(ref[i].normValue);
          }),
        );
      }
    },
    30000,
  );

  it.skipIf(!existsSync("/tmp/webnmr-native-probes/cosy.mnova"))(
    "matches every processed COSY matrix sample and both calibrated axes in the local native control",
    async () => {
      const result = await importMnovaNative(
        buf(readFileSync("/tmp/webnmr-native-probes/cosy.mnova")),
        "COSY",
      );
      const plane = result.spectra[0].twoD!;
      expect(plane.width).toBe(1024);
      expect(plane.height).toBe(1024);
      const files = unzipSync(
        readFileSync("/tmp/webnmr-native-probes/cosy.mnjs"),
      );
      const key = Object.keys(files).find((k) => k.endsWith("/data.json"))!;
      const spec = JSON.parse(new TextDecoder().decode(files[key])).spectra[0]
        .data;
      const binary =
        files[key.replace("data.json", spec.data["2rr"].binary_file)];
      const view = new DataView(
        binary.buffer,
        binary.byteOffset,
        binary.byteLength,
      );
      for (let i = 0; i < plane.real.length; i++)
        if (plane.real[i] !== view.getFloat32(21 + i * 4, false))
          throw Error("COSY sample mismatch at " + i);
      for (const [axis, dim] of [
        [plane.x, spec.dimensional_parameters[1]],
        [plane.y, spec.dimensional_parameters[0]],
      ] as const) {
        for (let i = 0; i < axis.length; i++)
          expect(axis[i]).toBe(
            (dim.lowest_frequency +
              ((dim.points - i) * dim.spectral_width) / dim.points) /
              dim.spectrometer_frequency,
          );
      }
    },
    30000,
  );
  it.skipIf(
    !existsSync("/tmp/webnmr-native-probes/noesy.mnova") ||
      !existsSync("/tmp/webnmr-native-probes/noesy.mnjs"),
  )(
    "matches unequal NOESY dimensions and retains the complete native 2D matrix in portable projects",
    async () => {
      const imported = await importMnovaNative(
        buf(readFileSync("/tmp/webnmr-native-probes/noesy.mnova")),
        "NOESY",
      );
      const spectrum = imported.spectra[0],
        plane = spectrum.twoD!;
      expect(plane.width).toBe(1024);
      expect(plane.height).toBe(512);
      const files = unzipSync(
        readFileSync("/tmp/webnmr-native-probes/noesy.mnjs"),
      );
      const key = Object.keys(files).find((k) => k.endsWith("/data.json"))!;
      const spec = JSON.parse(new TextDecoder().decode(files[key])).spectra[0]
        .data;
      const binary =
        files[key.replace("data.json", spec.data["2rr"].binary_file)];
      const v = new DataView(
        binary.buffer,
        binary.byteOffset,
        binary.byteLength,
      );
      for (let i = 0; i < plane.real.length; i++)
        if (plane.real[i] !== v.getFloat32(21 + i * 4, false))
          throw Error("NOESY sample mismatch " + i);
      const project = {
        version: 1 as const,
        name: "Native 2D",
        spectra: imported.spectra,
        activeId: spectrum.id,
        view: null,
        displayMode: "single" as const,
        normalization: "none" as const,
        savedAt: "2026-10-04T00:00:00Z",
      };
      const restored = await decodeProject(await encodeProject(project));
      const saved = restored.spectra[0].twoD!;
      expect(saved.source).toBe("Mnova native processed 2D");
      expect(saved.x).toEqual(plane.x);
      expect(saved.y).toEqual(plane.y);
      for (let i = 0; i < plane.real.length; i++)
        if (saved.real[i] !== plane.real[i])
          throw Error("Portable native matrix mismatch " + i);
    },
    30000,
  );
  it("rejects non-native headers", async () => {
    await expect(importMnovaNative(new ArrayBuffer(48))).rejects.toThrow(
      "Not a supported",
    );
  });
  it.skipIf(!existsSync("/tmp/webnmr-native-probes/coupling-control.mnova"))(
    "restores complete saved annotations from the native control without fabricating or rerunning analysis",
    async () => {
      const imported = await importMnovaNative(
          buf(readFileSync("/tmp/webnmr-native-probes/coupling-control.mnova")),
        ),
        s = imported.spectra[0];
      expect(imported.warnings).toEqual([]);
      expect(s.integrals).toHaveLength(3);
      expect(s.integrals[0].imported?.normalizedValue).toBe(3);
      expect(s.peaks.map((p) => [p.ppm, p.label])).toEqual([
        [2.1, "Synthetic alpha"],
        [-2.7, "Synthetic beta"],
      ]);
      expect(s.multiplets.map((m) => [m.kind, m.couplingsHz, m.label])).toEqual(
        [
          ["dd", [7.125, 2.5], "Alpha"],
          ["q", [12.75], "Beta"],
        ],
      );
    },
  );
});
