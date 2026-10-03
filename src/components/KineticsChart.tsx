import type { KineticPoint, KineticFit } from "../model";
export function KineticsChart({
  points,
  fit,
}: {
  points: KineticPoint[];
  fit: KineticFit | null;
}) {
  const w = 700,
    h = 300,
    pad = { l: 65, r: 25, t: 26, b: 44 };
  const xs = points.map((p) => p.time),
    ys = points.map((p) => p.value);
  const minX = Math.min(0, ...xs),
    maxX = Math.max(1, ...xs),
    minY = Math.min(0, ...ys),
    maxY = Math.max(1e-12, ...ys) * 1.1;
  const x = (v: number) =>
      pad.l + ((v - minX) / (maxX - minX)) * (w - pad.l - pad.r),
    y = (v: number) =>
      h - pad.b - ((v - minY) / (maxY - minY)) * (h - pad.t - pad.b);
  const curve: number[][] = [];
  if (fit) {
    for (let i = 0; i <= 100; i++) {
      const t = minX + ((maxX - minX) * i) / 100;
      const p = fit.parameters,
        dt = t - (p.timeOrigin ?? 0);
      const v =
        fit.model === "linear"
          ? (p.intercept ?? 0) + (p.slope ?? 0) * t
          : fit.model === "decay"
            ? (p.offset ?? 0) +
              (p.amplitude ?? 0) * Math.exp(-(p.rate ?? 0) * dt)
            : (p.offset ?? 0) +
              (p.amplitude ?? 0) * (1 - Math.exp(-(p.rate ?? 0) * dt));
      curve.push([x(t), y(v)]);
    }
  }
  return (
    <svg
      viewBox={`0 0 ${w} ${h}`}
      className="kinetics-chart"
      role="img"
      aria-label="Integrated signal against time with fitted curve"
    >
      <rect width={w} height={h} fill="white" />
      {[0, 0.25, 0.5, 0.75, 1].map((n) => (
        <g key={n}>
          <line
            x1={pad.l}
            x2={w - pad.r}
            y1={y(minY + (maxY - minY) * n)}
            y2={y(minY + (maxY - minY) * n)}
            stroke="#e6e8ec"
          />
          <text
            x={pad.l - 10}
            y={y(minY + (maxY - minY) * n) + 4}
            textAnchor="end"
            fontSize="10"
            fill="#66717a"
          >
            {(minY + (maxY - minY) * n).toPrecision(3)}
          </text>
          <text
            x={x(minX + (maxX - minX) * n)}
            y={h - 23}
            textAnchor="middle"
            fontSize="10"
            fill="#66717a"
          >
            {(minX + (maxX - minX) * n).toFixed(1)}
          </text>
        </g>
      ))}
      {fit && (
        <path
          d={curve.map(([a, b], i) => `${i ? "L" : "M"}${a},${b}`).join(" ")}
          stroke="#a73249"
          strokeWidth="2"
          fill="none"
        />
      )}
      {points.map((p) => (
        <circle
          key={p.id}
          cx={x(p.time)}
          cy={y(p.value)}
          r="4.5"
          fill={p.included ? "#a73249" : "#c1c5cb"}
          stroke="white"
          strokeWidth="1.5"
        />
      ))}
      <line
        x1={pad.l}
        x2={w - pad.r}
        y1={h - pad.b}
        y2={h - pad.b}
        stroke="#a6adb4"
      />
      <text
        x={w / 2}
        y={h - 5}
        textAnchor="middle"
        fontSize="11"
        fill="#505a65"
      >
        Time (min)
      </text>
      <text
        transform={`translate(14,${h / 2}) rotate(-90)`}
        textAnchor="middle"
        fontSize="11"
        fill="#505a65"
      >
        Integrated area
      </text>
      <text x={pad.l} y="15" fontSize="11" fill="#505a65">
        Signal measurement · display gain excluded
      </text>
    </svg>
  );
}
