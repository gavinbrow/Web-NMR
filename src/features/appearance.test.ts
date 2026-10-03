import { describe, it, expect } from "vitest";
import { defaultProperties, validProperties } from "./appearance";
describe("safe spectrum appearance archives", () => {
  it("accepts current defaults and partial older appearance settings", () => {
    expect(validProperties(defaultProperties())).toBe(true);
    expect(
      validProperties({
        peakDecimals: 4,
        lineWidth: 2,
        titleText: "Sample <A>",
      }),
    ).toBe(true);
  });
  it("rejects choices that can break rendering or escape export attributes", () => {
    for (const value of [
      { peakDecimals: 100 },
      { integralDecimals: -1 },
      { peakDecimals: 2.5 },
      { lineWidth: -1 },
      { titleSize: 0 },
      { lineOpacity: 110 },
      { gridColor: "red;url(x)" },
      { horizontalPosition: "sideways" },
      { paperWidth: 300 },
      { titleX: Infinity },
    ])
      expect(validProperties(value)).toBe(false);
  });
  it("rejects unknown and inherited keys instead of treating them as appearance", () => {
    expect(validProperties({ unknown: true })).toBe(false);
    expect(validProperties(JSON.parse('{"__proto__":{}}'))).toBe(false);
  });
});
