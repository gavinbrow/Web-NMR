import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { importMnovaNative, setNativeCodecForTests } from "./mnovaNative";
import { unzipSync } from "fflate";
import { importMnovaJson } from "./mnovaJson";
import { encodeProject, decodeProject } from "../features/project";
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
    "matches every saved sample and exact calibration in the external 38-spectrum reference",
    async () => {
      const result = await importMnovaNative(
        buf(readFileSync(example)),
        "Reference",
      );
      const zip = unzipSync(readFileSync(converted)),
        files = new Map(Object.entries(zip).map(([k, v]) => [k, buf(v)]));
      const expected = importMnovaJson(files, "root.json");
      expect(result.spectra).toHaveLength(38);
      expect(result.stacks?.map((s) => s.spectrumIds.length)).toEqual(
        expected.stacks?.map((s) => s.spectrumIds.length),
      );
      for (let i = 0; i < 38; i++) {
        const s = result.spectra[i],
          e = expected.spectra[i];
        expect(s.label).toBe(e.label);
        expect(s.metadata.comment).toBe(e.metadata.Comment);
        expect(s.frequencyMHz).toBe(e.frequencyMHz);
        expect(s.nucleus).toBe(e.nucleus);
        expect(s.data.x).toEqual(e.data.x);
        expect(s.data.real).toEqual(e.data.real);
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
});
