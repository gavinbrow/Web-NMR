import type { Spectrum, SpectrumStack } from "../model";
import { navigatorEntries } from "./navigator";

export interface KineticsSource {
  id: string;
  kind: "document" | "stack" | "custom";
  label: string;
  spectra: Spectrum[];
}

/** Select document spectra or one stack, never an aggregate of saved stack copies. */
export function kineticsSources(
  spectra: Spectrum[],
  stacks: SpectrumStack[],
  nucleus?: string,
): KineticsSource[] {
  const eligible = (s: Spectrum) =>
    !s.twoD && (!nucleus || s.nucleus === nucleus);
  const entries = navigatorEntries(spectra, stacks);
  const sources: KineticsSource[] = [
    {
      id: "document",
      kind: "document",
      label: "Document spectra",
      spectra: entries.flatMap((entry) =>
        entry.kind === "spectrum" && eligible(entry.spectrum)
          ? [entry.spectrum]
          : [],
      ),
    },
  ];
  const byId = new Map(spectra.map((s) => [s.id, s]));
  for (const entry of entries) {
    if (entry.kind !== "stack") continue;
    const members = entry.stack.spectrumIds
      .map((id) => byId.get(id))
      .filter((s): s is Spectrum => !!s && eligible(s));
    if (!members.length) continue;
    const page =
      members[0].metadata.mnovaPageIndex ?? members[0].metadata.mnovaNativeItem;
    sources.push({
      id: entry.stack.id,
      kind: "stack",
      label: `${entry.imported && typeof page === "number" ? `Page ${page} · ` : ""}${entry.stack.label}`,
      spectra: members,
    });
  }
  return sources;
}

/** Migrate old automatic "all spectra" lists while retaining deliberately saved subsets. */
export function restoredKineticsSource(
  spectra: Spectrum[],
  stacks: SpectrumStack[],
  ids?: string[],
  savedSource?: "document" | "custom",
): "document" | "custom" {
  if (savedSource) return savedSource;
  const selected = spectra.filter((s) => !s.twoD && ids?.includes(s.id));
  if (!selected.length) return "document";
  const nucleus = selected[0].nucleus;
  const sameIds = (items: Spectrum[]) =>
    items.length === ids!.length && items.every((s) => ids!.includes(s.id));
  if (
    sameIds(spectra.filter((s) => !s.twoD && s.nucleus === nucleus)) ||
    sameIds(kineticsSources(spectra, stacks, nucleus)[0].spectra)
  )
    return "document";
  return "custom";
}
