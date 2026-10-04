export interface ContourGrid {
  x: Float64Array;
  y: Float64Array;
  real: Float64Array;
  width: number;
  height: number;
}
/** Sample the visible matrix by signed extrema, retaining narrow crosspeaks during zoom-out. */
export function visibleGrid(
  matrix: ContourGrid,
  xView: [number, number],
  yView: [number, number],
  resolution = 420,
): ContourGrid {
  const bounds = (axis: Float64Array, v: [number, number]) => {
    let lo = axis.length - 1,
      hi = 0;
    const min = Math.min(...v),
      max = Math.max(...v);
    for (let i = 0; i < axis.length; i++)
      if (axis[i] >= min && axis[i] <= max) {
        lo = Math.min(lo, i);
        hi = Math.max(hi, i);
      }
    return hi < lo
      ? [0, axis.length - 1]
      : [Math.max(0, lo - 1), Math.min(axis.length - 1, hi + 1)];
  };
  const [xl, xh] = bounds(matrix.x, xView),
    [yl, yh] = bounds(matrix.y, yView),
    sx = Math.max(1, Math.ceil((xh - xl + 1) / resolution)),
    sy = Math.max(1, Math.ceil((yh - yl + 1) / resolution));
  const nx = Math.ceil((xh - xl + 1) / sx),
    ny = Math.ceil((yh - yl + 1) / sy),
    x = new Float64Array(nx),
    y = new Float64Array(ny),
    real = new Float64Array(nx * ny);
  for (let i = 0; i < nx; i++)
    x[i] = matrix.x[Math.min(xh, xl + i * sx + Math.floor(sx / 2))];
  for (let j = 0; j < ny; j++) {
    y[j] = matrix.y[Math.min(yh, yl + j * sy + Math.floor(sy / 2))];
    for (let i = 0; i < nx; i++) {
      let value = 0;
      for (let r = yl + j * sy; r <= Math.min(yh, yl + (j + 1) * sy - 1); r++)
        for (
          let c = xl + i * sx;
          c <= Math.min(xh, xl + (i + 1) * sx - 1);
          c++
        ) {
          const v = matrix.real[r * matrix.width + c];
          if (Math.abs(v) > Math.abs(value)) value = v;
        }
      real[j * nx + i] = value;
    }
  }
  return { x, y, real, width: nx, height: ny };
}
/** Independent marching-squares contour lines in ppm coordinates, with saddle ambiguity resolved by the cell center. */
export function contourPath(
  g: ContourGrid,
  level: number,
  xPixel: (x: number) => number,
  yPixel: (y: number) => number,
): string {
  if (!Number.isFinite(level) || g.width < 2 || g.height < 2) return "";
  let path = "";
  for (let row = 0; row < g.height - 1; row++)
    for (let col = 0; col < g.width - 1; col++) {
      const values = [
          g.real[row * g.width + col],
          g.real[row * g.width + col + 1],
          g.real[(row + 1) * g.width + col + 1],
          g.real[(row + 1) * g.width + col],
        ],
        points = [
          [g.x[col], g.y[row]],
          [g.x[col + 1], g.y[row]],
          [g.x[col + 1], g.y[row + 1]],
          [g.x[col], g.y[row + 1]],
        ];
      const crossings: { edge: number; x: number; y: number }[] = [];
      for (let edge = 0; edge < 4; edge++) {
        const next = (edge + 1) % 4,
          a = values[edge],
          b = values[next];
        if (a >= level === b >= level) continue;
        const t = (level - a) / (b - a);
        crossings.push({
          edge,
          x: points[edge][0] + t * (points[next][0] - points[edge][0]),
          y: points[edge][1] + t * (points[next][1] - points[edge][1]),
        });
      }
      const segment = (
        a: (typeof crossings)[number],
        b: (typeof crossings)[number],
      ) => {
        path += `M${xPixel(a.x).toFixed(2)},${yPixel(a.y).toFixed(2)}L${xPixel(b.x).toFixed(2)},${yPixel(b.y).toFixed(2)}`;
      };
      if (crossings.length === 2) segment(crossings[0], crossings[1]);
      else if (crossings.length === 4) {
        const centerAbove = values.reduce((a, b) => a + b, 0) / 4 >= level;
        if (centerAbove === values[0] >= level) {
          segment(crossings[0], crossings[1]);
          segment(crossings[2], crossings[3]);
        } else {
          segment(crossings[0], crossings[3]);
          segment(crossings[1], crossings[2]);
        }
      }
    }
  return path;
}
