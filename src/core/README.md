# Numerical conventions and supported imports

This is an independent TypeScript implementation. It does not use NMRium. Parsing, raw transforms and automatic corrections run inside a browser worker. The output typed-array buffers are transferred back without copying; source arrays in the main application are retained.

## Imports

- Bruker `1r` with matching `procs`; optional `1i`, `fid` and `acqus`. Existing processing is preserved rather than reapplying stored PHC0/PHC1 or windowing. Axes use `OFFSET - index × SW_p / (SI × SF)`. Int32 or float64 are decoded with the declared byte order and `2 ** NC_proc` amplitude scaling. Cropped STSR/STSI processing is explicitly unsupported.
- Bruker complex 1D `fid` with `acqus`, optional `procs`. The declared TD values exclude trailing file padding. AQ_mod 1/3 are accepted; other acquisition modes are rejected. Raw-only data receive a transform with no extra apodization. Frequency referencing uses processing SF when available; otherwise it uses acquisition SFO1 and O1.
- Folder selection preserves directory names; ZIP expands locally. Multiple independent experiments import as separate spectra. For multiple pdata versions, the first numeric processing version is opened and a warning identifies the choice. `ser`, `acqu2s` or `2rr` identify unsupported multidimensional/array data. They are never flattened into 1D.
- Text: two columns `ppm,intensity`, optional third imaginary column; CSV, TSV and whitespace separated text are accepted. A first header line is optional. Missing spectrometer frequency remains zero/unknown; J values require user-provided frequency.
- JCAMP-DX: explicit uncompressed AFFN `XYPOINTS` or `XYDATA` with ppm units, factors, and optional `.OBSERVE FREQUENCY`. SQZ/DIF/DUP compression, NTUPLES and unreferenced Hz axes are rejected.
- A 256 MB total expanded import limit and a 4,194,304-point numerical limit protect browser memory.

## Processing

The complex FFT uses the positive exponential and unscaled amplitude, followed by FFT shift. Its descending ppm coordinate assigns a positive-frequency `exp(+iωt)` FID resonance to the corresponding higher chemical shift. Raw frequency-domain amplitudes and imported vendor processed amplitudes are not promised to be equal without matched vendor scaling.

Bruker group delay uses integer truncation of the declared GRPDLY, circular advance, reversed-tail compensation, and removal of `floor(GRPDLY)+2` samples. This is the commonly documented approximate default correction, not a claim to reproduce the proprietary filter. A missing/negative legacy delay is rejected; unsupported legacy DECIM/DSPFVS lookup tables are not guessed. See the primary open implementation's [Bruker parameter and correction reference](https://github.com/jjhelmus/nmrglue/blob/master/nmrglue/fileio/bruker.py).

Windows use seconds and Hz: exponential `exp(-π LB t)`, Gaussian `exp(-(π GW t)²/(4 ln 2))`, and an unshifted sine bell over the retained FID. Zero filling is a factor of 1/2/4/8 rounded to a radix-2 size. It interpolates the frequency grid without recovering measured information.

Phase follows `S' = S × exp(i × (PH0 + PH1 × (pivot - ppm)/span))`. PH0/PH1 are in degrees; pivot is expressed in referenced ppm in the recipe. Reprocessing starts from the immutable raw or processed source. Real-only imports do not support a complex phase rotation.

Automatic phase is a bounded coarse-to-fine positive-absorption optimizer, with negative real intensity penalized. It is a reviewable estimate for ordinary positive 1D spectra, not an ACME implementation or a valid automatic treatment for APT/DEPT/signed spectra. Auto baseline uses robust median block estimates with interpolation; it suits narrow isolated peaks and may subtract broad features. Manual baseline uses piecewise linear interpolation between explicit anchors with endpoint clamping.

## Analysis

Peak detection uses the full real array, amplitude threshold, local extrema, parabolic sub-point position refinement and minimum ppm distance. Negative peaks are optional. Signed trapezoidal integration uses actual positive chemical-shift widths and interpolated boundary values; changing reference offsets does not change area. Units are intensity·ppm. Display gain never enters numerical measurements.

Multiplets classify only conservative first-order singlets, doublets, triplets and quartets with approximate spacing and Pascal intensity checks. Other or overlapping patterns remain `m`. Couplings use the actual nucleus frequency in MHz. No molecular assignment, mechanism, higher-order simulation or deconvolution is claimed.

## Public API

`workerClient.ts`: `importBrowserFiles(File[]): Promise<ImportResult>`, `processAsync(Spectrum): Promise<ComplexData>`, `autoPhaseAsync(Spectrum): Promise<{ph0,ph1}>`.

`imports.ts`: `importEntries(ImportEntry[]): ImportResult`, `parseBrukerParameters(text)`.

`numerics.ts`: `processSpectrum`, `autoPhase`, `detectPeaks(data,offset,thresholdPercent,minDistancePpm,negative?)`, `integrate(data,offset,from,to)`, `analyzeMultiplet(data,offset,from,to,frequencyMHz)`; lower-level `fft`, `applyPhase`, `correctDigitalFilter`, `automaticBaseline`, `nextPowerOfTwo`.

Tests cover an independently computed analytical DFT, calibrated synthetic raw spectra, signed integrals, endpoint interpolation, phase, baselines, conservative multiplicities, and actual supplied Bruker proton/million-point carbon datasets and 2D rejection. Practical auto-processing still requires review on additional vendor datasets.

## Expanded baseline processing

`processWithBaseline(spectrum)` returns the phased, unbaselined `source`, the fitted `baseline`, corrected `data`, and optional joint `effectivePhase`. The same curve is subtracted on Apply and shown in blue in the UI. Preserve input PH0/PH1 in the recipe: joint automatic phase is replayed deterministically from the original source, and writing effective phase back would run it a second time.

Automatic methods are polynomial and Bernstein robust fits, weighted Whittaker smoothing, splines, ablative peak shaving, arPLS and SNIP. PcBc/apbk are clearly labelled independent phase/baseline adaptations; proprietary vendor objectives and neural weights are not reproduced. Their regional/masked mode disables the global phase adjustment to preserve untreated samples. Manual anchors support linear segments, natural splines, polynomial and Whittaker models. Models use a bounded baseline-estimation grid and are interpolated onto the full spectrum.

Optional recipe fields preserve legacy archive replay. Region limits, excluded regions and anchors use referenced ppm and translate together when referencing/alignment changes. Excluded and out-of-region samples are unchanged. The baseline tests cover all methods, repeat replay, selected/excluded regions, known curves, conditioning and million-point data.
