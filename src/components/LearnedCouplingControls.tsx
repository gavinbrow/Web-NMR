import type { PredictionSetup } from "../features/predictionSetup";
import type { PredictionResult } from "../prediction/types";

export function LearnedCouplingControls(p: {
  result: PredictionResult | null;
  setup: PredictionSetup;
  disabled: boolean;
  onChange: (patch: Partial<PredictionSetup>) => void;
}) {
  const system = p.result?.spinSystem;
  if (!system)
    return (
      <p className="prediction-splitting-note">
        {p.setup.experiment === "COSY"
          ? "Predict"
          : "Enable splitting and predict"}{" "}
        the structure to calculate per-proton J values. The local 3D model
        includes geminal, vicinal, and four-bond couplings.
      </p>
    );
  const site = new Map(system.sites.map((s) => [s.id, s]));
  const label = (id: string) => {
    const s = site.get(id)!,
      atom = p.setup.molecule?.atoms[s.atomIndex];
    return `${atom?.element ?? "C"}${atom?.index ?? s.atomIndex + 1} ${s.atomLabel}`;
  };
  const grouped = new Map<string, typeof system.couplings>();
  for (const coupling of system.couplings) {
    if (
      site.get(coupling.siteIdA)!.equivalenceKey ===
      site.get(coupling.siteIdB)!.equivalenceKey
    )
      continue;
    const key =
      coupling.equivalenceKey ?? `${coupling.siteIdA}:${coupling.siteIdB}`;
    const group = grouped.get(key) ?? [];
    group.push(coupling);
    grouped.set(key, group);
  }
  return (
    <details className="prediction-couplings">
      <summary>Learned J couplings · {system.couplings.length} pairs</summary>
      <p className="prediction-splitting-note">
        Signed J / Hz from FullSSPrUCe. Model spread measures agreement between
        model heads. Symmetry-equivalent pairs are edited together; OH/NH/SH are
        displayed as singlets. Enter 0 to remove a connection, then predict
        again.
      </p>
      {[...grouped.values()].map((group) => {
        const c = group[0];
        const a = site.get(c.siteIdA)!,
          b = site.get(c.siteIdB)!;
        const overrides = p.setup.spinCouplingOverrides ?? [];
        const override = overrides.find(
          (o) =>
            (o.atomIndexA === a.explicitAtomIndex &&
              o.atomIndexB === b.explicitAtomIndex) ||
            (o.atomIndexA === b.explicitAtomIndex &&
              o.atomIndexB === a.explicitAtomIndex),
        );
        return (
          <label className="prediction-coupling-row" key={`${a.id}:${b.id}`}>
            <span>
              <strong>
                {label(a.id)} ↔ {label(b.id)}
              </strong>
              <small>
                {c.bondDistance} bonds
                {group.length > 1
                  ? ` · ${group.length} equivalent pairs`
                  : ""}{" "}
                · model {c.predictedJHz.toFixed(2)} · spread{" "}
                {c.modelStdHz.toFixed(2)} Hz
              </small>
            </span>
            <input
              type="number"
              aria-label={`J ${label(a.id)}–${label(b.id)} (Hz)`}
              min={-100}
              max={100}
              step={0.1}
              disabled={p.disabled}
              value={override?.jHz ?? Number(c.predictedJHz.toFixed(3))}
              onChange={(e) => {
                const jHz = e.target.valueAsNumber;
                if (!Number.isFinite(jHz) || Math.abs(jHz) > 100) return;
                const pairs = group.map((pair) => ({
                  atomIndexA: site.get(pair.siteIdA)!.explicitAtomIndex,
                  atomIndexB: site.get(pair.siteIdB)!.explicitAtomIndex,
                }));
                const rest = overrides.filter(
                  (o) =>
                    !pairs.some(
                      (pair) =>
                        (o.atomIndexA === pair.atomIndexA &&
                          o.atomIndexB === pair.atomIndexB) ||
                        (o.atomIndexA === pair.atomIndexB &&
                          o.atomIndexB === pair.atomIndexA),
                    ),
                );
                p.onChange({
                  spinCouplingOverrides: [
                    ...rest,
                    ...pairs.map((pair) => ({ ...pair, jHz })),
                  ],
                });
              }}
            />
          </label>
        );
      })}
      {!!p.setup.spinCouplingOverrides?.length && (
        <button
          disabled={p.disabled}
          onClick={() => p.onChange({ spinCouplingOverrides: [] })}
        >
          Restore learned J values
        </button>
      )}
      <p className="prediction-splitting-note">
        Exact simulation includes roofing and magnetic non-equivalence for
        connected systems up to 10 protons. Larger systems can use the learned
        first-order display. The coupling model supports up to 64 atoms
        including hydrogens.
      </p>
    </details>
  );
}
