export interface SpectrumProperties {
  background: string;
  backgroundOpacity: number;
  title: boolean;
  titleText: string;
  titleFont: string;
  titleSize: number;
  titleColor: string;
  titleAlignment: "left" | "center" | "right";
  titlePosition: "inside" | "outside";
  titleX: number;
  titleY: number;
  gridVertical: boolean;
  gridHorizontal: boolean;
  gridBaseline: boolean;
  gridFrame: boolean;
  gridOver: boolean;
  gridColor: string;
  gridWidth: number;
  lineWidth: number;
  lineStyle: "line" | "dots" | "sticks";
  lineOpacity: number;
  scaleColor: string;
  scaleWidth: number;
  scaleFont: string;
  scaleSize: number;
  scaleMargin: number;
  horizontal: boolean;
  horizontalLabel: boolean;
  horizontalText: string;
  horizontalUnits: "ppm" | "Hz";
  horizontalDecimals: number;
  horizontalAutoTicks: boolean;
  horizontalTicks: number;
  horizontalMinorTicks: number;
  horizontalPosition: "bottom" | "top" | "both";
  vertical: boolean;
  verticalLabel: boolean;
  verticalText: string;
  verticalDecimals: number;
  verticalTicks: number;
  verticalMinorTicks: number;
  verticalPosition: "left" | "right" | "both";
  peakTicks: boolean;
  peakLabels: boolean;
  peakDecimals: number;
  peakUnits: "ppm" | "Hz";
  peakPosition: "top" | "curve";
  peakUseTraceColor: boolean;
  peakColor: string;
  peakSize: number;
  peakFont: string;
  peakWidth: number;
  integrals: boolean;
  integralLabels: boolean;
  integralCurves: boolean;
  integralBaseline: boolean;
  integralDecimals: number;
  integralColor: string;
  integralWidth: number;
  integralSize: number;
  integralFont: string;
  integralMargin: number;
  integralPosition: number;
  integralHeight: number;
  integralLabelPosition: "segment" | "curve";
  integralOrientation: "horizontal" | "vertical";
  integralMethodSymbol: boolean;
  multipletLabels: boolean;
  multipletShiftDecimals: number;
  multipletJDecimals: number;
  multipletSize: number;
  multipletFont: string;
  multipletPosition: number;
  multipletWidth: number;
  multipletBox: boolean;
  multipletBackground: string;
  multipletOpacity: number;
  multipletFormat: "name" | "shift" | "full";
  multipletJTree: boolean;
  stackLabels: boolean;
  stackSpacing: number;
  stackHorizontalOffset: number;
  paperWidth: number;
  paperHeight: number;
  paperX: number;
  paperY: number;
}
export const defaultProperties = (): SpectrumProperties => ({
  background: "#ffffff",
  backgroundOpacity: 100,
  title: true,
  titleText: "",
  titleFont: "Arial",
  titleSize: 13,
  titleColor: "#303944",
  titleAlignment: "left",
  titlePosition: "inside",
  titleX: 0,
  titleY: 0,
  gridVertical: true,
  gridHorizontal: true,
  gridBaseline: false,
  gridFrame: false,
  gridOver: false,
  gridColor: "#e8eaed",
  gridWidth: 0.7,
  lineWidth: 1.25,
  lineStyle: "line",
  lineOpacity: 100,
  scaleColor: "#59616b",
  scaleWidth: 1,
  scaleFont: "Arial",
  scaleSize: 11,
  scaleMargin: 0,
  horizontal: true,
  horizontalLabel: true,
  horizontalText: "Chemical shift",
  horizontalUnits: "ppm",
  horizontalDecimals: 3,
  horizontalAutoTicks: true,
  horizontalTicks: 10,
  horizontalMinorTicks: 1,
  horizontalPosition: "bottom",
  vertical: false,
  verticalLabel: false,
  verticalText: "Intensity",
  verticalDecimals: 0,
  verticalTicks: 4,
  verticalMinorTicks: 1,
  verticalPosition: "right",
  peakTicks: true,
  peakLabels: true,
  peakDecimals: 3,
  peakUnits: "ppm",
  peakPosition: "top",
  peakUseTraceColor: true,
  peakColor: "#a04a5e",
  peakSize: 9,
  peakFont: "Arial",
  peakWidth: 1,
  integrals: true,
  integralLabels: true,
  integralCurves: false,
  integralBaseline: false,
  integralDecimals: 2,
  integralColor: "#187bd5",
  integralWidth: 1.2,
  integralSize: 10,
  integralFont: "Arial",
  integralMargin: 2,
  integralPosition: 8,
  integralHeight: 15,
  integralLabelPosition: "segment",
  integralOrientation: "vertical",
  integralMethodSymbol: false,
  multipletLabels: true,
  multipletShiftDecimals: 3,
  multipletJDecimals: 2,
  multipletSize: 10,
  multipletFont: "Arial",
  multipletPosition: 5,
  multipletWidth: 1,
  multipletBox: true,
  multipletBackground: "#ffffff",
  multipletOpacity: 0,
  multipletFormat: "name",
  multipletJTree: false,
  stackLabels: true,
  stackSpacing: 100,
  stackHorizontalOffset: 0,
  paperWidth: 100,
  paperHeight: 100,
  paperX: 0,
  paperY: 0,
});
export function validProperties(value: unknown): value is SpectrumProperties {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const defaults = defaultProperties();
  const entries = Object.entries(value);
  if (entries.length > Object.keys(defaults).length) return false;
  const enums: Record<string, string[]> = {
    titleAlignment: ["left", "center", "right"],
    titlePosition: ["inside", "outside"],
    lineStyle: ["line", "dots", "sticks"],
    horizontalUnits: ["ppm", "Hz"],
    peakUnits: ["ppm", "Hz"],
    horizontalPosition: ["bottom", "top", "both"],
    verticalPosition: ["left", "right", "both"],
    peakPosition: ["top", "curve"],
    integralLabelPosition: ["segment", "curve"],
    integralOrientation: ["horizontal", "vertical"],
    multipletFormat: ["name", "shift", "full"],
  };
  return entries.every(([key, v]) => {
    if (
      !Object.hasOwn(defaults, key) ||
      typeof v !== typeof defaults[key as keyof SpectrumProperties]
    )
      return false;
    if (typeof v === "number") {
      if (!Number.isFinite(v)) return false;
      if (/Decimals/.test(key)) return Number.isInteger(v) && v >= 0 && v <= 8;
      if (/Ticks/.test(key)) return Number.isInteger(v) && v >= 1 && v <= 20;
      if (/Opacity/.test(key)) return v >= 0 && v <= 100;
      if (/Size/.test(key)) return v >= 6 && v <= 36;
      if (/Width/.test(key) && key !== "paperWidth") return v >= 0.2 && v <= 8;
      if (key === "paperWidth" || key === "paperHeight")
        return v >= 30 && v <= 100;
      if (key === "stackSpacing") return v >= 20 && v <= 150;
      if (
        [
          "titleX",
          "titleY",
          "paperX",
          "paperY",
          "stackHorizontalOffset",
        ].includes(key)
      )
        return Math.abs(v) <= 300;
      return v >= 0 && v <= 100;
    }
    if (typeof v === "string")
      return (
        v.length <= 1000 &&
        (enums[key]
          ? enums[key].includes(v)
          : /color|background/i.test(key)
            ? /^#[\da-f]{6}$/i.test(v)
            : true)
      );
    return true;
  });
}
