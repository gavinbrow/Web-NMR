import { describe, expect, it } from "vitest";
import type { Spectrum, SpectrumStack } from "../model";
import { navigatorEntries } from "./navigator";
import { spectrumText } from "./spectrumText";

const spectrum = (id: string, item?: number, stackId?: string): Spectrum =>
  ({
    id,
    label: id,
    metadata: {
      ...(item === undefined ? {} : { mnovaNativeItem: item }),
      ...(stackId ? { mnovaStackId: stackId } : {}),
    },
  }) as Spectrum;

describe("Mnova document navigation", () => {
  it("shows 13 single pages and 3 saved stacks, keeping all 38 independent members", () => {
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
        label: `Saved page ${14 + i}`,
        spectrumIds: members.map((s) => s.id),
        referenceId: members.at(-1)!.id,
      };
    });
    const entries = navigatorEntries(spectra, stacks);
    expect(entries).toHaveLength(16);
    expect(entries.slice(0, 13).every((e) => e.kind === "spectrum")).toBe(true);
    expect(
      entries
        .slice(13)
        .map((e) => e.kind === "stack" && e.stack.spectrumIds.length),
    ).toEqual([7, 5, 13]);
    expect(spectra).toHaveLength(38);
    expect(navigatorEntries(spectra, stacks, "stack-2-12")).toEqual([
      entries[15],
    ]);
    // Removing a stack exposes its members, rather than making their data unreachable.
    expect(navigatorEntries(spectra, stacks.slice(0, 2))).toHaveLength(28);
  });
  it("does not hide original spectra when the user creates a regular stack", () => {
    const spectra = [spectrum("a", 1), spectrum("b", 2)];
    const stack = {
      id: "custom",
      label: "My stack",
      spectrumIds: ["a", "b"],
      referenceId: "a",
    };
    expect(navigatorEntries(spectra, [stack])).toHaveLength(3);
  });
  it("supports JSON page indices and searching legacy comments inside saved stacks", () => {
    const a = spectrum("a", 1, "s"),
      b = spectrum("b", 1, "s");
    delete a.metadata.mnovaNativeItem;
    a.metadata.mnovaPageIndex = 1;
    b.metadata.Comment = "Sample prepared at 60 seconds";
    const stack = {
      id: "s",
      label: "Reaction",
      spectrumIds: ["a", "b"],
      referenceId: "a",
    };
    expect(navigatorEntries([a, b], [stack], "60 seconds")).toEqual([
      { kind: "stack", stack, imported: true },
    ]);
  });
});

it("displays titles and multiline comments from older native projects and current imports", () => {
  const s = spectrum("Fallback");
  s.metadata.Title = "Proton spectrum";
  s.metadata.comment = "DAC-1\r\n60 Seconds";
  expect(spectrumText(s)).toEqual({
    title: "Proton spectrum",
    comments: "DAC-1\n60 Seconds",
  });
  s.metadata.comments = "Current comment";
  expect(spectrumText(s).comments).toBe("Current comment");
  s.metadata.comments = "";
  expect(spectrumText(s).comments).toBe("DAC-1\n60 Seconds");
});
