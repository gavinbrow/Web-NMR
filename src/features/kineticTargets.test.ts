import { describe, it, expect } from "vitest";
import { createDemoSpectra } from "./demo";
import { measureKineticTargets } from "./kinetics";
import { encodeProject, decodeProject } from "./project";
import { createBlankProject } from "./workspaceDocuments";
import type { KineticTarget, KineticsConfiguration } from "../model";
const targets: KineticTarget[] = [
  {
    id: "reactant",
    label: "Reactant",
    color: "#1689e9",
    from: 4.24,
    to: 4,
    protons: 2,
    model: "decay",
  },
  {
    id: "product",
    label: "Product",
    color: "#e27b25",
    from: 3.82,
    to: 3.62,
    protons: 1,
    model: "growth",
  },
];
describe("multiple kinetic targets", () => {
  it("independently measures reactant/product and recovers their rate with a shared standard", () => {
    const spectra = createDemoSpectra();
    const options = {
      mode: "concentration" as const,
      standardFrom: 2.15,
      standardTo: 2,
      standardProtons: 1,
      standardConcentration: 10,
      concentrationUnit: "mM",
    };
    const series = measureKineticTargets(spectra, targets, options, true);
    expect(series).toHaveLength(2);
    for (const s of series) {
      expect(s.error).toBe("");
      expect(s.fit?.parameters.rate).toBeCloseTo(0.065, 3);
      expect(s.fit?.rSquared).toBeGreaterThan(0.999);
    }
    expect(series[0].points[0].value).toBeGreaterThan(
      series[0].points.at(-1)!.value,
    );
    expect(series[1].points[0].value).toBeLessThan(
      series[1].points.at(-1)!.value,
    );
    const altered = measureKineticTargets(
      spectra.map((s) => ({ ...s, gain: 100, integralScale: 555 })),
      targets,
      options,
      true,
    );
    expect(altered).toEqual(series);
  });
  it("a resized region updates only that target, and an invalid target does not spoil the other fit", () => {
    const spectra = createDemoSpectra();
    const options = { mode: "area" as const };
    const before = measureKineticTargets(spectra, targets, options, true);
    const resized = measureKineticTargets(
      spectra,
      [{ ...targets[0], from: 4.18, to: 4.06 }, targets[1]],
      options,
      true,
    );
    expect(resized[0].measurements[0].targetArea).not.toBe(
      before[0].measurements[0].targetArea,
    );
    expect(resized[1]).toEqual(before[1]);
    const invalid = measureKineticTargets(
      spectra,
      [{ ...targets[0], from: 100 }, targets[1]],
      options,
      true,
    );
    expect(invalid[0].measurements.every((m) => !!m.error)).toBe(true);
    expect(invalid[1].fit?.rSquared).toBeGreaterThan(0.999);
  });
  it("portable projects retain every target, per-target model and standard configuration", async () => {
    const config: KineticsConfiguration = {
      targets,
      activeTargetId: "product",
      mode: "ratio",
      standardFrom: 2.15,
      standardTo: 2,
      standardProtons: 1,
      standardConcentration: 10,
      concentrationUnit: "mM",
      excludedIds: [],
      view: "spectra",
    };
    const source = { ...createBlankProject("Two targets"), kinetics: config };
    const recovered = await decodeProject(await encodeProject(source));
    expect(recovered.kinetics).toEqual(config);
  });
});
