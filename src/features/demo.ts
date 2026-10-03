import { colors, defaultRecipe, uid, type Spectrum } from "../model";

/** Six explicitly synthetic spectra for exploring analysis and reaction monitoring. */
export function createDemoSpectra(): Spectrum[] {
  const n = 32_768,
    frequencyMHz = 400.13;
  return [0, 5, 10, 15, 20, 30].map((timeMinutes, index) => {
    const x = new Float64Array(n),
      real = new Float64Array(n),
      imag = new Float64Array(n);
    const reactant = Math.exp(-0.065 * timeMinutes),
      product = 1 - reactant;
    const lines: { ppm: number; amplitude: number; width: number }[] = [];
    function multiplet(
      center: number,
      intensities: number[],
      coupling: number,
      amplitude: number,
      width = 0.0035,
    ) {
      const total = intensities.reduce((a, b) => a + b, 0);
      intensities.forEach((v, i) =>
        lines.push({
          ppm:
            center +
            ((i - (intensities.length - 1) / 2) * coupling) / frequencyMHz,
          amplitude: (amplitude * v) / total,
          width,
        }),
      );
    }
    multiplet(7.12, [1, 1], 8.4, 1.7 * reactant);
    multiplet(6.82, [1, 1], 8.4, 1.7 * reactant);
    multiplet(4.12, [1, 3, 3, 1], 7.1, 2.3 * reactant);
    multiplet(1.24, [1, 2, 1], 7.1, 3.5 * reactant);
    multiplet(7.52, [1, 1], 8.1, 1.6 * product);
    multiplet(6.95, [1, 1], 8.1, 1.6 * product);
    multiplet(3.72, [1], 0, 2.8 * product);
    multiplet(2.08, [1], 0, 1.35); // Stable internal comparison signal.
    multiplet(7.26, [1], 0, 0.8, 0.0025); // Residual CHCl3.
    let seed = 1729 + index;
    function noise() {
      seed = (1664525 * seed + 1013904223) >>> 0;
      return (seed / 4294967296 - 0.5) * 0.0015;
    }
    for (let i = 0; i < n; i++) {
      x[i] = 10.5 - (11 * i) / (n - 1);
      for (const line of lines) {
        const d = (x[i] - line.ppm) / line.width,
          denominator = 1 + d * d;
        real[i] += line.amplitude / denominator;
        imag[i] += (line.amplitude * d) / denominator;
      }
      real[i] += noise();
      imag[i] += noise();
    }
    // An analytic quadrature FID with the same positions/relative line amplitudes.
    const fidN = 8192,
      spectralWidthHz = 11 * frequencyMHz,
      dwellSeconds = 1 / spectralWidthHz,
      carrierPpm = 5;
    const fidReal = new Float64Array(fidN),
      fidImag = new Float64Array(fidN);
    for (let i = 0; i < fidN; i++) {
      const t = i * dwellSeconds;
      for (const line of lines) {
        const a =
            line.amplitude *
            line.width *
            Math.exp(-2 * Math.PI * line.width * frequencyMHz * t),
          phase = 2 * Math.PI * (line.ppm - carrierPpm) * frequencyMHz * t;
        fidReal[i] += a * Math.cos(phase);
        fidImag[i] += a * Math.sin(phase);
      }
    }
    return {
      id: uid(),
      label: `Demo reaction · ${timeMinutes} min`,
      color: colors[index],
      nucleus: "1H",
      frequencyMHz,
      sourceFormat: "Synthetic demo",
      metadata: {
        sample: "Synthetic reaction monitoring example",
        solvent: "CDCl3",
        timeMinutes,
        "Rate / min⁻¹": 0.065,
        note: "Illustrative simulated data, not an experimental measurement.",
      },
      original: { x: x.slice(), real: real.slice(), imag: imag.slice() },
      data: { x, real, imag },
      fid: {
        real: fidReal,
        imag: fidImag,
        dwellSeconds,
        groupDelay: 0,
        carrierPpm,
        spectralWidthHz,
      },
      recipe: { ...defaultRecipe(), window: "none", zeroFill: 1 },
      referenceOffset: 0,
      peaks: [],
      integrals: [],
      multiplets: [],
      integralScale: 1,
      gain: 1,
      visible: true,
      timeMinutes,
      history: ["Created synthetic demo spectrum"],
      revision: 0,
    };
  });
}
