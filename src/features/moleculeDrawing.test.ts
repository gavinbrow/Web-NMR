import { describe, it, expect } from "vitest";
import { Molecule } from "openchemlib";
import {
  emptyMolecule,
  exportMoleculeSmiles,
  validateMolecule,
  importMolecule,
  moleculeImplicitHydrogens,
  moleculeDisplayBondOrders,
} from "./molecule";
import {
  drawingHit,
  bondEndpoint,
  drawBond,
  drawChain,
  placeDrawingRing,
  moveDrawingAtoms,
  mergeDrawing,
} from "./moleculeDrawing";
describe("molecule drawing gestures", () => {
  it("depicts correct implicit H and localized aromatic bonds without renumbering", () => {
    const ethanol = importMolecule("CCO"),
      counts = moleculeImplicitHydrogens(ethanol);
    expect(ethanol.atoms.map((a) => counts.get(a.id))).toEqual([3, 2, 1]);
    const co = importMolecule("CO"),
      a = co.atoms[0],
      explicit = drawBond(co, a, { x: a.x, y: a.y - 48 }, a.id, "H"),
      explicitCounts = moleculeImplicitHydrogens(explicit);
    expect(explicit.atoms.map((a) => explicitCounts.get(a.id))).toEqual([
      2, 1, 0,
    ]);
    const ring = placeDrawingRing(emptyMolecule(), { x: 0, y: 0 }, 6, true),
      edge = ring.bonds[0];
    const fused = placeDrawingRing(ring, { x: 0, y: 0 }, 6, true, {
      bondId: edge.id,
    });
    expect(
      [...moleculeDisplayBondOrders(fused).values()].filter(
        (order) => order === 2,
      ),
    ).toHaveLength(5);
    expect(
      [...moleculeImplicitHydrogens(fused).values()].reduce(
        (sum, n) => sum + n,
        0,
      ),
    ).toBe(8);
  });
  it("extends a clicked endpoint as a zigzag without overlapping atoms", () => {
    let doc = emptyMolecule();
    let start = { x: 0, y: 0 };
    doc = drawBond(doc, start, bondEndpoint(doc, start, start));
    for (let i = 0; i < 4; i++) {
      const atom = doc.atoms.at(-1)!;
      doc = drawBond(
        doc,
        atom,
        bondEndpoint(doc, atom, atom, atom.id),
        atom.id,
      );
    }
    expect(doc.atoms).toHaveLength(6);
    expect(doc.bonds).toHaveLength(5);
    expect(exportMoleculeSmiles(doc)).toBe("CCCCCC");
    for (const a of doc.atoms)
      for (const b of doc.atoms)
        if (a !== b)
          expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThan(35);
  });
  it("snaps to existing atoms to close a ring instead of creating duplicates", () => {
    const chain = drawChain(emptyMolecule(), { x: 0, y: 0 }, { x: 170, y: 0 });
    const a = chain.atoms[0],
      b = chain.atoms.at(-1)!;
    const next = drawBond(
      chain,
      b,
      bondEndpoint(chain, b, { x: a.x + 2, y: a.y + 1 }, b.id),
      b.id,
    );
    expect(next.atoms).toHaveLength(chain.atoms.length);
    expect(next.bonds).toHaveLength(chain.bonds.length + 1);
    expect(drawingHit(next, a, 12).atomId).toBe(a.id);
    expect(validateMolecule(next)).toEqual([]);
  });
  it("fuses benzene along a bond using the unoccupied side and shares just two atoms", () => {
    const ring = placeDrawingRing(emptyMolecule(), { x: 0, y: 0 }, 6, true);
    const b = ring.bonds[0],
      a = ring.atoms.find((a) => a.id === b.from)!,
      c = ring.atoms.find((a) => a.id === b.to)!;
    const fused = placeDrawingRing(
      ring,
      { x: (a.x + c.x) / 2, y: (a.y + c.y) / 2 },
      6,
      true,
      { bondId: b.id },
    );
    expect(fused.atoms).toHaveLength(10);
    expect(fused.bonds).toHaveLength(11);
    expect(validateMolecule(fused)).toEqual([]);
    expect(Molecule.fromSmiles(exportMoleculeSmiles(fused)).getIDCode()).toBe(
      Molecule.fromSmiles("c1ccc2ccccc2c1").getIDCode(),
    );
    for (const x of fused.atoms)
      for (const y of fused.atoms)
        if (x !== y)
          expect(Math.hypot(x.x - y.x, x.y - y.y)).toBeGreaterThan(35);
  });
  it("moves atoms and pastes fragments with new stable assignment identities", () => {
    const source = importMolecule("CO");
    const moved = moveDrawingAtoms(source, [source.atoms[0].id], {
      x: 25,
      y: 5,
    });
    expect(moved.atoms[0].id).toBe(source.atoms[0].id);
    expect(moved.atoms[0].x).toBe(source.atoms[0].x + 25);
    const merged = mergeDrawing(source, source, { x: 160, y: 0 });
    expect(merged.atoms.map((a) => a.index)).toEqual([1, 2, 3, 4]);
    expect(new Set(merged.atoms.map((a) => a.id)).size).toBe(4);
    expect(exportMoleculeSmiles(merged)).toBe("CO.CO");
    expect(validateMolecule(merged)).toEqual([]);
  });
});
