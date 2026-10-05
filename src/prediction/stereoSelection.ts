import type { PredictionResult } from "./types";

/** Keep the display assumption with the spectrum and its saved calculation. */
export function representativeStereoComment(
  result: PredictionResult,
): string | undefined {
  if (!result.stereoSelection) return;
  return "Only one representative stereoisomer is shown (one enantiomer for a mirror-image pair); undefined stereochemistry was assumed.";
}
