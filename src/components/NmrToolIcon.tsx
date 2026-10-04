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
  | "decrease"
  | "select"
  | "zoom"
  | "pan"
  | "full"
  | "previous"
  | "fitHeight"
  | "normalize"
  | "stack"
  | "overlay"
  | "spectrum"
  | "align"
  | "kinetics"
  | "fitCurve"
  | "open"
  | "save"
  | "openProject"
  | "duplicate"
  | "remove"
  | "moveUp"
  | "moveDown"
  | "table"
  | "integralControls"
  | "reset"
  | "svg"
  | "png"
  | "print"
  | "export"
  | "undo"
  | "redo";
export type NmrIconKind = NmrToolIconKind;

const blue = "#1689e9";
const red = "#e64445";
const gray = "#8b929e";
const yellow = "#edbd36";
const paper = "#dde5ed";
const integral = "M13 3c-3-2-4.5.2-5 4l-1 10c-.4 4-2.5 5.5-5 3";
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
          <path d={integral} strokeWidth="2.1" />
          <path
            d="M11 20h3c1.5 0 2-.5 2.5-3L18 7l1.5 10c.5 2.5 1 3 3 3"
            strokeWidth="1.3"
          />
        </>
      );
      break;
    case "autoIntegral":
      drawing = (
        <>
          <path d={integral} strokeWidth="2" />
          <path d="M11 20h3l1-3 1-8 1 8 1 3h4" strokeWidth="1.3" />
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
    case "select":
      drawing = (
        <path
          d="M5 2v18l5-5 4 7 3-2-4-7h7Z"
          fill={blue}
          fillOpacity=".25"
          stroke={paper}
        />
      );
      break;
    case "zoom":
      drawing = (
        <>
          <circle cx="10" cy="10" r="6.5" fill={blue} fillOpacity=".2" />
          <path d="m15 15 6 6" stroke={yellow} strokeWidth="3" />
          <path d="M6.5 10h7M10 6.5v7" stroke={red} strokeWidth="1.8" />
        </>
      );
      break;
    case "pan":
      drawing = (
        <>
          <path
            d="M7 12V5c0-2 3-2 3 0V3c0-2 3-2 3 0v2c0-2 3-2 3 0v2c0-2 3-2 3 0v9c0 4-2 6-6 6h-2c-2 0-3-1-4-3l-4-6c-1-2 1-3 3-1l1 1"
            fill={blue}
            fillOpacity=".15"
          />
          <path d="M10 5v7m3-7v7m3-5v5" stroke={paper} strokeWidth="1" />
        </>
      );
      break;
    case "full":
      drawing = (
        <>
          <path d="M3 9V3h6m6 0h6v6m0 6v6h-6m-6 0H3v-6" strokeWidth="1.8" />
          <path d="M5 17h4l2-9 2 9h6" stroke={red} />
        </>
      );
      break;
    case "previous":
    case "undo":
    case "redo":
      drawing = (
        <g
          transform={
            kind === "redo" ? "translate(24 0) scale(-1 1)" : undefined
          }
        >
          <path
            d="M9 5 3 11l6 6M3 11h11c5 0 7 3 7 8"
            stroke={kind === "previous" ? blue : red}
            strokeWidth="2"
          />
        </g>
      );
      break;
    case "fitHeight":
    case "normalize":
      drawing = (
        <>
          <path d={kind === "normalize" ? splitPeaks : peak} />
          <path d="M3 4h18M3 2v4m18-4v4" stroke={red} />
          <path d="m18 9 2-2 2 2m-2-2v6" stroke={yellow} />
        </>
      );
      break;
    case "stack":
    case "overlay":
      drawing =
        kind === "stack" ? (
          <>
            <path d="M2 21h6l2-7 2 7h10" />
            <path d="M2 14h10l2-7 2 7h6" stroke={red} />
            <path d="M2 7h4l2-5 2 5h12" stroke={paper} />
          </>
        ) : (
          <>
            <path d="M2 20h7l2-15 2 15h9" />
            <path d="M2 20h10l2-12 2 12h6" stroke={red} />
            <path d="M2 20h4l2-9 2 9h12" stroke={yellow} />
          </>
        );
      break;
    case "spectrum":
    case "svg":
    case "png":
      drawing = (
        <>
          <path
            d="M3 2h12l6 6v14H3Z"
            fill={paper}
            fillOpacity=".12"
            stroke={paper}
          />
          <path d="M15 2v6h6" stroke={gray} />
          <path d="M5 18h4l2-7 2 7h6" stroke={kind === "png" ? red : blue} />
          <path
            d={
              kind === "svg"
                ? "M5 5h5m-5 3h3"
                : kind === "png"
                  ? "M5 5h5m-5 3h5"
                  : "M5 5h4"
            }
            stroke={yellow}
          />
        </>
      );
      break;
    case "align":
      drawing = (
        <>
          <path d="M2 20h7l2-6 2 6h9M2 11h7l2-6 2 6h9" />
          <path d="M11 2v20" stroke={red} strokeDasharray="2 2" />
          <path d="m17 6-2 2 2 2m-2-2h7" stroke={yellow} />
        </>
      );
      break;
    case "kinetics":
    case "fitCurve":
      drawing = (
        <>
          <path d="M3 2v19h19" stroke={paper} />
          <path d="M5 5c5 0 5 10 10 12l6 1" stroke={red} strokeWidth="1.8" />
          {[
            [6, 6],
            [10, 11],
            [15, 16],
            [20, 18],
          ].map(([x, y]) => (
            <circle
              key={x}
              cx={x}
              cy={y}
              r="1.25"
              fill={yellow}
              stroke={yellow}
            />
          ))}
          {kind === "fitCurve" && <Gear x={19} y={5} />}
        </>
      );
      break;
    case "open":
      drawing = (
        <>
          <path
            d="M2 6V3h8l2 3h10v14H2Z"
            fill={yellow}
            fillOpacity=".18"
            stroke={yellow}
          />
          <path
            d="M2 20 5 9h18l-3 11Z"
            fill={yellow}
            fillOpacity=".2"
            stroke={yellow}
          />
          <path d="M6 7h10" stroke={paper} />
        </>
      );
      break;
    case "save":
      drawing = (
        <>
          <path d="M3 2h16l3 3v17H3Z" fill={blue} fillOpacity=".2" />
          <path
            d="M7 2v7h10V2M7 22v-9h11v9"
            fill={paper}
            fillOpacity=".7"
            stroke={paper}
          />
          <path d="M14 3v4M9 17h7m-7 3h7" stroke={gray} />
        </>
      );
      break;
    case "openProject":
    case "export":
      drawing = (
        <>
          <path
            d="M3 2h12l6 6v14H3Z"
            stroke={paper}
            fill={paper}
            fillOpacity=".1"
          />
          <path d="M15 2v6h6" stroke={gray} />
          <path
            d={
              kind === "openProject"
                ? "M12 21V10m-4 4 4-4 4 4"
                : "M12 10v11m-4-4 4 4 4-4"
            }
            stroke={blue}
            strokeWidth="2"
          />
          <path d="M6 5h5" stroke={red} />
        </>
      );
      break;
    case "duplicate":
      drawing = (
        <>
          <path d="M3 3h13v15H3Z" stroke={gray} />
          <path d="M8 7h13v15H8Z" fill={blue} fillOpacity=".15" />
          <path d="M11 15h7m-3.5-3.5v7" stroke={red} />
        </>
      );
      break;
    case "remove":
      drawing = (
        <>
          <path d="M5 6 6 22h12l1-16M3 6h18M9 6V2h6v4" stroke={gray} />
          <path d="M10 10v8m4-8v8" stroke={red} strokeWidth="1.8" />
        </>
      );
      break;
    case "moveUp":
    case "moveDown":
      drawing = (
        <>
          <path d="M2 5h9M2 12h9M2 19h9" stroke={blue} />
          <path
            d={
              kind === "moveUp"
                ? "M18 21V3m-4 4 4-4 4 4"
                : "M18 3v18m-4-4 4 4 4-4"
            }
            stroke={red}
            strokeWidth="1.8"
          />
        </>
      );
      break;
    case "table":
      drawing = (
        <>
          <path
            d="M2 3h20v18H2Z"
            stroke={paper}
            fill={paper}
            fillOpacity=".12"
          />
          <path
            d="M2 8h20M2 13h20M2 17h20M9 8v13M16 8v13"
            stroke={gray}
            strokeWidth="1"
          />
          <path d="M2 3h20v5H2Z" fill={blue} stroke={blue} fillOpacity=".55" />
          <path d="M11 11h3" stroke={red} />
        </>
      );
      break;
    case "integralControls":
      drawing = (
        <>
          <path d={integral} strokeWidth="1.8" />
          <path d="M17 2v20m5-20v20" stroke={gray} />
          <path d="M15 7h4m1 9h4" stroke={red} strokeWidth="3" />
        </>
      );
      break;
    case "reset":
      drawing = (
        <>
          <path d="M4 8a9 9 0 1 1-1 8M4 2v6h6" stroke={red} strokeWidth="1.8" />
          <path d="M6 17h4l2-9 2 9h4" />
        </>
      );
      break;
    case "print":
      drawing = (
        <>
          <path
            d="M6 8V2h12v6M6 18H2V8h20v10h-4"
            stroke={gray}
            fill={gray}
            fillOpacity=".2"
          />
          <path
            d="M6 14h12v8H6Z"
            stroke={paper}
            fill={paper}
            fillOpacity=".45"
          />
          <path d="M9 17h6m-6 3h6" stroke={blue} />
          <circle cx="18" cy="11" r="1" fill={red} stroke={red} />
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
