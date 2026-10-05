export interface SpectrumLabel {
  id: string;
  x: number;
  text: string;
  size: number;
}
export interface PlacedSpectrumLabel extends SpectrumLabel {
  displayText: string;
  center: number;
  width: number;
  y: number;
  lane: number;
}
/** A dedicated annotation band sits outside the trace clip, so labels remain
 * above every signal at any display gain. Dense labels are omitted rather than
 * colliding; complete values remain in the analysis tables and hover titles. */
export function layoutSpectrumLabels(
  labels: SpectrumLabel[],
  left: number,
  right: number,
  maxLanes = 4,
) {
  const lanes: [number, number][][] = Array.from(
    { length: maxLanes },
    () => [],
  );
  const placed: PlacedSpectrumLabel[] = [];
  const rowHeight = Math.max(20, ...labels.map((l) => l.size + 7));
  const maxWidth = Math.min(200, Math.max(20, right - left));
  for (const label of labels) {
    const maxChars = Math.max(
      2,
      Math.floor((maxWidth - 8) / (label.size * 0.64)),
    );
    const displayText =
      label.text.length > maxChars
        ? label.text.slice(0, maxChars - 1) + "…"
        : label.text;
    const width = Math.min(
      maxWidth,
      Math.max(20, displayText.length * label.size * 0.64 + 8),
    );
    const center = Math.max(
      left + width / 2,
      Math.min(right - width / 2, label.x),
    );
    const x1 = center - width / 2,
      x2 = center + width / 2;
    const lane = lanes.findIndex((intervals) =>
      intervals.every(([a, b]) => x2 + 5 < a || x1 - 5 > b),
    );
    if (lane < 0) continue;
    lanes[lane].push([x1, x2]);
    placed.push({
      ...label,
      displayText,
      center,
      width,
      y: label.size + 4 + lane * rowHeight,
      lane,
    });
  }
  return {
    placed,
    hidden: labels.length - placed.length,
    height: placed.length
      ? (1 + Math.max(...placed.map((p) => p.lane))) * rowHeight
      : 0,
  };
}
