import { useEffect, useRef, useState, useMemo } from "react";
import type { Spectrum, Tool, ComplexData } from "../model";
import { displayedIntegralValue } from "../features/integrals";
import type { SpectrumProperties } from "../features/appearance";

interface Props {
  regions?: {
    id?: string;
    from: number;
    to: number;
    color: string;
    label: string;
    selected?: boolean;
  }[];
  onRegionSelect?: (id: string) => void;
  onRegionResize?: (id: string, from: number, to: number) => void;
  spectra: Spectrum[];
  active: Spectrum;
  view: [number, number];
  mode: "single" | "stack" | "overlay";
  normalization: "none" | "maximum" | "area";
  tool: Tool;
  gain: number;
  component: "real" | "imag" | "magnitude" | "fid";
  grid: boolean;
  showPeaks: boolean;
  showIntegrals: boolean;
  onRegion: (from: number, to: number) => void;
  onPoint: (ppm: number, value: number) => void;
  onCursor: (ppm: number) => void;
  onZoom: (v: [number, number]) => void;
  onGain: (factor: number) => void;
  onSelect: (id: string, multi?: boolean) => void;
  onDeselect: () => void;
  onShift: (id: string, delta: number) => void;
  handAlign: boolean;
  selected: string[];
  properties: SpectrumProperties;
  baseline: ComplexData | null;
  selectedIntegral: string;
  onIntegralSelect: (spectrumId: string, integralId: string) => void;
  onIntegralEdit: (spectrumId: string, integralId: string) => void;
  onIntegralResize: (
    spectrumId: string,
    integralId: string,
    from: number,
    to: number,
  ) => void;
  onIntegralMenu: (
    spectrumId: string,
    integralId: string,
    x: number,
    y: number,
  ) => void;
  onFit: () => void;
  exportRef: React.RefObject<(() => string) | null>;
}
const summaries = new WeakMap<Float64Array, { max: number; area: number }>();
export function dataStats(data: ComplexData): { max: number; area: number } {
  const cached = summaries.get(data.real);
  if (cached) return cached;
  let max = 0,
    area = 0;
  for (let i = 0; i < data.real.length; i++) {
    max = Math.max(max, Math.abs(data.real[i]));
    if (i)
      area +=
        ((Math.abs(data.real[i]) + Math.abs(data.real[i - 1])) *
          Math.abs(data.x[i] - data.x[i - 1])) /
        2;
  }
  const result = { max: max || 1, area: area || 1 };
  summaries.set(data.real, result);
  return result;
}
function safeXml(s: string) {
  return s.replace(
    /[<>&"']/g,
    (c) =>
      ({
        "<": "&lt;",
        ">": "&gt;",
        "&": "&amp;",
        '"': "&quot;",
        "'": "&apos;",
      })[c]!,
  );
}
const traceCache = new WeakMap<Float64Array, Map<string, [number, number][]>>();
export function decimate(
  x: Float64Array,
  y: Float64Array,
  offset: number,
  view: [number, number],
  width: number,
): [number, number][] {
  const key = [offset, ...view, width].join(":");
  let cache = traceCache.get(y);
  if (!cache) {
    cache = new Map();
    traceCache.set(y, cache);
  }
  const cached = cache.get(key);
  if (cached) return cached;
  const count = Math.max(2, Math.ceil(width));
  const mins = new Float64Array(count).fill(Infinity),
    maxs = new Float64Array(count).fill(-Infinity);
  const first = new Float64Array(count),
    last = new Float64Array(count);
  const span = view[0] - view[1];
  const low = Math.min(view[0], view[1]),
    high = Math.max(view[0], view[1]);
  for (let i = 0; i < x.length; i++) {
    const ppm = x[i] + offset;
    if (ppm > high || ppm < low) continue;
    const bin = Math.min(
      count - 1,
      Math.max(0, Math.floor(((view[0] - ppm) / span) * (count - 1))),
    );
    if (mins[bin] === Infinity) first[bin] = y[i];
    last[bin] = y[i];
    mins[bin] = Math.min(mins[bin], y[i]);
    maxs[bin] = Math.max(maxs[bin], y[i]);
  }
  const out: [number, number][] = [];
  for (let b = 0; b < count; b++) {
    if (mins[b] === Infinity) continue;
    const px = (b / (count - 1)) * width;
    out.push([px, first[b]], [px, mins[b]], [px, maxs[b]], [px, last[b]]);
  }
  if (cache.size >= 8) cache.delete(cache.keys().next().value!);
  cache.set(key, out);
  return out;
}
export function SpectrumPlot(p: Props) {
  const host = useRef<HTMLDivElement>(null),
    canvas = useRef<HTMLCanvasElement>(null),
    overlay = useRef<SVGSVGElement>(null);
  const a = p.properties;
  const [size, setSize] = useState({ w: 900, h: 500 }),
    [cursor, setCursor] = useState<number | null>(null),
    [drag, setDrag] = useState<{
      start: number;
      end: number;
      pan: boolean;
      shiftId?: string;
      integral?: {
        spectrumId: string;
        integralId: string;
        edge: "from" | "to";
        from: number;
        to: number;
      };
    } | null>(null);
  const space = useRef(false);
  const pad = {
      l: 54,
      r: 22,
      t: p.showPeaks && p.active.peaks.length ? 44 : 18,
      b: 42,
    },
    pw = Math.max(40, size.w - pad.l - pad.r),
    ph = Math.max(80, size.h - pad.t - pad.b);
  const isFid = p.component === "fid";
  const fidView: [number, number] = p.active.fid
    ? [0, (p.active.fid.real.length - 1) * p.active.fid.dwellSeconds]
    : p.view;
  const v = isFid ? fidView : p.view;
  const xPixel = (ppm: number) => pad.l + ((v[0] - ppm) / (v[0] - v[1])) * pw;
  const ppmAt = (x: number) =>
    v[0] -
    ((Math.max(pad.l, Math.min(pad.l + pw, x)) - pad.l) / pw) * (v[0] - v[1]);
  useEffect(() => {
    if (!host.current) return;
    const ro = new ResizeObserver((entries) => {
      const r = entries[0].contentRect;
      setSize({ w: r.width, h: r.height });
    });
    ro.observe(host.current);
    return () => ro.disconnect();
  }, []);
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (
        e.code === "Space" &&
        !(e.target instanceof HTMLInputElement) &&
        !(e.target instanceof HTMLTextAreaElement)
      )
        space.current = true;
    };
    const up = () => {
      space.current = false;
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", up);
    };
  }, []);
  const traces = useMemo(() => {
    const all = isFid
      ? [p.active]
      : p.mode === "single"
        ? [p.active]
        : p.spectra.filter(
            (s) => s.visible && !s.twoD && s.nucleus === p.active.nucleus,
          );
    const largest = Math.max(...all.map((s) => dataStats(s.data).max), 1e-20);
    const largestArea = Math.max(
      ...all.map((s) => dataStats(s.data).area),
      1e-20,
    );
    return all.map((s, i) => {
      let xx = s.data.x,
        yy = s.data.real,
        offset = s.referenceOffset;
      if (isFid && s.fid) {
        yy = s.fid.real;
        xx = Float64Array.from(yy, (_, j) => j * s.fid!.dwellSeconds);
        offset = 0;
      } else if (p.component === "imag" && s.data.imag) yy = s.data.imag;
      else if (p.component === "magnitude")
        yy = Float64Array.from(s.data.real, (r, j) =>
          Math.hypot(r, s.data.imag?.[j] ?? 0),
        );
      const st = dataStats(s.data);
      let norm = 1;
      if (p.normalization === "maximum") norm = largest / st.max;
      if (p.normalization === "area") norm = largestArea / st.area;
      const base =
        p.mode === "stack" && !isFid
          ? pad.t +
            ph -
            48 -
            (((i * a.stackSpacing) / 100) * (ph - 48)) / Math.max(1, all.length)
          : pad.t + ph * 0.88;
      let max = largest;
      if (isFid) {
        max = 0;
        for (const z of yy) max = Math.max(max, Math.abs(z));
      }
      const scale =
        ((p.mode === "stack" && !isFid
          ? (ph / Math.max(1, all.length)) * 0.72
          : ph * 0.7) /
          (max || 1)) *
        norm *
        s.gain *
        p.gain;
      const horizontalOffset =
        p.mode === "stack" ? i * a.stackHorizontalOffset : 0;
      const points = decimate(xx, yy, offset, v, pw).map(
        ([x, y]) => [x + horizontalOffset, y] as [number, number],
      );
      let path = "";
      for (const [x, y] of points)
        path += `${path ? "L" : "M"}${(pad.l + x).toFixed(2)},${(base - y * scale).toFixed(2)}`;
      return { s, base, scale, points, path, horizontalOffset };
    });
  }, [
    p.spectra,
    p.active,
    p.mode,
    p.normalization,
    p.component,
    p.gain,
    a.stackSpacing,
    a.stackHorizontalOffset,
    pw,
    ph,
    v[0],
    v[1],
  ]);
  const ticks = useMemo(() => {
    const span = Math.abs(v[0] - v[1]);
    const rough =
      span /
      (a.horizontalAutoTicks
        ? Math.max(3, Math.floor(pw / 85))
        : a.horizontalTicks);
    const pow = 10 ** Math.floor(Math.log10(rough));
    const step = [1, 2, 2.5, 5, 10].find((n) => n * pow >= rough)! * pow;
    const t: number[] = [];
    for (
      let n = Math.ceil(Math.min(...v) / step) * step;
      n <= Math.max(...v) + step * 1e-5;
      n += step
    )
      t.push(n);
    return t;
  }, [v[0], v[1], pw, a.horizontalAutoTicks, a.horizontalTicks]);
  const visiblePeakLabels = useMemo(() => {
    const candidates = p.active.peaks
      .filter((k) => k.ppm <= v[0] && k.ppm >= v[1])
      .sort((a, b) => Math.abs(b.height) - Math.abs(a.height));
    const chosen: typeof candidates = [];
    for (const peak of candidates) {
      if (
        chosen.every(
          (other) =>
            Math.abs(xPixel(other.ppm) - xPixel(peak.ppm)) >=
            Math.max(15, a.peakSize * 1.6),
        )
      )
        chosen.push(peak);
      if (chosen.length === 40) break;
    }
    return chosen.sort((a, b) => b.ppm - a.ppm);
  }, [p.active.peaks, v[0], v[1], pw, a.peakSize]);
  useEffect(() => {
    const c = canvas.current;
    if (!c) return;
    const dpr = window.devicePixelRatio || 1;
    c.width = size.w * dpr;
    c.height = size.h * dpr;
    const ctx = c.getContext("2d");
    if (!ctx) return;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, size.w, size.h);
    if (p.grid && !a.gridOver) {
      ctx.strokeStyle = a.gridColor;
      ctx.lineWidth = a.gridWidth;
      ctx.beginPath();
      if (a.gridVertical)
        for (const t of ticks) {
          ctx.moveTo(xPixel(t), pad.t);
          ctx.lineTo(xPixel(t), pad.t + ph);
        }
      if (a.gridHorizontal)
        for (const n of [0, 0.25, 0.5, 0.75, 1]) {
          ctx.moveTo(pad.l, pad.t + ph * n);
          ctx.lineTo(pad.l + pw, pad.t + ph * n);
        }
      ctx.stroke();
    }
    ctx.save();
    ctx.beginPath();
    ctx.rect(pad.l, pad.t, pw, ph);
    ctx.clip();
    for (const t of traces) {
      ctx.save();
      if (drag?.shiftId === t.s.id) ctx.translate(drag.end - drag.start, 0);
      ctx.strokeStyle = t.s.color;
      const props = { ...a, ...t.s.properties };
      ctx.lineWidth = props.lineWidth;
      ctx.globalAlpha = props.lineOpacity / 100;
      ctx.beginPath();
      for (let i = 0; i < t.points.length; i++) {
        const [x, y] = t.points[i];
        if (props.lineStyle === "dots") {
          ctx.moveTo(pad.l + x + 1, t.base - y * t.scale);
          ctx.arc(
            pad.l + x,
            t.base - y * t.scale,
            Math.max(0.4, props.lineWidth / 2),
            0,
            Math.PI * 2,
          );
        } else if (props.lineStyle === "sticks") {
          ctx.moveTo(pad.l + x, t.base);
          ctx.lineTo(pad.l + x, t.base - y * t.scale);
        } else if (i) ctx.lineTo(pad.l + x, t.base - y * t.scale);
        else ctx.moveTo(pad.l + x, t.base - y * t.scale);
      }
      ctx.stroke();
      ctx.restore();
    }
    ctx.restore();
  }, [traces, size, pw, ph, p.mode, p.active.id, a, drag, p.grid, ticks]);
  useEffect(() => {
    p.exportRef.current = () => {
      const svg = overlay.current!.cloneNode(true) as SVGSVGElement;
      svg.querySelectorAll("[data-ui]").forEach((el) => el.remove());
      svg.setAttribute("xmlns", "http://www.w3.org/2000/svg");
      svg.setAttribute("width", String(size.w));
      svg.setAttribute("height", String(size.h));
      svg.querySelectorAll("text").forEach((el) => {
        if (!el.getAttribute("fill")) el.setAttribute("fill", a.scaleColor);
        if (!el.getAttribute("font-size"))
          el.setAttribute("font-size", String(a.scaleSize));
      });
      const traceSvg = `<g clip-path="url(#plot-clip)">${traces
        .map((t) => {
          const props = { ...a, ...t.s.properties };
          const d =
            props.lineStyle === "sticks"
              ? t.points
                  .map(
                    ([x, y]) =>
                      `M${pad.l + x},${t.base}V${t.base - y * t.scale}`,
                  )
                  .join(" ")
              : t.path;
          return `<path d="${d}" fill="none" stroke="${safeXml(t.s.color)}" stroke-width="${props.lineWidth}" opacity="${props.lineOpacity / 100}" ${props.lineStyle === "dots" ? 'stroke-dasharray="1 3"' : ""}/>`;
        })
        .join("")}</g>`;
      const gridEl = svg.querySelector(".grid");
      let grids = "";
      if (gridEl && !a.gridOver) {
        gridEl.setAttribute("opacity", "1");
        grids = gridEl.outerHTML;
        gridEl.remove();
      }
      return `<svg xmlns="http://www.w3.org/2000/svg" width="${size.w}" height="${size.h}" viewBox="0 0 ${size.w} ${size.h}" font-family="${safeXml(a.scaleFont)}"><rect width="100%" height="100%" fill="white"/><rect width="100%" height="100%" fill="${a.background}" opacity="${a.backgroundOpacity / 100}"/>${grids}${traceSvg}${svg.innerHTML}</svg>`;
    };
    return () => {
      p.exportRef.current = null;
    };
  });
  const activeTrace = traces.find((t) => t.s.id === p.active.id);
  const baselinePath = useMemo(() => {
    if (!p.baseline || !activeTrace || isFid) return "";
    return decimate(
      p.baseline.x,
      p.baseline.real,
      p.active.referenceOffset,
      v,
      pw,
    )
      .map(
        ([x, y], i) =>
          `${i ? "L" : "M"}${pad.l + x + activeTrace.horizontalOffset},${activeTrace.base - y * activeTrace.scale}`,
      )
      .join("");
  }, [p.baseline, activeTrace, v[0], v[1], pw, isFid]);
  const integralMarks = useMemo(
    () =>
      traces.flatMap((t) =>
        t.s.integrals.map((i) => {
          const xs: number[] = [],
            sums: number[] = [];
          let sum = 0;
          const lo = Math.min(i.from, i.to),
            hi = Math.max(i.from, i.to),
            step = Math.max(1, Math.ceil(t.s.data.x.length / 1000));
          for (let j = 1; j < t.s.data.x.length; j++) {
            const x = t.s.data.x[j] + t.s.referenceOffset,
              prev = t.s.data.x[j - 1] + t.s.referenceOffset;
            if (x < lo || x > hi || prev < lo || prev > hi) continue;
            sum +=
              ((t.s.data.real[j] + t.s.data.real[j - 1]) * Math.abs(x - prev)) /
              2;
            const next = t.s.data.x[j + 1] + t.s.referenceOffset;
            if (
              !xs.length ||
              j % step === 0 ||
              j === t.s.data.x.length - 1 ||
              next < lo ||
              next > hi
            ) {
              xs.push(x);
              sums.push(sum);
            }
          }
          const max = Math.max(Math.abs(sum), 1e-30),
            base =
              t.base +
              Math.max(
                12,
                Math.min(24, (ph / Math.max(1, traces.length)) * 0.12),
              ) +
              ((8 - a.integralPosition) * ph) /
                100 /
                Math.max(1, traces.length),
            height =
              (ph * a.integralHeight) /
              100 /
              Math.max(1, p.mode === "stack" ? traces.length : 1);
          const path = xs
            .map(
              (x, j) =>
                `${j ? "L" : "M"}${xPixel(x) + t.horizontalOffset},${t.base - 6 - (sums[j] / max) * height}`,
            )
            .join("");
          return {
            i,
            t,
            base,
            path,
            curveY:
              t.base -
              6 -
              ((sums[Math.floor(sums.length / 2)] ?? 0) / max) * height,
          };
        }),
      ),
    [traces, a.integralPosition, a.integralHeight, p.mode, pw, ph, v[0], v[1]],
  );
  const integralHit = (x: number, y: number) => {
    if (!p.showIntegrals || !a.integrals || isFid) return undefined;
    let best: (typeof integralMarks)[number] | undefined,
      distance = Infinity;
    for (const mark of integralMarks) {
      const left =
          Math.min(xPixel(mark.i.from), xPixel(mark.i.to)) +
          mark.t.horizontalOffset,
        right =
          Math.max(xPixel(mark.i.from), xPixel(mark.i.to)) +
          mark.t.horizontalOffset;
      const mid = (left + right) / 2,
        labelY = mark.base + Math.min(14, a.integralSize + 3);
      if (
        (x >= left - 7 && x <= right + 7 && Math.abs(y - mark.base) < 9) ||
        (Math.abs(x - mid) <
          (a.integralOrientation === "vertical"
            ? 8
            : Math.max(18, a.integralSize * 2.5)) &&
          (a.integralOrientation === "vertical"
            ? y >= mark.base + 3 &&
              y <=
                mark.base +
                  8 +
                  displayedIntegralValue(mark.t.s, mark.i).toFixed(
                    a.integralDecimals,
                  ).length *
                    a.integralSize *
                    0.65
            : Math.abs(y - labelY) < 12))
      ) {
        const d = Math.abs(y - mark.base);
        if (d < distance) {
          distance = d;
          best = mark;
        }
      }
    }
    return best;
  };
  const nearestTrace = (x: number, y: number) => {
    let best = traces[0],
      distance = Infinity;
    for (const t of traces) {
      const ppm = ppmAt(x - t.horizontalOffset) - t.s.referenceOffset,
        xx = t.s.data.x;
      let l = 0,
        r = xx.length - 1;
      const descending = xx[0] > xx[r];
      while (r - l > 1) {
        const m = (l + r) >> 1;
        if (descending ? xx[m] > ppm : xx[m] < ppm) l = m;
        else r = m;
      }
      const idx = Math.abs(xx[l] - ppm) < Math.abs(xx[r] - ppm) ? l : r;
      const d = Math.abs(t.base - t.s.data.real[idx] * t.scale - y);
      if (d < distance) {
        best = t;
        distance = d;
      }
    }
    return { trace: best, distance };
  };
  const pointerX = (e: React.PointerEvent) =>
    e.clientX - host.current!.getBoundingClientRect().left;
  const [regionDrag, setRegionDrag] = useState<{
    id: string;
    edge: "from" | "to";
    from: number;
    to: number;
  } | null>(null);
  const [regionHover, setRegionHover] = useState(false);
  function regionEdge(x: number, y: number) {
    if (
      !p.onRegionResize ||
      !p.regions ||
      y < pad.t ||
      y > pad.t + ph ||
      isFid ||
      space.current ||
      p.tool === "pan"
    )
      return;
    let best:
      | {
          region: NonNullable<Props["regions"]>[number];
          edge: "from" | "to";
          distance: number;
        }
      | undefined;
    for (const region of p.regions)
      for (const edge of ["from", "to"] as const) {
        const distance = Math.abs(x - xPixel(region[edge]));
        if (
          distance < 8 &&
          (!best ||
            distance < best.distance ||
            (distance === best.distance && region.selected))
        )
          best = { region, edge, distance };
      }
    return best;
  }
  const instruction = isFid
    ? "FID · real time signal"
    : {
        select: "Select · click an integral to edit · right-click for options",
        zoom: "Zoom · drag across a region · Esc to cancel",
        pan: "Pan · drag to move the spectrum",
        reference: "Reference · click the signal to calibrate",
        peak: "Peak picking · drag a region or click a peak",
        integral: "Integral · drag from one edge of the signal to the other",
        multiplet: "Multiplet · drag around a group of peaks",
        baseline: "Baseline · click baseline points, then Apply",
      }[p.tool];
  return (
    <div
      ref={host}
      className={`spectrum-plot tool-${p.tool}`}
      data-testid="spectrum-plot"
      style={{
        background: `color-mix(in srgb, ${a.background} ${a.backgroundOpacity}%, white)`,
        ...(regionHover || regionDrag ? { cursor: "ew-resize" } : {}),
      }}
      onWheel={(e) => {
        if (isFid) return;
        p.onGain(e.deltaY < 0 ? 1.1 : 1 / 1.1);
      }}
      onContextMenu={(e) => {
        const rect = host.current!.getBoundingClientRect(),
          hit = integralHit(e.clientX - rect.left, e.clientY - rect.top);
        if (hit) {
          e.preventDefault();
          e.stopPropagation();
          p.onIntegralMenu(hit.t.s.id, hit.i.id, e.clientX, e.clientY);
        }
      }}
      onDoubleClick={(e) => {
        const rect = host.current!.getBoundingClientRect(),
          hit = integralHit(e.clientX - rect.left, e.clientY - rect.top);
        if (hit) {
          e.stopPropagation();
          p.onIntegralEdit(hit.t.s.id, hit.i.id);
        } else p.onFit();
      }}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        const x = pointerX(e);
        if (x < pad.l || x > pad.l + pw) return;
        e.currentTarget.setPointerCapture(e.pointerId);
        const y = e.clientY - host.current!.getBoundingClientRect().top,
          hit = nearestTrace(x, y);
        const boundary = regionEdge(x, y);
        if (boundary?.region.id) {
          p.onRegionSelect?.(boundary.region.id);
          setRegionDrag({
            id: boundary.region.id,
            edge: boundary.edge,
            from: boundary.region.from,
            to: boundary.region.to,
          });
          return;
        }
        const integral = integralHit(x, y);
        if (integral) {
          p.onIntegralSelect(integral.t.s.id, integral.i.id);
          const xf = xPixel(integral.i.from) + integral.t.horizontalOffset,
            xt = xPixel(integral.i.to) + integral.t.horizontalOffset;
          const edge =
            Math.abs(x - xf) < 7
              ? "from"
              : Math.abs(x - xt) < 7
                ? "to"
                : undefined;
          if (edge)
            setDrag({
              start: x,
              end: x,
              pan: false,
              integral: {
                spectrumId: integral.t.s.id,
                integralId: integral.i.id,
                edge,
                from: integral.i.from,
                to: integral.i.to,
              },
            });
          return;
        }
        if (y < pad.t || y > pad.t + ph) {
          p.onDeselect();
          return;
        }
        if (
          ["select", "zoom", "pan"].includes(p.tool) &&
          hit.distance > 18 &&
          !p.handAlign
        )
          p.onDeselect();
        setDrag({
          start: x,
          end: x,
          pan: space.current || p.tool === "pan",
          shiftId:
            p.handAlign && !space.current && hit.trace
              ? hit.trace.s.id
              : undefined,
        });
      }}
      onPointerMove={(e) => {
        const x = pointerX(e);
        const ppm = ppmAt(Math.max(pad.l, Math.min(pad.l + pw, x)));
        const y = e.clientY - host.current!.getBoundingClientRect().top;
        setRegionHover(!!regionEdge(x, y));
        if (regionDrag) {
          const from = regionDrag.edge === "from" ? ppm : regionDrag.from;
          const to = regionDrag.edge === "to" ? ppm : regionDrag.to;
          if (Math.abs(from - to) > (v[0] - v[1]) / pw)
            p.onRegionResize?.(
              regionDrag.id,
              Math.max(from, to),
              Math.min(from, to),
            );
          return;
        }
        setCursor(x);
        p.onCursor(ppm);
        setDrag((d) => (d ? { ...d, end: x } : null));
      }}
      onPointerLeave={() => {
        setCursor(null);
        setRegionHover(false);
      }}
      onPointerCancel={() => {
        setRegionDrag(null);
        setDrag(null);
      }}
      onPointerUp={(e) => {
        if (regionDrag) {
          setRegionDrag(null);
          return;
        }
        if (!drag) return;
        const { start, pan, shiftId, integral } = drag;
        const end = pointerX(e);
        setDrag(null);
        if (isFid) return;
        if (integral) {
          const t = traces.find((t) => t.s.id === integral.spectrumId);
          const ppm = ppmAt(end - (t?.horizontalOffset ?? 0));
          p.onIntegralResize(
            integral.spectrumId,
            integral.integralId,
            integral.edge === "from" ? ppm : integral.from,
            integral.edge === "to" ? ppm : integral.to,
          );
          return;
        }
        if (shiftId && Math.abs(end - start) > 3) {
          p.onShift(shiftId, ppmAt(end) - ppmAt(start));
          return;
        }
        if (pan) {
          const delta = ((end - start) / pw) * (v[0] - v[1]);
          p.onZoom([v[0] + delta, v[1] + delta]);
          return;
        }
        const a = ppmAt(start - (activeTrace?.horizontalOffset ?? 0)),
          b = ppmAt(end - (activeTrace?.horizontalOffset ?? 0));
        if (Math.abs(end - start) > 5) {
          if (p.tool === "zoom" || p.tool === "select")
            p.onZoom([Math.max(a, b), Math.min(a, b)]);
          else p.onRegion(a, b);
        } else {
          const y = e.clientY - host.current!.getBoundingClientRect().top;
          const hit = nearestTrace(end, y),
            closest = hit.trace;
          if (p.tool === "select" && closest) {
            if (hit.distance < 18)
              p.onSelect(closest.s.id, e.shiftKey || e.metaKey || e.ctrlKey);
            else p.onDeselect();
          } else
            p.onPoint(
              a,
              activeTrace ? (activeTrace.base - y) / activeTrace.scale : 0,
            );
        }
      }}
    >
      <canvas ref={canvas} aria-label="NMR spectrum trace" />
      <svg
        ref={overlay}
        className="plot-overlay"
        style={{ zIndex: 2 }}
        viewBox={`0 0 ${size.w} ${size.h}`}
        aria-hidden="true"
      >
        <defs>
          <clipPath id="plot-clip">
            <rect x={pad.l} y={pad.t} width={pw} height={ph} />
          </clipPath>
        </defs>
        {p.regions && !isFid && (
          <g clipPath="url(#plot-clip)" pointerEvents="none">
            {p.regions.map((region) => {
              const left = Math.min(xPixel(region.from), xPixel(region.to));
              const width = Math.abs(xPixel(region.from) - xPixel(region.to));
              return (
                <g key={region.id ?? region.label} data-region-id={region.id}>
                  <rect
                    x={left}
                    y={pad.t}
                    width={width}
                    height={ph}
                    fill={region.color}
                    fillOpacity={0.09}
                  />
                  <path
                    d={`M${left},${pad.t}V${pad.t + ph}M${left + width},${pad.t}V${pad.t + ph}`}
                    stroke={region.color}
                    strokeOpacity={region.selected ? 1 : 0.6}
                    strokeWidth={region.selected ? 1.5 : 1}
                    strokeDasharray="4 3"
                  />
                  {p.onRegionResize && region.selected && (
                    <>
                      <rect
                        x={left - 3}
                        y={pad.t + ph / 2 - 9}
                        width={6}
                        height={18}
                        rx={2}
                        fill={region.color}
                      />
                      <rect
                        x={left + width - 3}
                        y={pad.t + ph / 2 - 9}
                        width={6}
                        height={18}
                        rx={2}
                        fill={region.color}
                      />
                    </>
                  )}
                  <text
                    x={left + 4}
                    y={pad.t + ph - 8}
                    fontSize={10}
                    fill={region.color}
                  >
                    {region.label}
                  </text>
                </g>
              );
            })}
          </g>
        )}
        {p.grid && (
          <g
            className="grid"
            opacity={a.gridOver ? 1 : 0}
            stroke={a.gridColor}
            strokeWidth={a.gridWidth}
          >
            {a.gridVertical &&
              ticks.map((t) => (
                <line
                  key={t}
                  x1={xPixel(t)}
                  x2={xPixel(t)}
                  y1={pad.t}
                  y2={pad.t + ph}
                />
              ))}
            {a.gridHorizontal &&
              [0, 0.25, 0.5, 0.75, 1].map((n) => (
                <line
                  key={n}
                  x1={pad.l}
                  x2={pad.l + pw}
                  y1={pad.t + ph * n}
                  y2={pad.t + ph * n}
                />
              ))}
          </g>
        )}
        {a.title && (
          <g data-testid="spectrum-title" pointerEvents="none">
            <text
              x={
                (a.titleAlignment === "left"
                  ? pad.l + 4
                  : a.titleAlignment === "center"
                    ? pad.l + pw / 2
                    : pad.l + pw - 4) + a.titleX
              }
              y={pad.t + a.titleSize + 2 + a.titleY}
              textAnchor={
                a.titleAlignment === "left"
                  ? "start"
                  : a.titleAlignment === "center"
                    ? "middle"
                    : "end"
              }
              fontSize={a.titleSize}
              fill={a.titleColor}
              fontFamily={a.titleFont}
            >
              <tspan>
                {a.titleText ||
                  String(p.active.metadata.title || p.active.label)}
              </tspan>
              {String(
                p.active.metadata.comments ||
                  p.active.metadata.COMMENT ||
                  p.active.metadata.COMMENTS ||
                  "",
              )
                .split(/\r?\n/)
                .filter(Boolean)
                .map((line, index) => (
                  <tspan
                    key={index}
                    x={
                      (a.titleAlignment === "left"
                        ? pad.l + 4
                        : a.titleAlignment === "center"
                          ? pad.l + pw / 2
                          : pad.l + pw - 4) + a.titleX
                    }
                    dy={a.titleSize + 2}
                    fontSize={Math.max(9, a.titleSize - 2)}
                  >
                    {line}
                  </tspan>
                ))}
            </text>
          </g>
        )}
        <g clipPath="url(#plot-clip)">
          {p.showIntegrals &&
            a.integrals &&
            !isFid &&
            integralMarks.map(({ i, t, base, path, curveY }) => {
              const offset = t.horizontalOffset,
                labelX = xPixel((i.from + i.to) / 2) + offset,
                labelY =
                  a.integralOrientation === "vertical"
                    ? base + 5
                    : base + Math.min(14, a.integralSize + 3),
                selected =
                  p.active.id === t.s.id && p.selectedIntegral === i.id;
              void curveY;
              return (
                <g
                  key={t.s.id + i.id}
                  data-testid="integral-mark"
                  data-integral-id={i.id}
                  data-spectrum-id={t.s.id}
                  data-from={i.from}
                  data-to={i.to}
                  data-value={displayedIntegralValue(t.s, i)}
                  data-baseline={t.base}
                >
                  {a.integralBaseline && (
                    <line
                      x1={xPixel(i.from) + offset}
                      x2={xPixel(i.to) + offset}
                      y1={t.base}
                      y2={t.base}
                      stroke={a.integralColor}
                      strokeWidth={a.integralWidth}
                    />
                  )}
                  <path
                    d={`M${xPixel(i.from) + offset},${base - 4}v4H${xPixel(i.to) + offset}v-4`}
                    stroke={selected ? "#c13249" : a.integralColor}
                    strokeWidth={selected ? 2 : a.integralWidth}
                    fill="none"
                  />
                  {selected &&
                    [i.from, i.to].map((ppm, index) => (
                      <rect
                        key={index}
                        data-ui="true"
                        x={xPixel(ppm) + offset - 3}
                        y={base - 4}
                        width="6"
                        height="7"
                        fill="#c13249"
                      />
                    ))}
                  {a.integralCurves && (
                    <path
                      d={path}
                      stroke={a.integralColor}
                      strokeWidth={a.integralWidth}
                      fill="none"
                    />
                  )}
                  {a.integralLabels && (
                    <text
                      x={labelX}
                      y={labelY}
                      textAnchor={
                        a.integralOrientation === "vertical"
                          ? "start"
                          : "middle"
                      }
                      fontSize={a.integralSize}
                      fontFamily={a.integralFont}
                      fill={a.integralColor}
                      transform={
                        a.integralOrientation === "vertical"
                          ? `rotate(90,${labelX},${labelY})`
                          : undefined
                      }
                    >
                      {displayedIntegralValue(t.s, i).toFixed(
                        a.integralDecimals,
                      )}
                      {a.integralMethodSymbol ? " S" : ""}
                    </text>
                  )}
                </g>
              );
            })}
          {baselinePath && (
            <path
              data-testid="baseline-preview"
              d={baselinePath}
              fill="none"
              stroke="#1684ff"
              strokeWidth={2}
            />
          )}
          {a.gridBaseline &&
            traces.map((t) => (
              <line
                key={t.s.id}
                x1={pad.l}
                x2={pad.l + pw}
                y1={t.base}
                y2={t.base}
                stroke={a.gridColor}
                strokeWidth={a.gridWidth}
              />
            ))}
          {!isFid &&
            a.multipletLabels &&
            p.active.multiplets.map((a) => (
              <g
                key={a.id}
                transform={`translate(${activeTrace?.horizontalOffset ?? 0},0)`}
              >
                {p.properties.multipletBox && (
                  <rect
                    x={Math.min(xPixel(a.from), xPixel(a.to))}
                    y={pad.t + (ph * p.properties.multipletPosition) / 100 - 10}
                    width={Math.abs(xPixel(a.from) - xPixel(a.to))}
                    height={p.properties.multipletSize + 8}
                    fill={p.properties.multipletBackground}
                    fillOpacity={p.properties.multipletOpacity / 100}
                    stroke="#7764a1"
                    strokeWidth={p.properties.multipletWidth}
                  />
                )}
                {p.properties.multipletJTree &&
                  a.couplingsHz.map((j, index) => (
                    <g key={index}>
                      {[-1, 1].map((sign) => (
                        <line
                          key={sign}
                          x1={xPixel(a.center)}
                          y1={
                            pad.t +
                            (ph * p.properties.multipletPosition) / 100 +
                            16
                          }
                          x2={xPixel(
                            a.center +
                              (sign * j) /
                                (2 * Math.max(1, p.active.frequencyMHz)),
                          )}
                          y2={
                            pad.t +
                            (ph * p.properties.multipletPosition) / 100 +
                            28 +
                            index * 8
                          }
                          stroke="#7764a1"
                          strokeWidth={p.properties.multipletWidth}
                        />
                      ))}
                    </g>
                  ))}
                <text
                  x={xPixel(a.center)}
                  y={pad.t + (ph * p.properties.multipletPosition) / 100}
                  textAnchor="middle"
                  fontSize={p.properties.multipletSize}
                  fontFamily={p.properties.multipletFont}
                  fill="#7764a1"
                >
                  {p.properties.multipletFormat === "name"
                    ? a.kind
                    : p.properties.multipletFormat === "shift"
                      ? a.center.toFixed(p.properties.multipletShiftDecimals)
                      : `${a.label} (${a.kind}) ${a.center.toFixed(p.properties.multipletShiftDecimals)} · J ${a.couplingsHz.map((j) => j.toFixed(p.properties.multipletJDecimals)).join(", ")} Hz`}
                </text>
              </g>
            ))}
          {!isFid &&
            p.tool === "baseline" &&
            p.active.recipe.baselineAnchors.map((a, i) => (
              <circle
                key={i}
                transform={`translate(${activeTrace?.horizontalOffset ?? 0},0)`}
                cx={xPixel(a.ppm)}
                cy={
                  activeTrace
                    ? activeTrace.base - a.value * activeTrace.scale
                    : 0
                }
                r="4"
                fill="#b98832"
              />
            ))}
          {p.mode === "stack" &&
            a.stackLabels &&
            !isFid &&
            traces.map((t) => (
              <text
                key={t.s.id}
                x={pad.l + pw - 8}
                y={t.base - 9}
                textAnchor="end"
                fontSize="10"
                fill={t.s.color}
              >
                {t.s.label}
              </text>
            ))}
        </g>
        {p.showPeaks &&
          !isFid &&
          visiblePeakLabels.map((a) => (
            <g
              key={a.id}
              transform={`translate(${activeTrace?.horizontalOffset ?? 0},0)`}
            >
              {p.properties.peakTicks && (
                <line
                  x1={xPixel(a.ppm)}
                  x2={xPixel(a.ppm)}
                  y1={pad.t - 4}
                  y2={pad.t - 14}
                  stroke={p.active.color}
                  strokeWidth={p.properties.peakWidth}
                />
              )}
              {p.properties.peakLabels && (
                <text
                  transform={`translate(${xPixel(a.ppm) - 2},${p.properties.peakPosition === "top" ? pad.t - 18 : activeTrace ? activeTrace.base - a.height * activeTrace.scale - 9 : pad.t}) rotate(-90)`}
                  fontFamily={p.properties.peakFont}
                  fontSize={p.properties.peakSize}
                  fill={
                    p.properties.peakUseTraceColor
                      ? p.active.color
                      : p.properties.peakColor
                  }
                >
                  {(
                    a.ppm *
                    (p.properties.peakUnits === "Hz"
                      ? p.active.frequencyMHz
                      : 1)
                  ).toFixed(p.properties.peakDecimals)}
                </text>
              )}
            </g>
          ))}
        {a.gridFrame && (
          <rect
            x={pad.l}
            y={pad.t}
            width={pw}
            height={ph}
            fill="none"
            stroke={a.gridColor}
            strokeWidth={a.gridWidth}
          />
        )}
        {a.horizontal &&
          (a.horizontalPosition === "both"
            ? ["top", "bottom"]
            : [a.horizontalPosition]
          ).map((position) => {
            const y =
                (position === "top" ? pad.t : pad.t + ph) +
                (position === "top" ? -a.scaleMargin : a.scaleMargin),
              direction = position === "top" ? -1 : 1;
            return (
              <g
                key={position}
                stroke={a.scaleColor}
                strokeWidth={a.scaleWidth}
                fontFamily={a.scaleFont}
              >
                <line x1={pad.l} x2={pad.l + pw} y1={y} y2={y} />
                {ticks.map((t, index) => (
                  <g key={t}>
                    <line
                      x1={xPixel(t)}
                      x2={xPixel(t)}
                      y1={y}
                      y2={y + direction * 5}
                    />
                    <text
                      x={xPixel(t)}
                      y={y + direction * (a.scaleSize + 10)}
                      textAnchor="middle"
                      fontSize={a.scaleSize}
                      fill={a.scaleColor}
                      stroke="none"
                    >
                      {Number(
                        (isFid
                          ? t
                          : a.horizontalUnits === "Hz"
                            ? t * p.active.frequencyMHz
                            : t
                        ).toFixed(a.horizontalDecimals),
                      )}
                    </text>
                    {index > 0 &&
                      Array.from({ length: a.horizontalMinorTicks }, (_, j) => {
                        const x = xPixel(
                          ticks[index - 1] +
                            ((t - ticks[index - 1]) * (j + 1)) /
                              (a.horizontalMinorTicks + 1),
                        );
                        return (
                          <line
                            key={j}
                            x1={x}
                            x2={x}
                            y1={y}
                            y2={y + direction * 3}
                          />
                        );
                      })}
                  </g>
                ))}
                {a.horizontalLabel && (
                  <text
                    x={pad.l + pw / 2}
                    y={
                      position === "bottom"
                        ? size.h - 7
                        : Math.max(10, pad.t - 36)
                    }
                    textAnchor="middle"
                    fontSize={a.scaleSize}
                    fill={a.scaleColor}
                    stroke="none"
                  >
                    {isFid
                      ? "Time (s)"
                      : `${a.horizontalText} (${a.horizontalUnits})`}
                  </text>
                )}
              </g>
            );
          })}
        {a.vertical &&
          activeTrace &&
          (a.verticalPosition === "both"
            ? ["left", "right"]
            : [a.verticalPosition]
          ).map((position) => {
            const x =
                position === "left"
                  ? pad.l - a.scaleMargin
                  : pad.l + pw + a.scaleMargin,
              direction = position === "left" ? -1 : 1;
            return (
              <g
                key={position}
                fontFamily={a.scaleFont}
                stroke={a.scaleColor}
                strokeWidth={a.scaleWidth}
              >
                <line x1={x} x2={x} y1={pad.t} y2={pad.t + ph} />
                {Array.from({ length: a.verticalTicks + 1 }, (_, i) => {
                  const y = pad.t + (ph * i) / a.verticalTicks,
                    val = (activeTrace.base - y) / activeTrace.scale;
                  return (
                    <g key={i}>
                      <line x1={x} x2={x + direction * 4} y1={y} y2={y} />
                      <text
                        x={x + direction * 7}
                        y={y + 3}
                        textAnchor={position === "left" ? "end" : "start"}
                        fontSize={a.scaleSize}
                        stroke="none"
                        fill={a.scaleColor}
                      >
                        {Math.abs(val) >= 1e5
                          ? val.toExponential(1)
                          : val.toFixed(a.verticalDecimals)}
                      </text>
                      {i < a.verticalTicks &&
                        Array.from({ length: a.verticalMinorTicks }, (_, j) => {
                          const yy =
                            y +
                            ((ph / a.verticalTicks) * (j + 1)) /
                              (a.verticalMinorTicks + 1);
                          return (
                            <line
                              key={j}
                              x1={x}
                              x2={x + direction * 2}
                              y1={yy}
                              y2={yy}
                            />
                          );
                        })}
                    </g>
                  );
                })}
                {a.verticalLabel && (
                  <text
                    transform={`translate(${position === "left" ? 12 : size.w - 10},${pad.t + ph / 2}) rotate(-90)`}
                    textAnchor="middle"
                    fontSize={a.scaleSize}
                    stroke="none"
                    fill={a.scaleColor}
                  >
                    {a.verticalText}
                  </text>
                )}
              </g>
            );
          })}
        {cursor !== null && cursor >= pad.l && cursor <= pad.l + pw && (
          <line
            x1={cursor}
            x2={cursor}
            y1={pad.t}
            y2={pad.t + ph}
            data-ui="true"
            className="crosshair"
          />
        )}
        {drag && !drag.pan && !drag.shiftId && !drag.integral && (
          <rect
            data-ui="true"
            x={Math.min(drag.start, drag.end)}
            y={pad.t}
            width={Math.abs(drag.end - drag.start)}
            height={ph}
            fill="#a73c50"
            fillOpacity=".08"
            stroke="#a73c50"
            strokeDasharray="4 3"
          />
        )}
      </svg>
      <div className="plot-instruction">{instruction}</div>
    </div>
  );
}
