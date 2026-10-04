import { describe, expect, it } from "vitest";
import type { Spectrum, SpectrumStack } from "../model";
import { kineticsSources, restoredKineticsSource } from "./kineticsSources";

const spectrum = (id: string, page: number, stackId?: string, nucleus = "1H") =>
  ({
    id,
    label: id,
    nucleus,
    metadata: {
      mnovaPageIndex: page,
      ...(stackId ? { mnovaStackId: stackId } : {}),
    },
  }) as unknown as Spectrum;
const fixture = () => {
  const spectra = Array.from({ length: 13 }, (_, i) =>
    spectrum(`single-${i}`, i + 1),
  );
  const stacks: SpectrumStack[] = [7, 5, 13].map((n, i) => {
    const id = `stack-${i}`;
    const members = Array.from({ length: n }, (_, j) =>
      spectrum(`${id}-${j}`, 14 + i, id),
    );
    spectra.push(...members);
    return {
      id,
      label: `Series ${i + 1}`,
      spectrumIds: members.map((s) => s.id).reverse(),
      referenceId: members[0].id,
    };
  });
  return { spectra, stacks };
};

describe("kinetics document and stack sources", () => {
  it("uses 13 standalone measurements and offers 3 separate stacks instead of 38 mixed measurements", () => {
    const { spectra, stacks } = fixture();
    const sources = kineticsSources(spectra, stacks, "1H");
    expect(sources.map((s) => s.spectra.length)).toEqual([13, 7, 5, 13]);
    expect(sources[0].spectra.every((s) => !s.metadata.mnovaStackId)).toBe(
      true,
    );
    expect(sources[3].label).toBe("Page 16 · Series 3");
    expect(sources[3].spectra.map((s) => s.id)).toEqual(stacks[2].spectrumIds);
    expect(spectra).toHaveLength(38);
  });
  it("retains original document spectra shared by a user-created stack and filters out 2D and other nuclei", () => {
    const { spectra, stacks } = fixture();
    spectra.push(spectrum("carbon", 17, undefined, "13C"));
    spectra[0].twoD = {} as NonNullable<Spectrum["twoD"]>;
    stacks.push({
      id: "user-stack",
      label: "Custom",
      spectrumIds: ["single-1", "single-2", "carbon"],
      referenceId: "single-1",
    });
    const sources = kineticsSources(spectra, stacks, "1H");
    expect(sources[0].spectra).toHaveLength(12);
    expect(sources.at(-1)!.spectra.map((s) => s.id)).toEqual([
      "single-1",
      "single-2",
    ]);
    expect(
      kineticsSources(spectra, stacks, "13C")[0].spectra.map((s) => s.id),
    ).toEqual(["carbon"]);
  });
  it("migrates old automatically saved all-spectra sets and preserves explicit subsets", () => {
    const { spectra, stacks } = fixture();
    expect(
      restoredKineticsSource(
        spectra,
        stacks,
        spectra.map((s) => s.id),
      ),
    ).toBe("document");
    expect(
      restoredKineticsSource(
        spectra,
        stacks,
        spectra.slice(0, 13).map((s) => s.id),
      ),
    ).toBe("document");
    expect(
      restoredKineticsSource(spectra, stacks, ["single-3", "single-1"]),
    ).toBe("custom");
    expect(
      restoredKineticsSource(
        spectra,
        stacks,
        spectra.map((s) => s.id),
        "custom",
      ),
    ).toBe("custom");
    expect(restoredKineticsSource(spectra, stacks)).toBe("document");
  });
});
