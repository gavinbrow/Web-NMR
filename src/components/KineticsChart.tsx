import { useEffect, useId, useRef, useState } from "react";
import type { KineticSeries } from "../features/kinetics";
import type { KineticPoint, KineticFit } from "../model";

const tick = (n: number) =>
  n === 0
    ? "0"
    : Math.abs(n) < 0.001 || Math.abs(n) >= 10000
      ? n.toExponential(2)
      : Number(n.toPrecision(4)).toString();

export function KineticsChart({
  points,
  series,
  fit,
  label = "Integrated area",
  onSelect,
  activeId,
}: {
  points: KineticPoint[];
  series?: KineticSeries[];
  fit: KineticFit | null;
  label?: string;
  onSelect?: (id: string) => void;
  activeId?: string;
}) {
  const host = useRef<HTMLDivElement>(null);
  const clip = useId().replace(/:/g, "");
  const [size, setSize] = useState({ w: 700, h: 350 });
  useEffect(() => {
    if (!host.current) return;
    const observer = new ResizeObserver((entries) => {
      const { width, height } = entries[0].contentRect;
      setSize({ w: Math.max(260, width), h: Math.max(120, height) });
    });
    observer.observe(host.current);
    return () => observer.disconnect();
  }, []);
  const { w, h } = size;
  const pad = { l: w < 450 ? 76 : 88, r: 28, t: 14, b: 47 };
  const displayed = series ?? [
    {
      target: { id: "single", label: "Measurements", color: "#a73249" },
      points,
      fit,
    },
  ];
  const valid = displayed
    .flatMap((s) => s.points)
    .filter((p) => Number.isFinite(p.time) && Number.isFinite(p.value));
  const xs = valid.map((p) => p.time),
    ys = valid.map((p) => p.value);
  const minX = Math.min(0, ...xs),
    maxX = Math.max(minX + 1, ...xs);
  const bottom = Math.min(0, ...ys),
    top = Math.max(0, ...ys);
  const span = top - bottom || Math.max(Math.abs(top), 1);
  const minY = bottom < 0 ? bottom - span * 0.08 : 0;
  const maxY = top + span * 0.1;
  const x = (v: number) =>
    pad.l + ((v - minX) / (maxX - minX)) * (w - pad.l - pad.r);
  const y = (v: number) =>
    h - pad.b - ((v - minY) / (maxY - minY)) * (h - pad.t - pad.b);
  function curvePath(fit: KineticFit | null) {
    if (!fit) return "";
    const curve: [number, number][] = [];
    for (let i = 0; i <= 200; i++) {
      const t = minX + ((maxX - minX) * i) / 200,
        p = fit.parameters,
        dt = t - (p.timeOrigin ?? 0);
      const value =
        fit.model === "linear"
          ? (p.intercept ?? 0) + (p.slope ?? 0) * t
          : fit.model === "decay"
            ? (p.offset ?? 0) +
              (p.amplitude ?? 0) * Math.exp(-(p.rate ?? 0) * dt)
            : (p.offset ?? 0) +
              (p.amplitude ?? 0) * (1 - Math.exp(-(p.rate ?? 0) * dt));
      if (Number.isFinite(value)) curve.push([x(t), y(value)]);
    }
    return curve.map(([a, b], i) => `${i ? "L" : "M"}${a},${b}`).join(" ");
  }
  return (
    <div ref={host} className="kinetics-chart-host">
      <svg
        viewBox={`0 0 ${w} ${h}`}
        className="kinetics-chart"
        role="img"
        aria-label={`${label} against time${fit ? " with fitted curve" : ""}`}
      >
        <rect width={w} height={h} fill="white" />
        <defs>
          <clipPath id={clip}>
            <rect
              x={pad.l - 7}
              y={pad.t - 7}
              width={w - pad.l - pad.r + 14}
              height={h - pad.t - pad.b + 14}
            />
          </clipPath>
        </defs>
        {[0, 0.25, 0.5, 0.75, 1].map((n) => (
          <g key={n}>
            <line
              x1={pad.l}
              x2={w - pad.r}
              y1={y(minY + (maxY - minY) * n)}
              y2={y(minY + (maxY - minY) * n)}
              stroke="#e8ecf2"
            />
            <text
              x={pad.l - 10}
              y={y(minY + (maxY - minY) * n) + 4}
              textAnchor="end"
              fontSize={11}
              fill="#788499"
            >
              {tick(minY + (maxY - minY) * n)}
            </text>
            <text
              x={x(minX + (maxX - minX) * n)}
              y={h - 26}
              textAnchor="middle"
              fontSize={11}
              fill="#788499"
            >
              {tick(minX + (maxX - minX) * n)}
            </text>
          </g>
        ))}
        <g clipPath={`url(#${clip})`}>
          {displayed.map((s) => (
            <g key={s.target.id}>
              {s.fit && (
                <path
                  d={curvePath(s.fit)}
                  stroke={s.target.color}
                  strokeWidth={1.7}
                  fill="none"
                />
              )}
              {s.points
                .filter(
                  (p) => Number.isFinite(p.time) && Number.isFinite(p.value),
                )
                .map((p) => (
                  <g
                    key={p.id}
                    className="kinetics-observation"
                    role={onSelect ? "button" : undefined}
                    tabIndex={onSelect ? 0 : undefined}
                    aria-label={`${s.target.label}, time ${tick(p.time)} minutes, ${label} ${tick(p.value)}`}
                    onClick={() => onSelect?.(p.id)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        onSelect?.(p.id);
                      }
                    }}
                  >
                    <title>{`${s.target.label} · ${tick(p.time)} min · ${tick(p.value)}${p.included ? "" : " · excluded"}`}</title>
                    {p.id === activeId && (
                      <circle
                        cx={x(p.time)}
                        cy={y(p.value)}
                        r={8}
                        fill="none"
                        stroke={s.target.color}
                        strokeOpacity={0.45}
                      />
                    )}
                    <circle
                      cx={x(p.time)}
                      cy={y(p.value)}
                      r={4.5}
                      fill={p.included ? s.target.color : "#b9c1cd"}
                      stroke="white"
                      strokeWidth={1.5}
                    />
                  </g>
                ))}
            </g>
          ))}
        </g>
        <line
          x1={pad.l}
          x2={w - pad.r}
          y1={h - pad.b}
          y2={h - pad.b}
          stroke="#aab4c2"
        />
        <text
          x={(pad.l + w - pad.r) / 2}
          y={h - 8}
          textAnchor="middle"
          fontSize={12}
          fill="#526075"
        >
          Time (min)
        </text>
        <text
          transform={`translate(17,${(pad.t + h - pad.b) / 2}) rotate(-90)`}
          textAnchor="middle"
          fontSize={11}
          fill="#526075"
        >
          {label}
        </text>
      </svg>
    </div>
  );
}
