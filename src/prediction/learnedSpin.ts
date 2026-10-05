import { firstOrderLines } from "../features/predictionSplitting";
import { simulateSpinSystem } from "./spinSystem";
import type { PredictedSpinSystem, SpinCouplingOverride } from "./types";

/** Simulate independent connected systems in the prediction worker. Signed
 * geminal J enters the isotropic Hamiltonian directly; first-order uses |J|.
 * Exchangeable protons are retained as 1H singlets under fast exchange.
 */
export function renderLearnedSpinSystem(
  system: Omit<PredictedSpinSystem, "display">,
  mode: PredictedSpinSystem["display"]["mode"],
  frequencyMHz: number,
  overrides: SpinCouplingOverride[] = [],
): PredictedSpinSystem {
  const sites = system.sites,
    index = new Map(sites.map((s, i) => [s.id, i])),
    explicit = new Map(sites.map((s) => [s.explicitAtomIndex, s.id]));
  const couplings = system.couplings.map((c) => ({ ...c }));
  for (const override of overrides) {
    const a = explicit.get(override.atomIndexA),
      b = explicit.get(override.atomIndexB);
    if (
      !a ||
      !b ||
      a === b ||
      !Number.isFinite(override.jHz) ||
      Math.abs(override.jHz) > 100
    )
      throw Error(
        "Manual proton J must refer to two existing sites and be between −100 and 100 Hz.",
      );
    const c = couplings.find(
      (c) =>
        (c.siteIdA === a && c.siteIdB === b) ||
        (c.siteIdA === b && c.siteIdB === a),
    );
    if (!c)
      throw Error(
        "This pair is outside the learned model’s two-to-four-bond coupling range.",
      );
    c.jHz = override.jHz;
    c.source = "manual";
  }
  const warnings = [
    "OH/NH/SH couplings are omitted under fast exchange. Signed J predictions cover two to four bonds; solvent, exchange rates, and longer-range couplings are not modeled.",
    "Predicted J values have model uncertainty. Exact simulation means an exact Hamiltonian for these input shifts and couplings, not exact experimental shifts or J values.",
  ];
  // Retain all predicted J values in the model. An explicit sub-resolution
  // cutoff avoids joining disconnected systems through numerical noise.
  const edges = couplings.filter(
    (c) =>
      Math.abs(c.jHz) >= 0.05 &&
      !sites[index.get(c.siteIdA)!].exchangeable &&
      !sites[index.get(c.siteIdB)!].exchangeable,
  );
  if (couplings.some((c) => c.jHz !== 0 && Math.abs(c.jHz) < 0.05))
    warnings.push(
      "J magnitudes below 0.05 Hz are retained in the table but omitted from the display.",
    );
  const clusters: PredictedSpinSystem["display"]["clusters"] = [];
  const firstOrderSite = (s: PredictedSpinSystem["sites"][number]) => {
    const partners = edges.flatMap((c) => {
      const otherId =
        c.siteIdA === s.id
          ? c.siteIdB
          : c.siteIdB === s.id
            ? c.siteIdA
            : undefined;
      if (!otherId) return [];
      const other = sites[index.get(otherId)!];
      return other.equivalenceKey === s.equivalenceKey
        ? []
        : [{ count: 1, jHz: Math.abs(c.jHz) }];
    });
    let lines: { offsetHz: number; weight: number }[];
    try {
      lines = firstOrderLines(partners).lines;
    } catch {
      // Bounded convolution for dense first-order patterns. Preserve all J,
      // the full envelope and unit area; bin only sub-resolution line spacings.
      const span = partners.reduce((n, p) => n + p.jHz, 0);
      const step = Math.max(0.05, span / Math.max(512, 1000 - partners.length));
      let bins = new Map([[0, 1]]);
      for (const p of partners) {
        const next = new Map<number, number>();
        for (const [offset, weight] of bins)
          for (const sign of [-1, 1]) {
            const key = Math.round((offset + (sign * p.jHz) / 2) / step) * step;
            next.set(key, (next.get(key) ?? 0) + weight / 2);
          }
        bins = next;
      }
      lines = [...bins]
        .map(([offsetHz, weight]) => ({ offsetHz, weight }))
        .sort((a, b) => b.offsetHz - a.offsetHz);
      const warning =
        "Dense first-order patterns use bounded frequency bins; all learned J values and proton areas are retained.";
      if (!warnings.includes(warning)) warnings.push(warning);
    }
    clusters.push({
      siteIds: [s.id],
      method: "first-order",
      lines: lines.map((l) => ({
        ppm: s.shiftPpm + l.offsetHz / frequencyMHz,
        weight: l.weight,
      })),
    });
  };
  if (mode === "none") {
    for (const s of sites)
      clusters.push({
        siteIds: [s.id],
        method: "unsplit",
        lines: [{ ppm: s.shiftPpm, weight: 1 }],
      });
  } else if (mode === "first-order") {
    for (const s of sites) firstOrderSite(s);
    warnings.push(
      "First-order rendering omits roofing and magnetic non-equivalence. Select exact spin simulation for second-order effects.",
    );
  } else {
    const adjacent = sites.map(() => [] as number[]);
    for (const c of edges) {
      const a = index.get(c.siteIdA)!,
        b = index.get(c.siteIdB)!;
      adjacent[a].push(b);
      adjacent[b].push(a);
    }
    const visited = new Set<number>();
    for (let start = 0; start < sites.length; start++) {
      if (visited.has(start)) continue;
      const members = [start];
      visited.add(start);
      for (let cursor = 0; cursor < members.length; cursor++)
        for (const next of adjacent[members[cursor]])
          if (!visited.has(next)) {
            visited.add(next);
            members.push(next);
          }
      if (members.length > 10) {
        warnings.push(
          `The ${members.length}-proton connected system is displayed with learned-J first-order splitting. Exact second-order simulation is retained for systems of up to 10 protons; larger systems omit second-order effects.`,
        );
        for (const i of members) firstOrderSite(sites[i]);
        continue;
      }
      const local = new Map(members.map((global, i) => [sites[global].id, i]));
      const lines = simulateSpinSystem(
        members.map((i) => sites[i]),
        edges.flatMap((c) =>
          local.has(c.siteIdA) && local.has(c.siteIdB)
            ? [
                {
                  a: local.get(c.siteIdA)!,
                  b: local.get(c.siteIdB)!,
                  jHz: c.jHz,
                },
              ]
            : [],
        ),
        frequencyMHz,
      );
      clusters.push({
        siteIds: members.map((i) => sites[i].id),
        method: "exact",
        lines,
      });
    }
  }
  return {
    ...system,
    couplings,
    display: { mode, frequencyMHz, clusters, warnings },
  };
}
