import { useEffect, useMemo, useRef, useState } from "react";
import type { Spectrum, Tool } from "../model";
import type { SpectrumProperties } from "../features/appearance";
import { contourPath, visibleGrid } from "../features/contours";
interface Props {
  spectrum: Spectrum;
  tool: Tool;
  grid: boolean;
  properties: SpectrumProperties;
  exportRef: React.RefObject<(() => string) | null>;
  fullRef: React.RefObject<(() => void) | null>;
}
export function TwoDPlot({
  spectrum: s,
  tool,
  grid,
  properties: a,
  exportRef,
  fullRef,
}: Props) {
  const m = s.twoD!,
    host = useRef<HTMLDivElement>(null),
    svg = useRef<SVGSVGElement>(null),
    space = useRef(false);
  const [size, S] = useState({ w: 900, h: 600 }),
    [xView, X] = useState<[number, number]>([m.x[0], m.x.at(-1)!]),
    [yView, Y] = useState<[number, number]>([m.y[0], m.y.at(-1)!]),
    [threshold, T] = useState(1),
    [negative, N] = useState(true),
    [drag, D] = useState<{
      x: number;
      y: number;
      endX: number;
      endY: number;
      pan: boolean;
    } | null>(null),
    [cursor, C] = useState<{ x: number; y: number } | null>(null);
  const pad = { l: 58, r: 20, t: 18, b: 42 },
    w = Math.max(100, size.w - pad.l - pad.r),
    h = Math.max(100, size.h - pad.t - pad.b);
  const px = (ppm: number) =>
      pad.l + ((xView[0] - ppm) / (xView[0] - xView[1])) * w,
    py = (ppm: number) =>
      pad.t + ((yView[0] - ppm) / (yView[0] - yView[1])) * h;
  const atX = (x: number) =>
      xView[0] - ((x - pad.l) / w) * (xView[0] - xView[1]),
    atY = (y: number) => yView[0] - ((y - pad.t) / h) * (yView[0] - yView[1]);
  const full = () => {
    X([m.x[0], m.x.at(-1)!]);
    Y([m.y[0], m.y.at(-1)!]);
  };
  useEffect(() => {
    full();
  }, [s.id]);
  useEffect(() => {
    fullRef.current = full;
    return () => {
      fullRef.current = null;
    };
  });
  useEffect(() => {
    const ro = new ResizeObserver((e) =>
      S({ w: e[0].contentRect.width, h: e[0].contentRect.height }),
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
  const matrix = useMemo(() => visibleGrid(m, xView, yView), [m, xView, yView]);
  const max = useMemo(() => {
    let v = 0;
    for (const n of m.real) v = Math.max(v, Math.abs(n));
    return v || 1;
  }, [m]);
  useEffect(() => {
    const sample: number[] = [];
    const stride = Math.max(1, Math.floor(m.real.length / 8192));
    for (let i = 0; i < m.real.length; i += stride)
      sample.push(Math.abs(m.real[i]));
    sample.sort((a, b) => a - b);
    const sigma = (sample[Math.floor(sample.length / 2)] || 0) / 0.67449;
    T(Math.min(80, Math.max(1, ((5 * sigma) / max) * 100)));
  }, [m, max]);
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
    [matrix, max, threshold, negative, w, h],
  );
  const ticks = (v: [number, number], pixels: number) => {
    const rough = (v[0] - v[1]) / Math.max(3, Math.floor(pixels / 80)),
      power = 10 ** Math.floor(Math.log10(rough)),
      step = ([1, 2, 5, 10].find((n) => n * power >= rough) || 10) * power,
      result = [];
    for (let x = Math.ceil(v[1] / step) * step; x <= v[0]; x += step)
      result.push(x);
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
  const pos = (e: React.PointerEvent) => {
    const r = host.current!.getBoundingClientRect();
    return {
      x: Math.max(pad.l, Math.min(pad.l + w, e.clientX - r.left)),
      y: Math.max(pad.t, Math.min(pad.t + h, e.clientY - r.top)),
    };
  };
  return (
    <div
      ref={host}
      className={`spectrum-plot two-d-plot tool-${tool}`}
      data-testid="two-d-plot"
      onWheel={(e) =>
        T((v) =>
          Math.max(0.01, Math.min(80, v * (e.deltaY > 0 ? 1.15 : 1 / 1.15))),
        )
      }
      onDoubleClick={full}
      onPointerDown={(e) => {
        if (
          e.button !== 0 ||
          (e.target as HTMLElement).closest(".contour-controls")
        )
          return;
        e.currentTarget.setPointerCapture(e.pointerId);
        const p = pos(e);
        D({ ...p, endX: p.x, endY: p.y, pan: tool === "pan" || space.current });
      }}
      onPointerMove={(e) => {
        const p = pos(e);
        C(p);
        D((d) => (d ? { ...d, endX: p.x, endY: p.y } : null));
      }}
      onPointerUp={() => {
        if (!drag) return;
        const d = drag;
        D(null);
        if (d.pan) {
          const dx = ((d.endX - d.x) / w) * (xView[0] - xView[1]),
            dy = ((d.endY - d.y) / h) * (yView[0] - yView[1]);
          X([xView[0] + dx, xView[1] + dx]);
          Y([yView[0] + dy, yView[1] + dy]);
        } else if (Math.abs(d.endX - d.x) > 6 && Math.abs(d.endY - d.y) > 6) {
          X([Math.max(atX(d.x), atX(d.endX)), Math.min(atX(d.x), atX(d.endX))]);
          Y([Math.max(atY(d.y), atY(d.endY)), Math.min(atY(d.y), atY(d.endY))]);
        }
      }}
      onPointerLeave={() => C(null)}
    >
      <svg
        ref={svg}
        className="plot-overlay"
        viewBox={`0 0 ${size.w} ${size.h}`}
        data-testid="contour-svg"
      >
        <rect width={size.w} height={size.h} fill={a.background} />
        <defs>
          <clipPath id="two-d-clip">
            <rect x={pad.l} y={pad.t} width={w} height={h} />
          </clipPath>
        </defs>
        {grid && (
          <g stroke={a.gridColor} strokeWidth={a.gridWidth}>
            {xt.map((t) => (
              <line
                key={"x" + t}
                x1={px(t)}
                x2={px(t)}
                y1={pad.t}
                y2={pad.t + h}
              />
            ))}
            {yt.map((t) => (
              <line
                key={"y" + t}
                x1={pad.l}
                x2={pad.l + w}
                y1={py(t)}
                y2={py(t)}
              />
            ))}
          </g>
        )}
        <g clipPath="url(#two-d-clip)">
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
            x={pad.l + 5}
            y={pad.t + a.titleSize + 3}
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
                  x={pad.l + 5}
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
          <line x1={pad.l} x2={pad.l + w} y1={pad.t + h} y2={pad.t + h} />
          <line x1={pad.l} x2={pad.l} y1={pad.t} y2={pad.t + h} />
          {xt.map((t) => (
            <g key={t}>
              <line x1={px(t)} x2={px(t)} y1={pad.t + h} y2={pad.t + h + 4} />
              <text
                x={px(t)}
                y={pad.t + h + 18}
                stroke="none"
                textAnchor="middle"
              >
                {Number(t.toFixed(3))}
              </text>
            </g>
          ))}
          {yt.map((t) => (
            <g key={t}>
              <line x1={pad.l - 4} x2={pad.l} y1={py(t)} y2={py(t)} />
              <text x={pad.l - 8} y={py(t) + 3} stroke="none" textAnchor="end">
                {Number(t.toFixed(3))}
              </text>
            </g>
          ))}
          <text
            x={pad.l + w / 2}
            y={size.h - 7}
            textAnchor="middle"
            stroke="none"
          >
            F2 ({s.nucleus}, ppm)
          </text>
          <text
            transform={`translate(14,${pad.t + h / 2}) rotate(-90)`}
            textAnchor="middle"
            stroke="none"
          >
            F1 ({m.nucleusF1}, ppm)
          </text>
        </g>
        {cursor && (
          <g data-ui="true" className="crosshair">
            <line x1={cursor.x} x2={cursor.x} y1={pad.t} y2={pad.t + h} />
            <line x1={pad.l} x2={pad.l + w} y1={cursor.y} y2={cursor.y} />
          </g>
        )}
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
      <div className="contour-controls">
        <label>
          Contour level
          <input
            aria-label="Contour level percent"
            type="number"
            min=".01"
            max="80"
            step=".25"
            value={Number(threshold.toFixed(2))}
            onChange={(e) =>
              T(Math.max(0.01, Math.min(80, e.target.valueAsNumber || 1)))
            }
          />
          %
        </label>
        <label>
          <input
            type="checkbox"
            checked={negative}
            onChange={(e) => N(e.target.checked)}
          />
          Negative
        </label>
        <button onClick={full}>Full 2D</button>
      </div>
      <div className="plot-instruction">
        2D · drag to zoom · Space to pan · wheel adjusts contours
        {cursor
          ? ` · F2 ${atX(cursor.x).toFixed(3)} / F1 ${atY(cursor.y).toFixed(3)} ppm`
          : ""}
      </div>
    </div>
  );
}
