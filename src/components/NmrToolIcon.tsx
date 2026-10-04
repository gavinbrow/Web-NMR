import type { ReactNode } from "react";

export type NmrToolIconKind =
  | "integral"
  | "autoIntegral"
  | "phase"
  | "autoPhase"
  | "baseline"
  | "manualBaseline"
  | "apodization"
  | "transform"
  | "peak"
  | "autoPeak"
  | "multiplet"
  | "autoMultiplet"
  | "reference"
  | "increase"
  | "decrease";
export type NmrIconKind = NmrToolIconKind;

const blue = "#1689e9";
const red = "#e64445";
const gray = "#8b929e";
const yellow = "#edbd36";
const peak = "M2 19h5c1.6 0 2.5-.5 3-3l1-11 1 11c.5 2.5 1.4 3 3 3h7";
const splitPeaks =
  "M2 19h3l1-2 1-9 1 9 1 2h1l1-3 1-11 1 11 1 3h1l1-2 1-9 1 9 1 2h3";
const dispersive =
  "M2 13h3c1.8 0 2.1-1 2.7-5 .5-3 1.1-3.8 1.7-1.3l2.9 12c.7 2.8 1.5 2 2-1 .6-3.7.8-4.7 2.7-4.7h5";

function Gear({ x = 18.5, y = 5.5 }: { x?: number; y?: number }) {
  return (
    <g
      transform={`translate(${x} ${y})`}
      stroke={gray}
      strokeWidth="1.15"
      fill="none"
    >
      <path d="M-1-4h2l.4 1.1 1 .5 1.2-.2 1 1.7-.8.9v1.1l.8.9-1 1.7-1.2-.2-1 .5L1 4h-2l-.4-1.1-1-.5-1.2.2-1-1.7.8-.9V-1.1l-.8-.9 1-1.7 1.2.2 1-.5Z" />
      <circle r="1.45" />
    </g>
  );
}

/** Original, compact spectrum drawings; labels are supplied by their parent button. */
export function NmrToolIcon({
  kind,
  size = 20,
  className,
}: {
  kind: NmrToolIconKind;
  size?: number;
  className?: string;
}) {
  let drawing: ReactNode;
  switch (kind) {
    case "integral":
      drawing = (
        <>
          <path d={peak} strokeWidth="1.2" opacity=".8" />
          <path
            d="M2 14h4c2.6 0 3.6-.5 4.2-3.4l.8-3.2c.6-2.5 1.8-2.9 4.2-2.9H22"
            strokeWidth="1.8"
          />
          <path d="M5 21v-2m13 2v-2" stroke={red} strokeWidth="1.4" />
        </>
      );
      break;
    case "autoIntegral":
      drawing = (
        <>
          <path d={peak} strokeWidth="1.3" />
          <path
            d="M2 13h4c2.5 0 3.4-.5 4-3.5l.8-2.6C11.4 4.4 13 4 16 4"
            stroke={red}
            strokeWidth="1.65"
          />
          <Gear x={19} y={7} />
        </>
      );
      break;
    case "phase":
      drawing = (
        <>
          <path d={dispersive} />
          <path d="M20 3v16m-2-14 2-2 2 2m-4 12 2 2 2-2" stroke={red} />
        </>
      );
      break;
    case "autoPhase":
      drawing = (
        <>
          <path d={dispersive} />
          <Gear />
        </>
      );
      break;
    case "baseline":
      drawing = (
        <>
          <path d="M2 20l3-.6 1-2 1-9 1 8.7 1 1.9 2-.4 1-11 1 10.6 2-.4 1-8 1 7.8 1 1 4-.8" />
          <Gear x={19} y={5} />
          <path d="m6 3 3 4 3-4Z" stroke={red} fill={red} strokeWidth=".8" />
        </>
      );
      break;
    case "manualBaseline":
      drawing = (
        <>
          <path d={splitPeaks} />
          <path d="M2 21 8 20l6 1 8-2" stroke={red} />
          {[2, 8, 14, 22].map((x, i) => (
            <circle
              key={x}
              cx={x}
              cy={[21, 20, 21, 19][i]}
              r="1"
              fill={red}
              stroke={red}
              strokeWidth=".7"
            />
          ))}
        </>
      );
      break;
    case "apodization":
      drawing = (
        <>
          <path
            d="M2 12c.6-12 1.2-12 1.8 0s1.2 11 1.8 0 1.2-9.5 1.8 0 1.2 8 1.8 0 1.2-6.5 1.8 0 1.2 5.2 1.8 0 1.2-4 1.8 0 1.2 3 1.8 0 1.2-2.1 1.8 0 1.2 1.4 1.8 0H22"
            strokeWidth="1.1"
          />
          <path
            d="M2 2C5 3 7 6 10 8s7 3.5 12 3.7"
            stroke={red}
            strokeWidth="1.8"
          />
        </>
      );
      break;
    case "transform":
      drawing = (
        <>
          <path
            d="M1.5 14c.7-7 1.3-7 2 0s1.3 6 2 0 1.3-5 2 0 1.3 4 2 0"
            strokeWidth="1.15"
          />
          <path d="M14 19h2l1-2 1-11 1 11 1 2h2.5" />
          <path d="M8 4h7m-2-2 2 2-2 2" stroke={red} />
        </>
      );
      break;
    case "peak":
      drawing = (
        <>
          <path d={peak} />
          <path d="M11 2v3m-2-3h4" stroke={red} strokeWidth="1.8" />
          <path d="m19 10-3 1 1 3" stroke={red} />
        </>
      );
      break;
    case "autoPeak":
      drawing = (
        <>
          <path d={splitPeaks} />
          <path d="M5 3h14" stroke={yellow} strokeWidth="1.7" />
          {[7, 12, 17].map((x) => (
            <path key={x} d={`M${x} 2v3`} stroke={yellow} strokeWidth="1.8" />
          ))}
          <path d="m17 5 1.6 2 1.6-2" stroke={red} />
        </>
      );
      break;
    case "multiplet":
    case "autoMultiplet":
      drawing = (
        <>
          <path d={splitPeaks} />
          <path
            d="M7 5V2h10v3m-5-3v2m3 17v1c0 1.1-2 1.3-2.5 0"
            stroke={red}
            strokeWidth="1.4"
          />
          {kind === "autoMultiplet" && <Gear x={19} y={6} />}
        </>
      );
      break;
    case "reference":
      drawing = (
        <>
          <path d={peak} />
          <path
            d="M2 2h20v4H2Z"
            stroke={yellow}
            fill={yellow}
            fillOpacity=".12"
            strokeWidth="1"
          />
          {[4, 8, 12, 16, 20].map((x) => (
            <path
              key={x}
              d={`M${x} 2v${x === 12 ? 3 : 2}`}
              stroke={yellow}
              strokeWidth="1"
            />
          ))}
          <path d="m11 7-2 3h4Z" stroke={red} fill={red} strokeWidth=".8" />
        </>
      );
      break;
    case "increase":
    case "decrease":
      drawing = (
        <>
          <path d="M2 20h5c2 0 2.5-1 3-4l1-10 1 10c.5 3 1 4 3 4h7" />
          <path
            d={
              kind === "increase"
                ? "M19 16V4m-3 3 3-3 3 3"
                : "M19 4v12m-3-3 3 3 3-3"
            }
            stroke={red}
            strokeWidth="1.8"
          />
        </>
      );
      break;
  }
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={blue}
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className={className}
      data-nmr-icon={kind}
      style={{ flexShrink: 0 }}
    >
      {drawing}
    </svg>
  );
}
