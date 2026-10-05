import type { MoleculeDocument } from "./molecule";

type Box = { x: number; y: number; w: number; h: number };
const overlap = (a: Box, b: Box) =>
  Math.max(0, (a.w + b.w) / 2 - Math.abs(a.x - b.x)) *
  Math.max(0, (a.h + b.h) / 2 - Math.abs(a.y - b.y));

/** Put assignment numbers in free space around each vertex, with chemical
 * labels, bonds and previously placed numbers included in the collision cost. */
export function moleculeNumberPositions(
  molecule: MoleculeDocument,
  hydrogens = new Map<string, number>(),
): Map<string, { x: number; y: number }> {
  const atoms = new Map(molecule.atoms.map((a) => [a.id, a]));
  const occupied: Box[] = molecule.atoms.map((a) => {
    const labeled =
      a.element !== "C" ||
      a.charge !== 0 ||
      !!a.isotope ||
      !molecule.bonds.some((b) => b.from === a.id || b.to === a.id);
    const neighbors = molecule.bonds
      .filter((b) => b.from === a.id || b.to === a.id)
      .map((b) => atoms.get(b.from === a.id ? b.to : b.from)!);
    const left = neighbors.reduce((n, b) => n + b.x - a.x, 0) > 8;
    const h = labeled && (hydrogens.get(a.id) ?? 0) > 0;
    return {
      x: a.x + (h ? (left ? -12 : 12) : 0),
      y: a.y,
      w: labeled ? (h ? 46 : 23) : 12,
      h: labeled ? 24 : 12,
    };
  });
  const bondPoints = molecule.bonds.flatMap((b) => {
    const a = atoms.get(b.from),
      c = atoms.get(b.to);
    if (!a || !c) return [];
    return Array.from({ length: 13 }, (_, i) => ({
      x: a.x + ((c.x - a.x) * i) / 12,
      y: a.y + ((c.y - a.y) * i) / 12,
      w: b.order > 1 ? 8 : 5,
      h: b.order > 1 ? 8 : 5,
    }));
  });
  const result = new Map<string, { x: number; y: number }>();
  for (const atom of molecule.atoms) {
    let best: Box = {
        x: atom.x + 17,
        y: atom.y + 17,
        w: String(atom.index).length * 6 + 5,
        h: 14,
      },
      score = Infinity;
    for (const radius of [21, 27, 33, 39])
      for (let angle = 0; angle < 16; angle++) {
        const theta = Math.PI / 4 + (angle * Math.PI) / 8;
        const box = {
          ...best,
          x: atom.x + Math.cos(theta) * radius,
          y: atom.y + Math.sin(theta) * radius,
        };
        const cost =
          occupied.reduce((n, b) => n + overlap(box, b) * 100, 0) +
          bondPoints.reduce((n, b) => n + overlap(box, b) * 20, 0) +
          radius +
          angle * 0.02;
        if (cost < score) {
          score = cost;
          best = box;
        }
      }
    result.set(atom.id, { x: best.x, y: best.y });
    occupied.push(best);
  }
  return result;
}
