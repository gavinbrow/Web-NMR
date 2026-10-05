import {
  addMoleculeAtom,
  addMoleculeBond,
  moleculeBondLength,
  moleculeChanged,
  type MoleculeDocument,
  type MoleculeBond,
} from "./molecule";
export type DrawingPoint = { x: number; y: number };
export type DrawingHit = { atomId?: string; bondId?: string };
export function drawingHit(
  document: MoleculeDocument,
  p: DrawingPoint,
  tolerance = 12,
): DrawingHit {
  const atom = document.atoms
    .map((a) => ({ a, d: Math.hypot(a.x - p.x, a.y - p.y) }))
    .sort((a, b) => a.d - b.d)[0];
  if (atom && atom.d <= tolerance) return { atomId: atom.a.id };
  const bonds = document.bonds
    .map((b) => {
      const a = document.atoms.find((a) => a.id === b.from)!,
        c = document.atoms.find((a) => a.id === b.to)!;
      const dx = c.x - a.x,
        dy = c.y - a.y,
        t = Math.max(
          0,
          Math.min(
            1,
            ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy || 1),
          ),
        );
      return { b, d: Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy) };
    })
    .sort((a, b) => a.d - b.d)[0];
  return bonds && bonds.d <= tolerance * 0.6 ? { bondId: bonds.b.id } : {};
}
/** Choose a free valence direction, preferring conventional zigzag geometry. */
export function nextBondAngle(
  document: MoleculeDocument,
  atomId?: string,
): number {
  const atom = document.atoms.find((a) => a.id === atomId);
  if (!atom) return -Math.PI / 6;
  const angles = document.bonds
    .filter((b) => b.from === atom.id || b.to === atom.id)
    .map((b) =>
      document.atoms.find(
        (a) => a.id === (b.from === atom.id ? b.to : b.from),
      )!,
    )
    .map((a) => Math.atan2(a.y - atom.y, a.x - atom.x));
  if (!angles.length) return -Math.PI / 6;
  const candidates = Array.from(
    { length: 12 },
    (_, i) => (i * Math.PI) / 6 - Math.PI,
  );
  const angleDistance = (a: number, b: number) =>
    Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));
  const scored = candidates.map((angle) => {
    const separation = Math.min(...angles.map((a) => angleDistance(a, angle)));
    const endpoint = {
      x: atom.x + Math.cos(angle) * moleculeBondLength,
      y: atom.y + Math.sin(angle) * moleculeBondLength,
    };
    const crowding = document.atoms
      .filter((a) => a.id !== atomId)
      .reduce(
        (n, a) =>
          n + Math.max(0, 65 - Math.hypot(a.x - endpoint.x, a.y - endpoint.y)),
        0,
      );
    // A terminal chain should turn 120°, rather than continue as a straight line.
    const preferred =
      angles.length === 1
        ? Math.min(
            angleDistance(angle, angles[0] + (2 * Math.PI) / 3),
            angleDistance(angle, angles[0] - (2 * Math.PI) / 3),
          )
        : 0;
    return {
      angle,
      score:
        separation - crowding * 0.04 - preferred * 1.8 + Math.cos(angle) * 0.08,
    };
  });
  return scored.sort((a, b) => b.score - a.score)[0].angle;
}
export function bondEndpoint(
  document: MoleculeDocument,
  start: DrawingPoint,
  p: DrawingPoint,
  atomId?: string,
  free = false,
): DrawingPoint {
  const distance = Math.hypot(p.x - start.x, p.y - start.y);
  const existing = document.atoms
    .filter((a) => a.id !== atomId)
    .find((a) => Math.hypot(a.x - p.x, a.y - p.y) < 12);
  if (existing && distance > 12) return { x: existing.x, y: existing.y };
  let angle =
    distance < 12
      ? nextBondAngle(document, atomId)
      : Math.atan2(p.y - start.y, p.x - start.x);
  if (!free) angle = (Math.round(angle / (Math.PI / 6)) * Math.PI) / 6;
  const length = free && distance > 12 ? distance : moleculeBondLength;
  return {
    x: start.x + Math.cos(angle) * length,
    y: start.y + Math.sin(angle) * length,
  };
}
export function drawBond(
  document: MoleculeDocument,
  start: DrawingPoint,
  end: DrawingPoint,
  atomId?: string,
  element = "C",
  properties: Partial<MoleculeBond> = {},
): MoleculeDocument {
  let result = document,
    from = atomId;
  if (!from) {
    const a = addMoleculeAtom(result, "C", start.x, start.y);
    result = a.document;
    from = a.atom.id;
  }
  let target = result.atoms.find(
    (a) => a.id !== from && Math.hypot(a.x - end.x, a.y - end.y) < 12,
  );
  if (!target) {
    const a = addMoleculeAtom(result, element, end.x, end.y);
    result = a.document;
    target = a.atom;
  }
  return addMoleculeBond(result, from, target.id, properties);
}
export function drawChain(
  document: MoleculeDocument,
  start: DrawingPoint,
  p: DrawingPoint,
  atomId?: string,
): MoleculeDocument {
  const distance = Math.hypot(p.x - start.x, p.y - start.y),
    count = Math.max(
      1,
      Math.min(24, Math.round(distance / (moleculeBondLength * 0.866))),
    );
  const angle =
    distance < 12
      ? nextBondAngle(document, atomId)
      : (Math.round(Math.atan2(p.y - start.y, p.x - start.x) / (Math.PI / 6)) *
          Math.PI) /
        6;
  let result = document,
    from = atomId,
    current = start;
  if (!from) {
    const a = addMoleculeAtom(result, "C", start.x, start.y);
    result = a.document;
    from = a.atom.id;
  }
  for (let i = 0; i < count; i++) {
    const theta = angle + ((i % 2 === 0 ? -1 : 1) * Math.PI) / 6;
    const end = {
      x: current.x + Math.cos(theta) * moleculeBondLength,
      y: current.y + Math.sin(theta) * moleculeBondLength,
    };
    let target = result.atoms.find(
      (a) => a.id !== from && Math.hypot(a.x - end.x, a.y - end.y) < 10,
    );
    if (!target) {
      const a = addMoleculeAtom(result, "C", end.x, end.y);
      result = a.document;
      target = a.atom;
    }
    result = addMoleculeBond(result, from, target.id);
    from = target.id;
    current = target;
  }
  return result;
}
/** Place an isolated ring, attach it at an atom, or fuse it along an existing bond. */
export function placeDrawingRing(
  document: MoleculeDocument,
  p: DrawingPoint,
  size: number,
  aromatic: boolean,
  hit: DrawingHit = {},
): MoleculeDocument {
  const radius = moleculeBondLength / (2 * Math.sin(Math.PI / size));
  const atom = document.atoms.find((a) => a.id === hit.atomId),
    bond = document.bonds.find((b) => b.id === hit.bondId);
  let points: DrawingPoint[] = [],
    shared: Record<number, string> = {};
  if (bond) {
    const a = document.atoms.find((a) => a.id === bond.from)!,
      b = document.atoms.find((a) => a.id === bond.to)!;
    const length = Math.hypot(b.x - a.x, b.y - a.y),
      nx = -(b.y - a.y) / length,
      ny = (b.x - a.x) / length,
      mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
      apothem = length / (2 * Math.tan(Math.PI / size));
    const crowd = (side: number) =>
      document.atoms
        .filter((c) => c.id !== a.id && c.id !== b.id)
        .reduce(
          (n, c) =>
            n +
            1 /
              (Math.hypot(
                c.x - mid.x - nx * apothem * side,
                c.y - mid.y - ny * apothem * side,
              ) +
                1),
          0,
        );
    const side = crowd(1) <= crowd(-1) ? 1 : -1;
    const center = {
      x: mid.x + nx * apothem * side,
      y: mid.y + ny * apothem * side,
    };
    const angle = Math.atan2(a.y - center.y, a.x - center.x),
      r = length / (2 * Math.sin(Math.PI / size));
    points = Array.from({ length: size }, (_, i) => ({
      x: center.x + r * Math.cos(angle + (side * i * 2 * Math.PI) / size),
      y: center.y + r * Math.sin(angle + (side * i * 2 * Math.PI) / size),
    }));
    // Determine winding that makes vertex 1 land exactly on the second shared atom.
    if (Math.hypot(points[1].x - b.x, points[1].y - b.y) > 1)
      points = Array.from({ length: size }, (_, i) => ({
        x: center.x + r * Math.cos(angle - (side * i * 2 * Math.PI) / size),
        y: center.y + r * Math.sin(angle - (side * i * 2 * Math.PI) / size),
      }));
    points[0] = a;
    points[1] = b;
    shared = { 0: a.id, 1: b.id };
  } else {
    const direction = atom ? nextBondAngle(document, atom.id) : 0;
    const center = atom
      ? {
          x: atom.x + Math.cos(direction) * radius,
          y: atom.y + Math.sin(direction) * radius,
        }
      : p;
    const angle = atom ? direction + Math.PI : -Math.PI / 2;
    points = Array.from({ length: size }, (_, i) => ({
      x: center.x + radius * Math.cos(angle + (i * 2 * Math.PI) / size),
      y: center.y + radius * Math.sin(angle + (i * 2 * Math.PI) / size),
    }));
    if (atom) shared[0] = atom.id;
  }
  let result = document;
  const ids: string[] = [];
  points.forEach((point, i) => {
    if (shared[i]) {
      ids.push(shared[i]);
      return;
    }
    const a = addMoleculeAtom(result, "C", point.x, point.y);
    result = a.document;
    ids.push(a.atom.id);
  });
  for (let i = 0; i < size; i++) {
    const existing = result.bonds.find(
      (b) =>
        (b.from === ids[i] && b.to === ids[(i + 1) % size]) ||
        (b.to === ids[i] && b.from === ids[(i + 1) % size]),
    );
    if (existing && !aromatic) continue;
    result = addMoleculeBond(result, ids[i], ids[(i + 1) % size], {
      order: aromatic && i % 2 === 0 ? 2 : 1,
      aromatic,
    });
  }
  if (aromatic && bond) {
    // Fusing alternating rings can put two formal double bonds on a shared atom.
    // Let the chemistry layer localize the connected aromatic system as a whole.
    const component = new Set(ids);
    let changed = true;
    while (changed) {
      changed = false;
      for (const edge of result.bonds)
        if (
          edge.aromatic &&
          (component.has(edge.from) || component.has(edge.to))
        ) {
          if (!component.has(edge.from) || !component.has(edge.to))
            changed = true;
          component.add(edge.from);
          component.add(edge.to);
        }
    }
    result = moleculeChanged({
      ...result,
      bonds: result.bonds.map((edge) =>
        edge.aromatic && component.has(edge.from)
          ? { ...edge, order: 1 as const }
          : edge,
      ),
    });
  }
  return result;
}
export function moveDrawingAtoms(
  document: MoleculeDocument,
  ids: string[],
  delta: DrawingPoint,
) {
  return moleculeChanged({
    ...document,
    atoms: document.atoms.map((a) =>
      ids.includes(a.id) ? { ...a, x: a.x + delta.x, y: a.y + delta.y } : a,
    ),
  });
}
export function drawingFragment(
  document: MoleculeDocument,
  ids: string[],
): MoleculeDocument {
  const atoms = document.atoms.filter((a) => ids.includes(a.id));
  return {
    ...document,
    atoms,
    bonds: document.bonds.filter(
      (b) => ids.includes(b.from) && ids.includes(b.to),
    ),
  };
}
export function mergeDrawing(
  document: MoleculeDocument,
  fragment: MoleculeDocument,
  offset: DrawingPoint,
): MoleculeDocument {
  let result = document;
  const ids = new Map<string, string>();
  for (const atom of fragment.atoms) {
    const a = addMoleculeAtom(
      result,
      atom.element,
      atom.x + offset.x,
      atom.y + offset.y,
    );
    result = a.document;
    ids.set(atom.id, a.atom.id);
    result = {
      ...result,
      atoms: result.atoms.map((b) =>
        b.id === a.atom.id
          ? { ...b, charge: atom.charge, isotope: atom.isotope }
          : b,
      ),
    };
  }
  for (const bond of fragment.bonds)
    result = addMoleculeBond(result, ids.get(bond.from)!, ids.get(bond.to)!, {
      order: bond.order,
      aromatic: bond.aromatic,
      stereo: bond.stereo,
    });
  return result;
}
