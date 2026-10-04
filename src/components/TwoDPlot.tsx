import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { Spectrum, Tool, TwoDView } from "../model";
import type { SpectrumProperties } from "../features/appearance";
import { contourPath, visibleGrid } from "../features/contours";
import {
  f1Pixel,
  suitableTraceSources,
  skylineProjections,
  traceEnvelope,
  tracePath,
  validTwoDView,
  traceSourceKey,
  reconcileTraceSources,
} from "../features/twoDTraces";
import "./TwoDPlot.css";
import { snapTwoDPeak } from "../core/twoDProcessing";
interface Props {
  spectrum: Spectrum;
  spectra?: Spectrum[];
  tool: Tool;
  grid: boolean;
  properties: SpectrumProperties;
  exportRef: React.RefObject<(() => string) | null>;
  fullRef: React.RefObject<(() => void) | null>;
  intensityRef?: React.RefObject<((factor: number) => void) | null>;
  viewState?: TwoDView;
  onViewChange?: (view: TwoDView) => void;
  onImport1D?: () => void;
  onReference?: (x: number, y: number) => void;
  referencePoint?: { x: number; y: number };
  onBaselinePoint?: (x: number, y: number, value: number) => void;
  baselinePoints?: { xPpm: number; yPpm: number; value: number }[];
}
export function initialTwoDView(s: Spectrum, saved?: TwoDView): TwoDView {
  if (validTwoDView(saved || s.twoDView)) return saved || s.twoDView!;
  const m = s.twoD!;
  let max = 0;
  for (const value of m.real) max = Math.max(max, Math.abs(value));
  const samples: number[] = [],
    stride = Math.max(1, Math.floor(m.real.length / 8192));
  for (let i = 0; i < m.real.length; i += stride)
    samples.push(Math.abs(m.real[i]));
  samples.sort((a, b) => a - b);
  const sigma = (samples[Math.floor(samples.length / 2)] || 0) / 0.67449;
  const nativeYHigh = s.metadata.mnovaViewF1High,
    nativeYLow = s.metadata.mnovaViewF1Low;
  const savedY =
    typeof nativeYHigh === "number" &&
    typeof nativeYLow === "number" &&
    Number.isFinite(nativeYHigh) &&
    Number.isFinite(nativeYLow) &&
    nativeYHigh > nativeYLow
      ? ([
          nativeYHigh + m.referenceOffsetF1,
          nativeYLow + m.referenceOffsetF1,
        ] as [number, number])
      : undefined;
  return {
    xView: s.savedView
      ? [s.savedView[0] + s.referenceOffset, s.savedView[1] + s.referenceOffset]
      : [m.x[0] + s.referenceOffset, m.x.at(-1)! + s.referenceOffset],
    yView: savedY ?? [
      m.y[0] + m.referenceOffsetF1,
      m.y.at(-1)! + m.referenceOffsetF1,
    ],
    threshold: Math.min(80, Math.max(1, (500 * sigma) / (max || 1))),
    negative: m.mode !== "magnitude",
    topGain: 1,
    leftGain: 1,
  };
}
export function TwoDPlot({
  spectrum: s,
  spectra = [],
  tool,
  grid,
  properties: a,
  exportRef,
  fullRef,
  intensityRef,
  viewState,
  onViewChange,
  onImport1D,
  onReference,
  referencePoint,
  onBaselinePoint,
  baselinePoints,
}: Props) {
  const m = s.twoD!,
    host = useRef<HTMLDivElement>(null),
    svg = useRef<SVGSVGElement>(null),
    space = useRef(false),
    clip = useId().replace(/:/g, "");
  const [size, setSize] = useState({ w: 900, h: 600 }),
    [view, setView] = useState<TwoDView>(() => initialTwoDView(s, viewState)),
    [settings, setSettings] = useState(false);
  const settingsPanel = useRef<HTMLDivElement>(null);
  const settingsActions = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!settings) return;
    const outside = (e: PointerEvent) => {
      if (
        !settingsPanel.current?.contains(e.target as Node) &&
        !settingsActions.current?.contains(e.target as Node)
      )
        setSettings(false);
    };
    const escape = (e: KeyboardEvent) => {
      if (e.key === "Escape") setSettings(false);
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", escape);
    };
  }, [settings]);
  const [drag, setDrag] = useState<{
      x: number;
      y: number;
      endX: number;
      endY: number;
      pan: boolean;
    } | null>(null),
    [cursor, setCursor] = useState<{ x: number; y: number } | null>(null);
  const matrixIdentity = useRef(m);
  const sourceEchoes = useRef(new Set([traceSourceKey(view)]));
  const identity = useRef(s.id),
    notify = useRef(onViewChange),
    pendingChange = useRef(false);
  notify.current = onViewChange;
  useEffect(() => {
    if (identity.current !== s.id || matrixIdentity.current !== m) {
      matrixIdentity.current = m;
      identity.current = s.id;
      pendingChange.current = false;
      const next = initialTwoDView(s, viewState);
      sourceEchoes.current = new Set([traceSourceKey(next)]);
      setView(next);
      setDrag(null);
      setCursor(null);
    }
  }, [s.id, m, viewState]);
  useEffect(() => {
    if (pendingChange.current && identity.current === s.id) {
      pendingChange.current = false;
      sourceEchoes.current.add(traceSourceKey(view));
      if (sourceEchoes.current.size > 32) {
        const oldest = sourceEchoes.current.values().next().value;
        if (oldest !== undefined) sourceEchoes.current.delete(oldest);
      }
      notify.current?.(view);
    }
  }, [view]);
  useEffect(() => {
    if (!validTwoDView(viewState) || pendingChange.current) return;
    setView((current) =>
      reconcileTraceSources(current, viewState, sourceEchoes.current),
    );
  }, [viewState?.topSpectrumId, viewState?.leftSpectrumId]);
  const change = (produce: (current: TwoDView) => TwoDView) => {
    pendingChange.current = true;
    setView(produce);
  };
  const update = (patch: Partial<TwoDView>) =>
    change((v) => ({ ...v, ...patch }));
  const { xView, yView, threshold, negative } = view;
  const left = Math.max(48, Math.min(82, size.w * 0.1)),
    top = Math.max(52, Math.min(82, size.h * 0.15)),
    right = 67,
    bottom = 52;
  const w = Math.max(20, size.w - left - right),
    h = Math.max(20, size.h - top - bottom);
  const px = (ppm: number) =>
    left + ((xView[0] - ppm) / (xView[0] - xView[1])) * w;
  const py = (ppm: number) => f1Pixel(ppm, yView, top, h);
  const atX = (x: number) =>
    xView[0] - ((x - left) / w) * (xView[0] - xView[1]);
  const atY = (y: number) => yView[1] + ((y - top) / h) * (yView[0] - yView[1]);
  const full = () =>
    update({
      xView: [m.x[0] + s.referenceOffset, m.x.at(-1)! + s.referenceOffset],
      yView: [m.y[0] + m.referenceOffsetF1, m.y.at(-1)! + m.referenceOffsetF1],
    });
  useEffect(() => {
    fullRef.current = full;
    return () => {
      fullRef.current = null;
    };
  });
  useEffect(() => {
    if (!intensityRef) return;
    intensityRef.current = (factor) =>
      change((v) => ({
        ...v,
        threshold: Math.max(0.01, Math.min(80, v.threshold / factor)),
      }));
    return () => {
      intensityRef.current = null;
    };
  });
  useEffect(() => {
    const ro = new ResizeObserver((e) =>
      setSize({ w: e[0].contentRect.width, h: e[0].contentRect.height }),
    );
    if (host.current) ro.observe(host.current);
    return () => ro.disconnect();
  }, []);
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
        if (
          e.code === "Space" &&
          !["INPUT", "SELECT", "TEXTAREA"].includes(
            (e.target as HTMLElement).tagName,
          )
        )
          space.current = true;
      },
      up = () => {
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
  const referenced = useMemo(
    () => ({
      ...m,
      x: s.referenceOffset ? m.x.map((v) => v + s.referenceOffset) : m.x,
      y: m.referenceOffsetF1 ? m.y.map((v) => v + m.referenceOffsetF1) : m.y,
    }),
    [m, s.referenceOffset],
  );
  const matrix = useMemo(
    () => visibleGrid(referenced, xView, yView),
    [referenced, xView, yView],
  );
  const max = useMemo(() => {
    let v = 0;
    for (const n of m.real) v = Math.max(v, Math.abs(n));
    return v || 1;
  }, [m]);
  const paths = useMemo(
    () =>
      Array.from({ length: 9 }, (_, i) => ((max * threshold) / 100) * 1.6 ** i)
        .filter((level) => level <= max)
        .flatMap((level) => [
          { positive: true, path: contourPath(matrix, level, px, py) },
          ...(negative
            ? [{ positive: false, path: contourPath(matrix, -level, px, py) }]
            : []),
        ]),
    [matrix, max, threshold, negative, w, h, left, top],
  );
  const projections = useMemo(() => skylineProjections(m), [m]);
  const topSources = useMemo(
    () =>
      suitableTraceSources(spectra, s.nucleus, [
        referenced.x[0],
        referenced.x.at(-1)!,
      ]),
    [spectra, s.nucleus, referenced],
  );
  const leftSources = useMemo(
    () =>
      suitableTraceSources(spectra, m.nucleusF1, [
        referenced.y[0],
        referenced.y.at(-1)!,
      ]),
    [spectra, m.nucleusF1, referenced],
  );
  const topSource = topSources.find(
      (candidate) => candidate.id === view.topSpectrumId,
    ),
    leftSource = leftSources.find(
      (candidate) => candidate.id === view.leftSpectrumId,
    );
  const topPoints = useMemo(
    () =>
      traceEnvelope(
        topSource?.data || projections.top,
        topSource?.referenceOffset ?? s.referenceOffset,
        xView,
        w,
      ),
    [topSource, projections, s.referenceOffset, xView, w],
  );
  const leftPoints = useMemo(
    () =>
      traceEnvelope(
        leftSource?.data || projections.left,
        leftSource?.referenceOffset ?? m.referenceOffsetF1,
        yView,
        h,
      ),
    [leftSource, projections, m.referenceOffsetF1, yView, h],
  );
  const topPath = useMemo(
    () =>
      tracePath(
        topPoints,
        px,
        top - 9,
        Math.max(15, top - 28),
        view.topGain,
        "top",
      ),
    [topPoints, xView, w, left, top, view.topGain],
  );
  const leftPath = useMemo(
    () =>
      tracePath(
        leftPoints,
        py,
        left - 9,
        Math.max(15, left - 28),
        view.leftGain,
        "left",
      ),
    [leftPoints, yView, h, left, top, view.leftGain],
  );
  const ticks = (v: [number, number], pixels: number) => {
    const rough = (v[0] - v[1]) / Math.max(3, Math.floor(pixels / 80)),
      power = 10 ** Math.floor(Math.log10(rough)),
      step = ([1, 2, 5, 10].find((n) => n * power >= rough) || 10) * power,
      result: number[] = [];
    for (
      let x = Math.ceil(v[1] / step) * step;
      x <= v[0] && result.length < 100;
      x += step
    ) {
      result.push(x);
      if (x + step === x) break;
    }
    return result;
  };
  const xt = ticks(xView, w),
    yt = ticks(yView, h);
  useEffect(() => {
    exportRef.current = () => {
      const clone = svg.current!.cloneNode(true) as SVGSVGElement;
      clone.querySelectorAll("[data-ui]").forEach((el) => el.remove());
      clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
      clone.setAttribute("width", String(size.w));
      clone.setAttribute("height", String(size.h));
      return new XMLSerializer().serializeToString(clone);
    };
    return () => {
      exportRef.current = null;
    };
  });
  const local = (e: { clientX: number; clientY: number }) => {
    const r = host.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const inContour = (p: { x: number; y: number }) =>
    p.x >= left && p.x <= left + w && p.y >= top && p.y <= top + h;
  const pos = (e: React.PointerEvent) => {
    const p = local(e);
    return {
      x: Math.max(left, Math.min(left + w, p.x)),
      y: Math.max(top, Math.min(top + h, p.y)),
    };
  };
  // A native non-passive listener prevents browser scrolling and isolates trace scaling from contour levels.
  const wheelAction = useRef<(e: WheelEvent) => void>(() => {});
  wheelAction.current = (e) => {
    if (e.deltaY === 0) return;
    if ((e.target as HTMLElement).closest("[data-two-d-controls]")) return;
    const p = local(e),
      factor = e.deltaY > 0 ? 1 / 1.15 : 1.15,
      clamp = (gain: number) => Math.max(0.01, Math.min(100, gain * factor));
    if (p.y < top && p.x >= left && p.x <= left + w) {
      e.preventDefault();
      change((v) => ({ ...v, topGain: clamp(v.topGain) }));
    } else if (p.x < left && p.y >= top && p.y <= top + h) {
      e.preventDefault();
      change((v) => ({ ...v, leftGain: clamp(v.leftGain) }));
    } else if (inContour(p)) {
      e.preventDefault();
      change((v) => ({
        ...v,
        threshold: Math.max(
          0.01,
          Math.min(80, v.threshold * (e.deltaY > 0 ? 1.15 : 1 / 1.15)),
        ),
      }));
    }
  };
  useEffect(() => {
    const el = host.current!,
      listener = (e: WheelEvent) => wheelAction.current(e);
    el.addEventListener("wheel", listener, { passive: false });
    return () => el.removeEventListener("wheel", listener);
  }, []);
  return (
    <div
      ref={host}
      className={`spectrum-plot two-d-plot tool-${tool}`}
      data-testid="two-d-plot"
      onDoubleClick={(e) => {
        if (!(e.target as HTMLElement).closest("[data-two-d-controls]")) full();
      }}
      onPointerDown={(e) => {
        if (
          e.button !== 0 ||
          (e.target as HTMLElement).closest("[data-two-d-controls]") ||
          !inContour(local(e))
        )
          return;
        e.currentTarget.setPointerCapture(e.pointerId);
        const p = pos(e);
        if (tool === "reference" && !space.current) {
          const peak = snapTwoDPeak(m, atX(p.x), atY(p.y), s.referenceOffset, [
            ((xView[0] - xView[1]) * 8) / w,
            ((yView[0] - yView[1]) * 8) / h,
          ]);
          const x = peak?.xPpm ?? atX(p.x),
            y = peak?.yPpm ?? atY(p.y);
          onReference?.(x, y);
          setCursor({ x: px(x), y: py(y) });
          return;
        }
        if (tool === "baseline" && !space.current) {
          const nearest = (
            axis: Float64Array,
            value: number,
            offset: number,
          ) => {
            let best = 0;
            for (let i = 1; i < axis.length; i++)
              if (
                Math.abs(axis[i] + offset - value) <
                Math.abs(axis[best] + offset - value)
              )
                best = i;
            return best;
          };
          const column = nearest(m.x, atX(p.x), s.referenceOffset),
            row = nearest(m.y, atY(p.y), m.referenceOffsetF1);
          onBaselinePoint?.(
            m.x[column] + s.referenceOffset,
            m.y[row] + m.referenceOffsetF1,
            m.real[row * m.width + column],
          );
          return;
        }
        setDrag({
          ...p,
          endX: p.x,
          endY: p.y,
          pan: tool === "pan" || space.current,
        });
      }}
      onPointerMove={(e) => {
        const p = pos(e);
        if (tool === "reference" && inContour(local(e))) {
          const peak = snapTwoDPeak(m, atX(p.x), atY(p.y), s.referenceOffset, [
            ((xView[0] - xView[1]) * 8) / w,
            ((yView[0] - yView[1]) * 8) / h,
          ]);
          setCursor(peak ? { x: px(peak.xPpm), y: py(peak.yPpm) } : p);
        } else setCursor(inContour(local(e)) ? p : null);
        setDrag((d) => (d ? { ...d, endX: p.x, endY: p.y } : null));
      }}
      onPointerUp={() => {
        if (!drag) return;
        const d = drag;
        setDrag(null);
        if (d.pan) {
          const dx = ((d.endX - d.x) / w) * (xView[0] - xView[1]),
            dy = (-(d.endY - d.y) / h) * (yView[0] - yView[1]);
          update({
            xView: [xView[0] + dx, xView[1] + dx],
            yView: [yView[0] + dy, yView[1] + dy],
          });
        } else if (Math.abs(d.endX - d.x) > 6 && Math.abs(d.endY - d.y) > 6)
          update({
            xView: [
              Math.max(atX(d.x), atX(d.endX)),
              Math.min(atX(d.x), atX(d.endX)),
            ],
            yView: [
              Math.max(atY(d.y), atY(d.endY)),
              Math.min(atY(d.y), atY(d.endY)),
            ],
          });
      }}
      onPointerCancel={() => setDrag(null)}
      onPointerLeave={() => setCursor(null)}
    >
      <svg
        ref={svg}
        className="plot-overlay"
        viewBox={`0 0 ${size.w} ${size.h}`}
        data-testid="contour-svg"
      >
        <rect width={size.w} height={size.h} fill={a.background} />
        <defs>
          <clipPath id={`${clip}-contour`}>
            <rect x={left} y={top} width={w} height={h} />
          </clipPath>
          <clipPath id={`${clip}-top`}>
            <rect x={left} y={8} width={w} height={top - 9} />
          </clipPath>
          <clipPath id={`${clip}-left`}>
            <rect x={8} y={top} width={left - 9} height={h} />
          </clipPath>
        </defs>
        <path
          data-testid="top-projection"
          d={topPath}
          clipPath={`url(#${clip}-top)`}
          fill="none"
          stroke="#dc2828"
          strokeWidth={Math.max(0.65, Math.min(1.1, a.lineWidth))}
        />
        <path
          data-testid="left-projection"
          d={leftPath}
          clipPath={`url(#${clip}-left)`}
          fill="none"
          stroke="#dc2828"
          strokeWidth={Math.max(0.65, Math.min(1.1, a.lineWidth))}
        />
        <rect
          data-ui="true"
          x={left}
          y={0}
          width={w}
          height={top}
          fill="transparent"
          style={{ cursor: "ns-resize" }}
        >
          <title>Scroll to adjust top trace intensity</title>
        </rect>
        <rect
          data-ui="true"
          x={0}
          y={top}
          width={left}
          height={h}
          fill="transparent"
          style={{ cursor: "ew-resize" }}
        >
          <title>Scroll to adjust left trace intensity</title>
        </rect>
        {grid && (
          <g stroke={a.gridColor} strokeWidth={a.gridWidth}>
            {xt.map((t) => (
              <line key={"x" + t} x1={px(t)} x2={px(t)} y1={top} y2={top + h} />
            ))}
            {yt.map((t) => (
              <line
                key={"y" + t}
                x1={left}
                x2={left + w}
                y1={py(t)}
                y2={py(t)}
              />
            ))}
          </g>
        )}
        <g clipPath={`url(#${clip}-contour)`}>
          {paths.map((p, i) => (
            <path
              key={i}
              d={p.path}
              data-testid={p.positive ? "positive-contour" : "negative-contour"}
              fill="none"
              stroke={p.positive ? s.color : "#287cb2"}
              strokeWidth={Math.max(0.6, a.lineWidth * 0.7)}
            />
          ))}
        </g>
        {a.title && (
          <text
            data-testid="spectrum-title"
            x={left + 5}
            y={top + a.titleSize + 3}
            fontFamily={a.titleFont}
            fontSize={a.titleSize}
            fill={a.titleColor}
          >
            <tspan>{a.titleText || String(s.metadata.title || s.label)}</tspan>
            {String(s.metadata.comments || "")
              .split(/\r?\n/)
              .filter(Boolean)
              .map((line, i) => (
                <tspan
                  key={i}
                  x={left + 5}
                  dy={a.titleSize + 2}
                  fontSize={Math.max(9, a.titleSize - 2)}
                >
                  {line}
                </tspan>
              ))}
          </text>
        )}
        <g
          fontFamily={a.scaleFont}
          fontSize={a.scaleSize}
          fill={a.scaleColor}
          stroke={a.scaleColor}
        >
          <rect
            x={left}
            y={top}
            width={w}
            height={h}
            fill="none"
            strokeWidth=".7"
          />
          {xt.map((t) => (
            <g key={t}>
              <line x1={px(t)} x2={px(t)} y1={top + h} y2={top + h + 4} />
              <text
                x={px(t)}
                y={top + h + 18}
                stroke="none"
                textAnchor="middle"
              >
                {Number(t.toFixed(3))}
              </text>
            </g>
          ))}
          {yt.map((t) => (
            <g key={t}>
              <line x1={left + w} x2={left + w + 4} y1={py(t)} y2={py(t)} />
              <text
                x={left + w + 8}
                y={py(t) + 3}
                stroke="none"
                textAnchor="start"
              >
                {Number(t.toFixed(3))}
              </text>
            </g>
          ))}
          <text
            x={left + w / 2}
            y={size.h - 19}
            textAnchor="middle"
            stroke="none"
          >
            F2 ({s.nucleus}, ppm)
          </text>
          <text
            transform={`translate(${size.w - 10},${top + h / 2}) rotate(-90)`}
            textAnchor="middle"
            stroke="none"
          >
            F1 ({m.nucleusF1}, ppm)
          </text>
        </g>
        {tool !== "reference" && cursor && (
          <g data-ui="true" className="crosshair">
            <line x1={cursor.x} x2={cursor.x} y1={top} y2={top + h} />
            <line x1={left} x2={left + w} y1={cursor.y} y2={cursor.y} />
          </g>
        )}
        {tool === "reference" &&
          (referencePoint || cursor) &&
          (() => {
            const point = referencePoint
              ? { x: px(referencePoint.x), y: py(referencePoint.y) }
              : cursor!;
            return (
              <g
                data-ui="true"
                className="reference-marker"
                data-testid="reference-marker-2d"
              >
                <line x1={point.x} x2={point.x} y1={top} y2={top + h} />
                <line x1={left} x2={left + w} y1={point.y} y2={point.y} />
                <circle cx={point.x} cy={point.y} r={8} />
                <text
                  x={Math.min(left + w - 105, point.x + 12)}
                  y={Math.max(top + 13, point.y - 12)}
                >
                  {atX(point.x).toFixed(4)} · {atY(point.y).toFixed(4)}
                </text>
              </g>
            );
          })()}
        {baselinePoints?.map((p, i) => (
          <circle
            key={i}
            cx={px(p.xPpm)}
            cy={py(p.yPpm)}
            r="4"
            fill="#1689e9"
            stroke="white"
            data-ui="true"
          />
        ))}
        {drag && !drag.pan && (
          <rect
            data-ui="true"
            x={Math.min(drag.x, drag.endX)}
            y={Math.min(drag.y, drag.endY)}
            width={Math.abs(drag.endX - drag.x)}
            height={Math.abs(drag.endY - drag.y)}
            fill="#a73c50"
            fillOpacity=".08"
            stroke="#a73c50"
            strokeDasharray="4 3"
          />
        )}
      </svg>
      <div
        ref={settingsActions}
        className="two-d-actions"
        data-two-d-controls="true"
      >
        <button
          type="button"
          className="two-d-import-trace"
          onClick={() => {
            setSettings(true);
            onImport1D?.();
          }}
        >
          Add high-resolution 1D
        </button>
        <button
          type="button"
          className="two-d-settings-toggle"
          data-two-d-controls="true"
          aria-label="2D display settings"
          aria-expanded={settings}
          onClick={() => setSettings((v) => !v)}
        >
          2D settings
        </button>
      </div>
      {settings && (
        <div
          ref={settingsPanel}
          className="two-d-settings"
          data-two-d-controls="true"
        >
          <div className="two-d-inline">
            <strong>2D display settings</strong>
            <button
              style={{ marginLeft: "auto" }}
              aria-label="Close 2D settings"
              onClick={() => setSettings(false)}
            >
              ×
            </button>
          </div>
          <label>
            Top 1D source ({s.nucleus})
            <select
              aria-label="Top trace source"
              value={topSource?.id || ""}
              onChange={(e) =>
                update({
                  topSpectrumId: e.target.value || undefined,
                  topGain: 1,
                })
              }
            >
              <option value="">2D skyline projection</option>
              {topSources.map((source) => (
                <option key={source.id} value={source.id}>
                  {source.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Left 1D source ({m.nucleusF1})
            <select
              aria-label="Left trace source"
              value={leftSource?.id || ""}
              onChange={(e) =>
                update({
                  leftSpectrumId: e.target.value || undefined,
                  leftGain: 1,
                })
              }
            >
              <option value="">2D skyline projection</option>
              {leftSources.map((source) => (
                <option key={source.id} value={source.id}>
                  {source.label}
                </option>
              ))}
            </select>
          </label>
          <small>
            Choose an imported 1D for finer detail. Sources align by referenced
            ppm. Scroll over each red trace to scale it independently.
          </small>
          <small title="Each projection displays the largest absolute crosspeak at each ppm as a positive amplitude, with an estimated noise floor removed. Signs remain in the contours; full matrix and imported 1D data are unchanged.">
            Default: amplitude skyline with display noise suppression.
          </small>
          <div className="two-d-inline">
            <button
              onClick={() =>
                update({
                  topSpectrumId: undefined,
                  leftSpectrumId: undefined,
                  topGain: 1,
                  leftGain: 1,
                })
              }
            >
              Use projections
            </button>
            <button onClick={() => update({ topGain: 1, leftGain: 1 })}>
              Reset trace heights
            </button>
            <button onClick={full}>Full 2D</button>
          </div>
          <label className="two-d-inline">
            Contour level
            <input
              aria-label="Contour level percent"
              type="number"
              min=".01"
              max="80"
              step=".25"
              value={Number(threshold.toFixed(2))}
              onChange={(e) =>
                update({
                  threshold: Math.max(
                    0.01,
                    Math.min(80, e.target.valueAsNumber || 1),
                  ),
                })
              }
            />
            %
          </label>
          <label className="two-d-inline">
            <input
              type="checkbox"
              checked={negative}
              onChange={(e) => update({ negative: e.target.checked })}
            />
            Negative contours
          </label>
        </div>
      )}
      <div className="two-d-instruction">
        Drag to zoom · Space to pan · scroll over traces to scale
        {cursor
          ? ` · F2 ${atX(cursor.x).toFixed(3)} / F1 ${atY(cursor.y).toFixed(3)} ppm`
          : ""}
      </div>
    </div>
  );
}
