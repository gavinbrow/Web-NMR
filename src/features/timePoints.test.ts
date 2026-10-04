import { describe, it, expect } from "vitest";
import { defaultTimeFill, generateTimePoints } from "./timePoints";
describe("time point filling", () => {
  it("fills doubling and equal intervals with optional initial zero", () => {
    expect(generateTimePoints(5, defaultTimeFill())).toEqual([1, 2, 4, 8, 16]);
    expect(
      generateTimePoints(5, { ...defaultTimeFill(), includeZero: true }),
    ).toEqual([0, 1, 2, 4, 8]);
    expect(
      generateTimePoints(4, {
        ...defaultTimeFill(),
        pattern: "linear",
        start: 0,
        step: 5,
      }),
    ).toEqual([0, 5, 10, 15]);
  });
  it("requires custom times for every spectrum and rejects invalid or excessive times", () => {
    expect(
      generateTimePoints(4, {
        ...defaultTimeFill(),
        pattern: "custom",
        custom: "0, 1 2;4",
      }),
    ).toEqual([0, 1, 2, 4]);
    expect(() =>
      generateTimePoints(4, {
        ...defaultTimeFill(),
        pattern: "custom",
        custom: "0, 1",
      }),
    ).toThrow();
    expect(() => generateTimePoints(200, defaultTimeFill())).toThrow();
  });
});
