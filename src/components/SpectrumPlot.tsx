import { useEffect, useRef, useState, useMemo } from "react";
import type { Spectrum, Tool, ComplexData } from "../model";

interface Props {
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
  onSelect: (id: string) => void;
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
function decimate(
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
  const low = Math.min(view[0],view[1]), high = Math.max(view[0],view[1]);
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
    canvas = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState({ w: 900, h: 500 }),
    [cursor, setCursor] = useState<number | null>(null),
    [drag, setDrag] = useState<{
      start: number;
      end: number;
      pan: boolean;
    } | null>(null);
  const space = useRef(false);
  const pad = { l: 64, r: 28, t: 70, b: 52 },
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
        : p.spectra.filter((s) => s.visible && s.nucleus === p.active.nucleus);
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
          ? pad.t + ph - ((i + 0.18) * ph) / Math.max(1, all.length)
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
      const points = decimate(xx, yy, offset, v, pw);
      let path = "";
      for (const [x, y] of points)
        path += `${path ? "L" : "M"}${(pad.l + x).toFixed(2)},${(base - y * scale).toFixed(2)}`;
      return { s, base, scale, points, path };
    });
  }, [
    p.spectra,
    p.active,
    p.mode,
    p.normalization,
    p.component,
    p.gain,
    pw,
    ph,
    v[0],
    v[1],
  ]);
  const ticks = useMemo(() => {
    const span = Math.abs(v[0] - v[1]);
    const rough = span / Math.max(3, Math.floor(pw / 85));
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
  }, [v[0], v[1], pw]);
  const visiblePeakLabels = useMemo(() => {
    const candidates = p.active.peaks
      .filter((k) => k.ppm <= v[0] && k.ppm >= v[1])
      .sort((a, b) => Math.abs(b.height) - Math.abs(a.height));
    const chosen: typeof candidates = [];
    for (const peak of candidates) {
      if (
        chosen.every(
          (other) => Math.abs(xPixel(other.ppm) - xPixel(peak.ppm)) >= 15,
        )
      )
        chosen.push(peak);
      if (chosen.length === 40) break;
    }
    return chosen.sort((a, b) => b.ppm - a.ppm);
  }, [p.active.peaks, v[0], v[1], pw]);
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
    ctx.save();
    ctx.beginPath();
    ctx.rect(pad.l, pad.t, pw, ph);
    ctx.clip();
    for (const t of traces) {
      ctx.strokeStyle = t.s.color;
      ctx.lineWidth = t.s.id === p.active.id ? 1.25 : 1;
      ctx.globalAlpha =
        p.mode === "single" || t.s.id === p.active.id ? 1 : 0.78;
      ctx.beginPath();
      for (let i = 0; i < t.points.length; i++) {
        const [x, y] = t.points[i];
        if (i) ctx.lineTo(pad.l + x, t.base - y * t.scale);
        else ctx.moveTo(pad.l + x, t.base - y * t.scale);
      }
      ctx.stroke();
    }
    ctx.restore();
  }, [traces, size, pw, ph, p.mode, p.active.id]);
  useEffect(() => {
    p.exportRef.current = () => {
      const tickSvg = ticks
        .map(
          (t) =>
            `<line x1="${xPixel(t)}" x2="${xPixel(t)}" y1="${pad.t}" y2="${pad.t + ph}" stroke="#e8eaed"/><text x="${xPixel(t)}" y="${pad.t + ph + 25}" text-anchor="middle" font-size="12">${t.toFixed(isFid ? 2 : 2)}</text>`,
        )
        .join("");
      const marks =
        p.showPeaks && !isFid
          ? visiblePeakLabels
              .map(
                (k) =>
                  `<text transform="translate(${xPixel(k.ppm)},${pad.t - 15}) rotate(-90)" font-size="9">${k.ppm.toFixed(3)}</text>`,
              )
              .join("")
          : "";
      const ints =
        p.showIntegrals && !isFid
          ? p.active.integrals
              .map(
                (a) =>
                  `<line x1="${xPixel(a.from)}" x2="${xPixel(a.to)}" y1="${pad.t + ph - 10}" y2="${pad.t + ph - 10}" stroke="#40887b"/><text x="${xPixel((a.from + a.to) / 2)}" y="${pad.t + ph - 16}" font-size="11" text-anchor="middle">${(a.area * p.active.integralScale).toFixed(2)}</text>`,
              )
              .join("")
          : "";
      return `<svg xmlns="http://www.w3.org/2000/svg" width="${size.w}" height="${size.h}" viewBox="0 0 ${size.w} ${size.h}"><rect width="100%" height="100%" fill="white"/><g font-family="Arial" fill="#333"><text x="${pad.l}" y="28" font-size="14">${safeXml(p.active.label)}</text><text x="${pad.l}" y="47" font-size="11">${safeXml(p.active.nucleus)} · ${p.active.frequencyMHz.toFixed(2)} MHz · ${safeXml(p.component)}</text>${p.grid ? tickSvg : tickSvg.replace(/<line[^>]+\/>/g, "")}<defs><clipPath id="plot"><rect x="${pad.l}" y="${pad.t}" width="${pw}" height="${ph}"/></clipPath></defs><g clip-path="url(#plot)">${traces.map((t) => `<path d="${t.path}" fill="none" stroke="${safeXml(t.s.color)}" stroke-width="1.2"/>`).join("")}${ints}</g>${marks}<line x1="${pad.l}" x2="${pad.l + pw}" y1="${pad.t + ph}" y2="${pad.t + ph}" stroke="#59616b"/><text x="${pad.l + pw / 2}" y="${size.h - 10}" font-size="12" text-anchor="middle">${isFid ? "Time (s)" : "Chemical shift (ppm)"}</text></g></svg>`;
    };
    return () => {
      p.exportRef.current = null;
    };
  });
  const pointerX = (e: React.PointerEvent) =>
    e.clientX - host.current!.getBoundingClientRect().left;
  const instruction = isFid
    ? "FID · real time signal"
    : {
        select: "Select · click a spectrum to make it active",
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
      onWheel={(e) => {
        if (isFid) return;
        p.onGain(e.deltaY < 0 ? 1.1 : 1 / 1.1);
      }}
      onDoubleClick={p.onFit}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        const x = pointerX(e);
        if (x < pad.l || x > pad.l + pw) return;
        e.currentTarget.setPointerCapture(e.pointerId);
        setDrag({ start: x, end: x, pan: space.current || p.tool === "pan" });
      }}
      onPointerMove={(e) => {
        const x = pointerX(e);
        const ppm = ppmAt(x);
        setCursor(x);
        p.onCursor(ppm);
        setDrag((d) => (d ? { ...d, end: x } : null));
      }}
      onPointerLeave={() => setCursor(null)}
      onPointerUp={(e) => {
        if (!drag) return;
        const { start, end, pan } = drag;
        setDrag(null);
        if (isFid) return;
        if (pan) {
          const delta = ((end - start) / pw) * (v[0] - v[1]);
          p.onZoom([v[0] + delta, v[1] + delta]);
          return;
        }
        const a = ppmAt(start),
          b = ppmAt(end);
        if (Math.abs(end - start) > 5) {
          if (p.tool === "zoom" || p.tool === "select")
            p.onZoom([Math.max(a, b), Math.min(a, b)]);
          else p.onRegion(a, b);
        } else {
          const y = e.clientY - host.current!.getBoundingClientRect().top;
          const closest = traces.reduce(
              (best, t) =>
                Math.abs(t.base - y) < Math.abs(best.base - y) ? t : best,
              traces[0],
            ),
            activeTrace = traces.find((t) => t.s.id === p.active.id);
          if (p.tool === "select" && closest) p.onSelect(closest.s.id);
          else
            p.onPoint(
              a,
              activeTrace ? (activeTrace.base - y) / activeTrace.scale : 0,
            );
        }
      }}
    >
      <canvas ref={canvas} aria-label="NMR spectrum trace" />
      <svg
        className="plot-overlay"
        viewBox={`0 0 ${size.w} ${size.h}`}
        aria-hidden="true"
      >
        <defs>
          <clipPath id="plot-clip">
            <rect x={pad.l} y={pad.t} width={pw} height={ph} />
          </clipPath>
        </defs>
        {p.grid && (
          <g className="grid">
            {ticks.map((t) => (
              <line
                key={t}
                x1={xPixel(t)}
                x2={xPixel(t)}
                y1={pad.t}
                y2={pad.t + ph}
              />
            ))}
            {[0, 0.25, 0.5, 0.75, 1].map((n) => (
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
        <text x={pad.l} y={27} className="plot-title">
          {p.active.label}
        </text>
        <text x={pad.l} y={46} className="plot-subtitle">
          {p.active.nucleus} · {p.active.frequencyMHz.toFixed(2)} MHz ·{" "}
          {isFid
            ? "FID"
            : p.mode === "single"
              ? "1D spectrum"
              : `${traces.length} spectra · ${p.mode}`}{" "}
        </text>
        <g clipPath="url(#plot-clip)">
          {p.showIntegrals &&
            !isFid &&
            p.active.integrals.map((a) => (
              <g key={a.id}>
                <rect
                  x={Math.min(xPixel(a.from), xPixel(a.to))}
                  y={pad.t}
                  width={Math.abs(xPixel(a.from) - xPixel(a.to))}
                  height={ph}
                  fill="#3b8975"
                  opacity=".035"
                />
                <path
                  d={`M${xPixel(a.from)},${pad.t + ph - 15}v5H${xPixel(a.to)}v-5`}
                  className="integral-bracket"
                />
                <text
                  x={xPixel((a.from + a.to) / 2)}
                  y={pad.t + ph - 23}
                  textAnchor="middle"
                  className="integral-label"
                >
                  {(a.area * p.active.integralScale).toFixed(2)}
                </text>
              </g>
            ))}
          {!isFid &&
            p.active.multiplets.map((a) => (
              <g key={a.id}>
                <path
                  d={`M${xPixel(a.from)},${pad.t + 10}v-5H${xPixel(a.to)}v5`}
                  stroke="#7764a1"
                  fill="none"
                />
                <text
                  x={xPixel(a.center)}
                  y={pad.t + 22}
                  textAnchor="middle"
                  className="multiplet-label"
                >
                  {a.kind}
                </text>
              </g>
            ))}
          {!isFid &&
            p.active.recipe.baselineAnchors.map((a, i) => (
              <circle
                key={i}
                cx={xPixel(a.ppm)}
                cy={traces[0] ? traces[0].base - a.value * traces[0].scale : 0}
                r="4"
                fill="#b98832"
              />
            ))}
          {p.mode === "stack" &&
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
            <g key={a.id}>
              <line
                x1={xPixel(a.ppm)}
                x2={xPixel(a.ppm)}
                y1={pad.t - 4}
                y2={pad.t - 14}
                stroke={p.active.color}
              />
              <text
                transform={`translate(${xPixel(a.ppm) - 2},${pad.t - 18}) rotate(-90)`}
                className="peak-label"
              >
                {a.ppm.toFixed(3)}
              </text>
            </g>
          ))}
        <line
          x1={pad.l}
          x2={pad.l + pw}
          y1={pad.t + ph}
          y2={pad.t + ph}
          className="axis"
        />
        {ticks.map((t) => (
          <g key={t}>
            <line
              x1={xPixel(t)}
              x2={xPixel(t)}
              y1={pad.t + ph}
              y2={pad.t + ph + 5}
              className="axis"
            />
            <text
              x={xPixel(t)}
              y={pad.t + ph + 21}
              textAnchor="middle"
              className="axis-label"
            >
              {Number(t.toFixed(isFid ? 2 : 3))}
            </text>
          </g>
        ))}
        <text
          x={pad.l + pw / 2}
          y={size.h - 9}
          textAnchor="middle"
          className="axis-title"
        >
          {isFid ? "Time (s)" : "Chemical shift (ppm)"}
        </text>
        {cursor !== null && cursor >= pad.l && cursor <= pad.l + pw && (
          <line
            x1={cursor}
            x2={cursor}
            y1={pad.t}
            y2={pad.t + ph}
            className="crosshair"
          />
        )}
        {drag && !drag.pan && (
          <rect
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
