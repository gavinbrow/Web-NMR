import { describe, it, expect } from "vitest";
import { layoutSpectrumLabels } from "./spectrumLabels";
describe("spectrum annotation band", () => {
  it("packs nearby long labels into separate lanes above the trace boundary", () => {
    const layout = layoutSpectrumLabels(
      Array.from({ length: 10 }, (_, i) => ({
        id: String(i),
        x: 120 + i,
        text: "C1, C2 · predicted multiplet",
        size: 12,
      })),
      54,
      900,
    );
    expect(layout.placed).toHaveLength(4);
    expect(layout.hidden).toBe(6);
    for (const label of layout.placed)
      expect(label.y + 5).toBeLessThan(layout.height + 18);
    for (let i = 0; i < layout.placed.length; i++)
      for (let j = i + 1; j < layout.placed.length; j++) {
        const a = layout.placed[i],
          b = layout.placed[j];
        expect(
          a.lane !== b.lane ||
            Math.abs(a.center - b.center) > (a.width + b.width) / 2,
        ).toBe(true);
      }
  });
  it("keeps edge labels in the plot width and clips text only for display", () => {
    const text = "C123, C124, C125, C126, C127 · very long assignment";
    const layout = layoutSpectrumLabels(
      [
        { id: "a", x: 10, text, size: 12 },
        { id: "b", x: 1100, text: "7.26", size: 10 },
      ],
      54,
      900,
    );
    for (const l of layout.placed) {
      expect(l.center - l.width / 2).toBeGreaterThanOrEqual(54);
      expect(l.center + l.width / 2).toBeLessThanOrEqual(900);
    }
    expect(layout.placed[0].text).toBe(text);
    expect(layout.placed[0].displayText).toContain("…");
  });
});
