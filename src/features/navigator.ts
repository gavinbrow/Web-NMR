import type { Spectrum, SpectrumStack } from "../model";
import { spectrumDescription } from "./spectrumText";

export type NavigatorEntry =
  | { kind: "spectrum"; spectrum: Spectrum }
  | { kind: "stack"; stack: SpectrumStack; imported: boolean };

const importedItem = (s: Spectrum) => {
  const index = s.metadata.mnovaPageIndex ?? s.metadata.mnovaNativeItem;
  return typeof index === "number" && Number.isFinite(index)
    ? index
    : undefined;
};

/** A saved Mnova stack is one document item; its independent member data stays intact. */
export function navigatorEntries(
  spectra: Spectrum[],
  stacks: SpectrumStack[],
  filter = "",
): NavigatorEntry[] {
  const byId = new Map(spectra.map((s) => [s.id, s]));
  const nested = new Set<string>();
  const imported: { order: number; entry: NavigatorEntry }[] = [];
  const regular: NavigatorEntry[] = [];
  const query = filter.trim().toLowerCase();
  const matches = (s: Spectrum) =>
    spectrumDescription(s).toLowerCase().includes(query);
  for (const stack of stacks) {
    const members = stack.spectrumIds
      .map((id) => byId.get(id))
      .filter((s): s is Spectrum => !!s);
    const savedMembers = members.filter(
      (s) =>
        s.metadata.mnovaStackId === stack.id && importedItem(s) !== undefined,
    );
    const isImported =
      savedMembers.length === members.length && members.length > 0;
    if (isImported) members.forEach((s) => nested.add(s.id));
    if (
      query &&
      !stack.label.toLowerCase().includes(query) &&
      !members.some(matches)
    )
      continue;
    const reference =
      members.find((s) => s.id === stack.referenceId) ?? members[0];
    const displayStack =
      isImported && /^Mnova stack \d+$/.test(stack.label)
        ? { ...stack, label: reference.label }
        : stack;
    const entry: NavigatorEntry = {
      kind: "stack",
      stack: displayStack,
      imported: isImported,
    };
    if (isImported) imported.push({ order: importedItem(members[0])!, entry });
    else regular.push(entry);
  }
  for (const spectrum of spectra) {
    if (nested.has(spectrum.id) || !matches(spectrum)) continue;
    const entry: NavigatorEntry = { kind: "spectrum", spectrum };
    const order = importedItem(spectrum);
    if (order !== undefined) imported.push({ order, entry });
    else regular.push(entry);
  }
  return [
    ...imported.sort((a, b) => a.order - b.order).map((v) => v.entry),
    ...regular,
  ];
}
