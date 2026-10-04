# Numerical conventions and supported imports

This is an independent TypeScript implementation. It does not use NMRium. Parsing, raw transforms and automatic corrections run inside a browser worker. The output typed-array buffers are transferred back without copying; source arrays in the main application are retained.

## Imports

- Bruker `1r` with matching `procs`; optional `1i`, `fid` and `acqus`. Existing processing is preserved rather than reapplying stored PHC0/PHC1 or windowing. Axes use `OFFSET - index × SW_p / (SI × SF)`. Int32 or float64 are decoded with the declared byte order and `2 ** NC_proc` amplitude scaling. Cropped STSR/STSI processing is explicitly unsupported.
- Bruker complex 1D `fid` with `acqus`, optional `procs`. The declared TD values exclude trailing file padding. AQ_mod 1/3 are accepted; other acquisition modes are rejected. Raw-only data receive a transform with no extra apodization. Frequency referencing uses processing SF when available; otherwise it uses acquisition SFO1 and O1.
- Bruker processed 2D `2rr` with matching `procs` and `proc2s` is supported, including optional `2ri`, `2ir` and `2ii` quadrants. See the 2D section below. Raw `ser` support is limited to States and States-TPPI magnitude processing; other raw acquisition modes receive an explicit error.
- Folder selection preserves directory names; ZIP expands locally. Multiple independent experiments import as separate spectra. For multiple pdata versions, the first numeric processing version is opened and a warning identifies the choice. Processing-folder `title` files supply `metadata.title` from the first line, `metadata.comments` from subsequent lines and `metadata.sourceTitle` from the complete normalized text; root-level title files are a fallback.
- Text: two columns `ppm,intensity`, optional third imaginary column; CSV, TSV and whitespace separated text are accepted. A first header line is optional. Missing spectrometer frequency remains zero/unknown; J values require user-provided frequency.
- JCAMP-DX: explicit uncompressed AFFN `XYPOINTS` or `XYDATA` with ppm units, factors, and optional `.OBSERVE FREQUENCY`. SQZ/DIF/DUP compression, NTUPLES and unreferenced Hz axes are rejected.
- A 256 MB total expanded import limit and a 4,194,304-point 1D numerical limit protect browser memory. 2D imports have separate matrix and component-memory limits below.

## 2D data and processing

`Spectrum.twoD` stores descending F2 `x` and F1 `y` ppm axes, `width`, `height` and a row-major `real` matrix: `real[rowF1 * width + columnF2]`. Each axis uses its own processing `OFFSET`, `SW_p`, `SI` and `SF`; heteronuclear experiments therefore retain independent calibration. Optional `imagF2`, `imagF1` and `imagBoth` arrays retain the vendor quadrants. F1 nucleus/frequency and a separate reference offset are included. The compatible 1D `data`/`original` field is an explicitly labelled maximum-absolute-intensity F2 projection with each selected point's sign retained; it is never a flattened matrix or a substitute for 2D analysis.

Processed files are decoded from Bruker `XDIM` submatrix order into full row-major planes, preserving negative intensities and applying the declared endian/type and `2 ** NC_proc` scale. Existing vendor phase/baseline processing is preserved. The supplied NOESY experiment 5 opens as 1024 × 512 with all four quadrants; supplied COSY experiment 4 and the separate COSY folder also open through their processed planes. Both full-plane axes descend from approximately 9.998 ppm for the homonuclear NOESY example. No new absorption phase adjustment is inferred or applied.

Raw `ser` processing accepts uniform complex direct acquisition (`AQ_mod` 1 or 3), an even interleaved F1 acquisition count, and indirect `FnMODE` 4 (States) or 5 (States-TPPI). Rows are read using 1024-byte padding; declared `GRPDLY` receives the same documented approximate filter correction as 1D. Each dimension receives 0.3 Hz exponential broadening and approximately twofold radix-2 zero filling. F1 cosine/sine rows are combined as hypercomplex channels; States-TPPI alternates entire complex increments. Imaginary negation belongs to the separate States-TPPI-N convention and is not applied for FnMODE 5. This distinction follows the primary [NMRPipe Fourier-transform documentation](https://spin.niddk.nih.gov/bax-apps/NMRPipe/ref/nmrpipe/ft.html).

The returned raw plane is the magnitude over the four transformed hypercomplex components: `mode: "magnitude"`, `source: "Bruker raw 2D magnitude"`. Import warns that peak signs and phase-sensitive intensity information are lost. Acquisition SFO1/O1 supplies referencing when processing SF is unavailable. This is a useful initial 2D view, not quantitative absorption processing or a reproduction of Mnova automatic 2D processing. Raw samples are not retained for interactive 2D replay in this release. For absorption contours, signed intensities or user-adjustable processing, import a correctly processed `2rr` plane. Raw echo/antiecho (FnMODE 6), TPPI, QSEQ, NUS, partial acquisitions and 3D or higher data are explicitly unsupported; processed 2D echo/antiecho output is supported.

Matrices contain at most 10 million elements. Decoded quadrant arrays together must fit 160 MiB; a large full-quadrant dataset can exceed that limit even when `2rr` alone would fit. Importing only `2rr` is supported in that case. Raw processing uses a conservative 160 MiB work-matrix budget. Cropped STSR/STSI planes, inconsistent SI/XDIM or incorrect binary sizes are rejected. Projects retain matrices, quadrants, axes and title/comments and validate finite arrays and dimensions on loading.

Display contour downsampling does not change the full imported data. The overview uses signed extrema in each display bin to retain narrow peaks; nearby weaker opposite-sign peaks can be hidden by a stronger peak in the same bin, and their apparent positions are limited by bin width. Zooming increases the detail sampled from the full matrix. No 2D peak picking, volumes, assignment or cross-peak kinetics is claimed.

## Processing

The complex FFT uses the positive exponential and unscaled amplitude, followed by FFT shift. Its descending ppm coordinate assigns a positive-frequency `exp(+iωt)` FID resonance to the corresponding higher chemical shift. Raw frequency-domain amplitudes and imported vendor processed amplitudes are not promised to be equal without matched vendor scaling.

Bruker group delay uses integer truncation of the declared GRPDLY, circular advance, reversed-tail compensation, and removal of `floor(GRPDLY)+2` samples. This is the commonly documented approximate default correction, not a claim to reproduce the proprietary filter. A missing/negative legacy delay is rejected; unsupported legacy DECIM/DSPFVS lookup tables are not guessed. See the primary open implementation's [Bruker parameter and correction reference](https://github.com/jjhelmus/nmrglue/blob/master/nmrglue/fileio/bruker.py).

Windows use seconds and Hz: exponential `exp(-π LB t)`, Gaussian `exp(-(π GW t)²/(4 ln 2))`, and an unshifted sine bell over the retained FID. Zero filling is a factor of 1/2/4/8 rounded to a radix-2 size. It interpolates the frequency grid without recovering measured information.

Phase follows `S' = S × exp(i × (PH0 + PH1 × (pivot - ppm)/span))`. PH0/PH1 are in degrees; pivot is expressed in referenced ppm in the recipe. Reprocessing starts from the immutable raw or processed source. Real-only imports do not support a complex phase rotation.

Automatic phase is a bounded coarse-to-fine positive-absorption optimizer, with negative real intensity penalized. It is a reviewable estimate for ordinary positive 1D spectra, not an ACME implementation or a valid automatic treatment for APT/DEPT/signed spectra. The baseline methods and their limitations are documented below; automatic estimates can subtract broad signal features and should be reviewed in the baseline preview.

## Analysis

Peak detection uses the full real array, amplitude threshold, local extrema, parabolic sub-point position refinement and minimum ppm distance. Negative peaks are optional. Signed trapezoidal integration uses actual positive chemical-shift widths and interpolated boundary values; changing reference offsets does not change area. Units are intensity·ppm. Display gain never enters numerical measurements.

Multiplets classify only conservative first-order singlets, doublets, triplets and quartets with approximate spacing and Pascal intensity checks. Other or overlapping patterns remain `m`. Couplings use the actual nucleus frequency in MHz. No molecular assignment, mechanism, higher-order simulation or deconvolution is claimed.

## Public API

`workerClient.ts`: `importBrowserFiles(File[]): Promise<ImportResult>`, `processAsync(Spectrum): Promise<ComplexData>`, `autoPhaseAsync(Spectrum): Promise<{ph0,ph1}>`.

`imports.ts`: `importEntries(ImportEntry[]): ImportResult`, `parseBrukerParameters(text)`.

`numerics.ts`: `processSpectrum`, `autoPhase`, `detectPeaks(data,offset,thresholdPercent,minDistancePpm,negative?)`, `integrate(data,offset,from,to)`, `analyzeMultiplet(data,offset,from,to,frequencyMHz)`; lower-level `fft`, `applyPhase`, `correctDigitalFilter`, `automaticBaseline`, `nextPowerOfTwo`.

`twoD.ts`: `readProcessedTwoD`, `processRawTwoDMagnitude`, `decodeTiledPlane`, `processedAxis`, `maximumProjection(twoD, dimension?)` and `extractTwoDSlice(twoD, dimension, position)`. Projection/slice dimensions are `"F2"` or `"F1"`; slice position is the unreferenced ppm coordinate on the other axis.

Tests cover an independently computed analytical DFT, calibrated synthetic raw spectra, signed integrals, endpoint interpolation, phase, baselines, conservative multiplicities and actual supplied Bruker proton/million-point carbon datasets. 2D tests cover independent synthetic tiled binary data, heteronuclear axes, States/States-TPPI peak orientation, actual NOESY/COSY imports, raw-only NOESY agreement with its processed diagonal within 0.08 ppm, malformed matrix rejection and byte-for-byte project roundtrips of every plane/axis. Practical raw processing still requires review on additional vendor datasets.

## Expanded baseline processing

`processWithBaseline(spectrum)` returns the phased, unbaselined `source`, the fitted `baseline`, corrected `data`, and optional joint `effectivePhase`. The same curve is subtracted on Apply and shown in blue in the UI. Preserve input PH0/PH1 in the recipe: joint automatic phase is replayed deterministically from the original source, and writing effective phase back would run it a second time.

Automatic methods are polynomial and Bernstein robust fits, weighted Whittaker smoothing, splines, ablative peak shaving, arPLS and SNIP. PcBc/apbk are clearly labelled independent phase/baseline adaptations; proprietary vendor objectives and neural weights are not reproduced. Their regional/masked mode disables the global phase adjustment to preserve untreated samples. Manual anchors support linear segments, natural splines, polynomial and Whittaker models. Models use a bounded baseline-estimation grid and are interpolated onto the full spectrum.

Optional recipe fields preserve legacy archive replay. Region limits, excluded regions and anchors use referenced ppm and translate together when referencing/alignment changes. Excluded and out-of-region samples are unchanged. The baseline tests cover all methods, repeat replay, selected/excluded regions, known curves, conditioning and million-point data.
