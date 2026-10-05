import { colors, defaultRecipe, uid } from "../model";
import type { Spectrum } from "../model";
import type { PredictionSetup } from "./predictionSetup";
import type { MoleculeDocument } from "./molecule";
import type { PredictionResult } from "../prediction/types";
import { firstOrderLines, splitPredictionSignals } from "./predictionSplitting";
import { renderPredictionLines } from "./predictionLines";
import { integrate } from "../core/numerics";

/** Database shifts and first-order J estimates have separate, persisted provenance. */
export function predictedSpectrum(
  result: PredictionResult,
  setup: PredictionSetup,
  molecule: MoleculeDocument,
  colorIndex = 0,
): Spectrum {
  const shifts = result.shifts.filter((s) => Number.isFinite(s.shiftPpm));
  if (!shifts.length)
    throw new Error(
      "No matching environments were found. Try a different structure; unsupported shifts are not estimated.",
    );
  if (result.nucleus !== setup.nucleus)
    throw new Error(
      "Prediction nucleus does not match the selected experiment.",
    );
  if (shifts.some((s) => !molecule.atoms[s.atomIndex]))
    throw new Error("Prediction atom mapping does not match the molecule.");
  const carbon = setup.nucleus === "13C",
    mode = carbon ? "none" : (setup.splitting ?? "first-order");
  const learned = result.spinSystem;
  if (
    learned &&
    (learned.display.mode !== mode ||
      learned.display.frequencyMHz !== setup.frequencyMHz)
  )
    throw Error(
      "Recalculate the prediction after changing splitting or field.",
    );
  const split = splitPredictionSignals(
    result,
    molecule,
    learned ? "none" : mode === "spin-system" ? "first-order" : mode,
    setup.couplingOverrides,
    setup.frequencyMHz,
  );
  const groups: {
    shift: number;
    weight: number;
    siteIds?: string[];
    atoms: string[];
    labels: string[];
    kind: string;
    couplingsHz: number[];
    lines: { offsetHz: number; weight: number }[];
  }[] = [];
  if (!learned)
    split.patterns.forEach((pattern, i) => {
      const s = shifts[i],
        atom = molecule.atoms[s.atomIndex];
      const weight = carbon ? 1 : Math.max(1, s.hydrogenCount);
      const siteLabel = `${atom.element}${atom.index}${s.atomLabel ? ` ${s.atomLabel}` : ""}`;
      const key = JSON.stringify(pattern.lines);
      const group = groups.find(
        (g) =>
          Math.abs(g.shift - s.shiftPpm) < 1e-5 &&
          JSON.stringify(g.lines) === key,
      );
      if (group) {
        group.weight += weight;
        if (!group.atoms.includes(atom.id)) group.atoms.push(atom.id);
        if (!group.labels.includes(siteLabel)) group.labels.push(siteLabel);
      } else
        groups.push({
          shift: s.shiftPpm,
          weight,
          atoms: [atom.id],
          labels: [siteLabel],
          kind: pattern.kind,
          couplingsHz: pattern.couplingsHz,
          lines: pattern.lines,
        });
    });
  if (learned) {
    const byId = new Map(learned.sites.map((site) => [site.id, site]));
    const chemicalGroups = new Map<string, typeof learned.sites>();
    for (const site of learned.sites) {
      const same = chemicalGroups.get(site.equivalenceKey) ?? [];
      same.push(site);
      chemicalGroups.set(site.equivalenceKey, same);
    }
    for (const sites of chemicalGroups.values()) {
      const memberIds = new Set(sites.map((site) => site.id));
      const center =
        sites.reduce((n, site) => n + site.shiftPpm, 0) / sites.length;
      const couplingsHz = [
        ...new Set(
          learned.couplings
            .filter(
              (c) =>
                memberIds.has(c.siteIdA) !== memberIds.has(c.siteIdB) &&
                !byId.get(c.siteIdA)!.exchangeable &&
                !byId.get(c.siteIdB)!.exchangeable &&
                Math.abs(c.jHz) >= 0.05,
            )
            .map((c) => Math.abs(c.jHz)),
        ),
      ].sort((a, b) => b - a);
      // Analysis windows cover this chemical group’s J envelope. Exact
      // transitions below belong collectively to a connected spin system;
      // their operator interference is not assigned to an individual atom.
      const span =
        mode === "none"
          ? 0
          : Math.max(
              ...sites.map((site) =>
                learned.couplings
                  .filter(
                    (c) =>
                      (c.siteIdA === site.id || c.siteIdB === site.id) &&
                      !memberIds.has(
                        c.siteIdA === site.id ? c.siteIdB : c.siteIdA,
                      ) &&
                      !byId.get(c.siteIdA)!.exchangeable &&
                      !byId.get(c.siteIdB)!.exchangeable,
                  )
                  .reduce((n, c) => n + Math.abs(c.jHz) / 2, 0),
              ),
            );
      const atoms = [
        ...new Set(sites.map((site) => molecule.atoms[site.atomIndex].id)),
      ];
      const labels = [
        ...new Set(
          sites.map(
            (site) =>
              `${molecule.atoms[site.atomIndex].element}${molecule.atoms[site.atomIndex].index}${site.atomLabel !== "H" ? ` ${site.atomLabel}` : ""}`,
          ),
        ),
      ];
      groups.push({
        siteIds: sites.map((site) => site.id),
        shift: center,
        weight: sites.length,
        atoms,
        labels,
        kind:
          mode === "none" || !span
            ? "s"
            : mode === "spin-system"
              ? "m"
              : firstOrderLines(
                  learned.couplings.flatMap((c) => {
                    const representative = sites[0];
                    const otherId =
                      c.siteIdA === representative.id
                        ? c.siteIdB
                        : c.siteIdB === representative.id
                          ? c.siteIdA
                          : undefined;
                    if (
                      !otherId ||
                      Math.abs(c.jHz) < 0.05 ||
                      representative.exchangeable
                    )
                      return [];
                    const other = byId.get(otherId)!;
                    return other.exchangeable ||
                      other.equivalenceKey === representative.equivalenceKey
                      ? []
                      : [{ count: 1, jHz: Math.abs(c.jHz) }];
                  }),
                ).kind,
        couplingsHz,
        lines: span
          ? [
              { offsetHz: span, weight: 0.5 },
              { offsetHz: -span, weight: 0.5 },
            ]
          : [{ offsetHz: 0, weight: 1 }],
      });
    }
  }
  // Exact transitions belong collectively to a connected spin system. Partition
  // them by nearest chemical shift only to define useful analysis windows; this
  // is not an atom-specific assignment. Areas are actual summed transition
  // strengths, so strong-coupling intensity transfer can yield fractional areas.
  const analysisGroups = groups.map((g) => ({
    ...g,
    nucleusCount: g.weight,
    lines: [...g.lines],
  }));
  if (learned) {
    const siteGroups = new Map(
      groups.flatMap((g, index) =>
        (g.siteIds ?? []).map((id) => [id, index] as const),
      ),
    );
    const assigned = groups.map(() => new Map<number, number>());
    for (const cluster of learned.display.clusters) {
      const candidates = [
        ...new Set(cluster.siteIds.map((id) => siteGroups.get(id)!)),
      ].filter((i) => i >= 0);
      if (!candidates.length)
        throw Error("Missing chemical group for predicted spin transitions.");
      for (const line of cluster.lines) {
        const nearest = candidates.reduce(
          (best, i) =>
            Math.abs(line.ppm - groups[i].shift) <
            Math.abs(line.ppm - groups[best].shift)
              ? i
              : best,
          candidates[0],
        );
        const key = Math.round(line.ppm * 1e8) / 1e8;
        assigned[nearest].set(
          key,
          (assigned[nearest].get(key) ?? 0) + line.weight,
        );
      }
    }
    analysisGroups.forEach((g, i) => {
      const actual = [...assigned[i]].sort((a, b) => b[0] - a[0]);
      g.lines = actual.map(([ppm, weight]) => ({
        offsetHz: (ppm - g.shift) * setup.frequencyMHz,
        weight,
      }));
      if (mode === "spin-system")
        g.weight = actual.reduce((total, [, weight]) => total + weight, 0);
    });
  }
  const nonemptyAnalysisGroups = analysisGroups.filter((g) => g.lines.length);
  const atomLabel = (ids: string[]) =>
    ids
      .map((id) => {
        const a = molecule.atoms.find((a) => a.id === id)!;
        return `${a.element}${a.index}`;
      })
      .join(", ");
  const lineMap = new Map<
    number,
    { ppm: number; weight: number; atoms: string[] }
  >();
  const renderedLines = learned
    ? learned.display.clusters.flatMap((cluster) => {
        const atoms = [
          ...new Set(
            cluster.siteIds.map(
              (id) =>
                molecule.atoms[
                  learned.sites.find((site) => site.id === id)!.atomIndex
                ].id,
            ),
          ),
        ];
        return cluster.lines.map((l) => ({ ...l, atoms }));
      })
    : groups.flatMap((g) =>
        g.lines.map((l) => ({
          ppm: g.shift + l.offsetHz / setup.frequencyMHz,
          weight: g.weight * l.weight,
          atoms: g.atoms,
        })),
      );
  for (const l of renderedLines) {
    const key = Math.round(l.ppm * 1e8) / 1e8,
      prior = lineMap.get(key);
    if (prior) {
      prior.weight += l.weight;
      prior.atoms = [...new Set([...prior.atoms, ...l.atoms])];
    } else lineMap.set(key, { ...l, atoms: [...l.atoms] });
  }
  const lines = [...lineMap.values()];
  const low = lines.reduce(
    (value, l) => Math.min(value, l.ppm - 1),
    carbon ? -20 : -2,
  );
  const high = lines.reduce(
    (value, l) => Math.max(value, l.ppm + 1),
    carbon ? 240 : 14,
  );
  const { data, renderedLineWidthHz } = renderPredictionLines(
    lines,
    low,
    high,
    setup.frequencyMHz,
    setup.lineWidthHz,
  );
  const gamma = renderedLineWidthHz / setup.frequencyMHz / 2;
  const warnings = [...(learned?.display.warnings ?? split.warnings)];
  if (renderedLineWidthHz > setup.lineWidthHz * 1.001)
    warnings.push(
      `The requested linewidth is finer than the bounded display grid. Rendered at ${renderedLineWidthHz.toFixed(3)} Hz; coupling spacings and total areas are preserved.`,
    );
  const peaks = lines.map((l) => ({
    id: uid(),
    ppm: l.ppm,
    height: l.weight / (Math.PI * gamma),
    ...(learned ? {} : { label: atomLabel(l.atoms) }),
  }));
  const prediction: PredictionResult = {
    ...structuredClone(result),
    splitting: {
      mode,
      couplings: split.couplings.map(
        ({
          atomIndexA,
          atomIndexB,
          hydrogensA,
          hydrogensB,
          jHz,
          source,
          rule,
        }) => ({
          atomIndexA,
          atomIndexB,
          hydrogensA,
          hydrogensB,
          jHz,
          source,
          rule,
        }),
      ),
      signals: learned
        ? nonemptyAnalysisGroups.map((g) => ({
            atomIndex: molecule.atoms.findIndex((a) => a.id === g.atoms[0]),
            shiftPpm: g.shift,
            hydrogenCount: g.nucleusCount,
            kind: g.kind,
            lineCount: g.lines.length,
            couplingsHz: g.couplingsHz,
          }))
        : split.patterns.map((p) => p.signal),
      warnings,
      renderedLineWidthHz,
    },
  };
  const title =
    setup.title.trim() ||
    `Predicted ${setup.nucleus} · ${molecule.smiles || "drawn molecule"}`;
  // Finite integration windows never contain all Lorentzian tails. Report exact
  // synthesis counts separately, retaining real signed areas for subsequent edits.
  const regions = nonemptyAnalysisGroups
    .map((g) => ({
      from:
        Math.max(
          ...g.lines.map((l) => g.shift + l.offsetHz / setup.frequencyMHz),
        ) +
        20 * gamma,
      to:
        Math.min(
          ...g.lines.map((l) => g.shift + l.offsetHz / setup.frequencyMHz),
        ) -
        20 * gamma,
      count: g.weight,
      atoms: [...g.atoms],
    }))
    .sort((a, b) => b.from - a.from);
  const merged: typeof regions = [];
  for (const region of regions) {
    const previous = merged.at(-1);
    if (previous && region.from >= previous.to) {
      previous.to = Math.min(previous.to, region.to);
      previous.count += region.count;
      previous.atoms = [...new Set([...previous.atoms, ...region.atoms])];
    } else merged.push({ ...region });
  }
  const integrals = merged.map((r, index) => ({
    id: uid(),
    from: r.from,
    to: r.to,
    area: integrate(data, 0, r.from, r.to),
    label: `I${index + 1} · ${atomLabel(r.atoms)}`,
    predicted: { nucleusCount: r.count, atomIds: r.atoms },
  }));
  const anchor = integrals.find((i) => i.area > 0);
  return {
    prediction,
    id: uid(),
    label: title.slice(0, 200),
    color: colors[colorIndex % colors.length],
    nucleus: setup.nucleus,
    frequencyMHz: setup.frequencyMHz,
    sourceFormat:
      result.engine === "cascade"
        ? "CASCADE 3D prediction"
        : "CDK environment prediction",
    metadata: {
      title,
      comments: `Predicted ${result.engine === "cascade" ? `with CASCADE · ${result.cascade?.conformerCount ?? 0} 3D conformers` : "from nmrshiftdb environments"} · ${renderedLineWidthHz.toFixed(2)} Hz linewidth\n${carbon ? "Proton-decoupled carbon signals." : learned && mode !== "none" ? (mode === "spin-system" ? "Exact isotropic spin simulation · learned signed J couplings · second-order effects included." : "First-order display · learned J couplings.") : mode === "first-order" ? "First-order splitting · editable typical J estimates; not calculated couplings." : "Unsplit predicted signals."}\n${learned && mode === "spin-system" ? "Automatic integrals use simulated proton-equivalent transition areas, partitioned by nearest chemical shift; strong coupling can give fractional values." : `Automatic integrals show modeled ${carbon ? "carbon" : "proton"} counts.`} Overlapped regions are combined.`,
      predictionEngine: result.engine,
      predictionDataset: result.dataset,
      predictionWarnings: [...new Set([...result.warnings, ...warnings])].join(
        "\n",
      ),
      predictionTargetAtoms: result.targetAtomCount,
      predictionMissingAtoms: result.missingAtomCount,
    },
    original: data,
    data,
    recipe: { ...defaultRecipe(), window: "none" },
    referenceOffset: 0,
    peaks,
    integrals,
    multiplets:
      mode !== "none"
        ? nonemptyAnalysisGroups.map((g) => ({
            id: uid(),
            from:
              g.shift + g.lines[0].offsetHz / setup.frequencyMHz + 4 * gamma,
            to:
              g.shift +
              g.lines.at(-1)!.offsetHz / setup.frequencyMHz -
              4 * gamma,
            center: g.shift,
            kind: g.kind,
            couplingsHz: g.couplingsHz,
            peakCount: g.lines.length,
            label: `${g.labels.join(", ")} · ${g.nucleusCount}H`,
          }))
        : [],
    integralScale: anchor ? anchor.predicted.nucleusCount / anchor.area : 1,
    integralCalibration: anchor
      ? { anchorId: anchor.id, target: anchor.predicted.nucleusCount }
      : undefined,
    gain: 1,
    visible: true,
    history: [
      result.engine === "cascade"
        ? "Predicted locally with CASCADE / RDKit conformer ensemble"
        : "Predicted locally with CDK HOSE / nmrshiftdb environments",
      ...(mode !== "none"
        ? [
            learned
              ? `${mode === "spin-system" ? "Exact spin" : "First-order"} simulation with learned FullSSPrUCe J values`
              : "First-order display from editable typical J estimates",
          ]
        : []),
    ],
    revision: 0,
    molecule: {
      document: structuredClone(molecule),
      visible: true,
      position: { x: 0.04, y: 0.24, width: 270, height: 210 },
      assignments: groups.map((g) => ({
        id: uid(),
        atomIds: g.atoms,
        ppm: g.shift,
        ...(g.lines.length === 1
          ? { peakId: peaks.find((p) => Math.abs(p.ppm - g.shift) < 1e-6)?.id }
          : {}),
        label: g.labels.join(", "),
      })),
    },
  };
}

export { savedPredictionResult } from "./predictionResult";
