# Web NMR

A React/TypeScript NMR workspace built independently from the ground up. NMRium is not used. The interface follows Mnova's compact ribbon, dark workspace, white spectrum page, spectrum navigator, and analysis tables.

## Run locally

```sh
cd app
npm ci
npm run dev
```

Open the local URL printed by the development server. Build the static application with `npm run build`; check its numerical and file-format behavior with `npm test`. The production site needs only the contents of `dist`.

## Supported workflows

- Import Bruker processed 2D NOESY/COSY planes (`2rr` and optional quadrants with `procs`/`proc2s`), rendered as signed contours with independent ppm axes, rectangle zoom, pan, threshold and figure/matrix export. Raw States/States-TPPI data can open as magnitude 2D spectra; other raw modes require processed planes.
- Import Bruker 1D experiment folders or ZIP archives, including processed `1r`/`1i` and complex raw `fid` with parameters. Existing processed spectra are preferred.
- Import two-column ppm/intensity CSV, TSV, or text, optionally with a third imaginary column. Enter an observed nucleus and MHz frequency in the inspector when absent.
- Import and export basic uncompressed AFFN JCAMP-DX in ppm. Unsupported compression or multidimensional data are reported explicitly.
- Fourier transform, zero filling, exponential/Gaussian/sine apodization, Bruker group-delay compensation, manual/automatic phase, and manual/automatic baseline correction. Preview, Apply, and Cancel operate from immutable source data.
- Reference spectra, pick positive/optional negative peaks, integrate signed areas, normalize reported integrals, and estimate conservative first-order s/d/t/q patterns and J values. Other patterns remain `m` for review.
- Stack or overlay spectra of the same nucleus, select an active trace, show/hide/reorder members, normalize by maximum/absolute area, and adjust individual gain. Display factors never alter analytical areas.
- Assign time points and measure a common region across 1D spectra. Fit linear, offset exponential decay, or offset exponential growth, with inclusion controls, residuals, R², RMSE, and half-life.
- Export full-resolution spectra and analysis/kinetics CSV, JCAMP, SVG, PNG, or Print/Save PDF. Save and reopen a lossless `.webnmr` project archive.
- Dark menus, resizable navigator/inspector/ribbon/results, and a right-click Properties dialog for 1D appearance, grid, axes, peaks, integral curves, multiplets, stacking, geometry and metadata. Appearance changes are included in figure exports and project archives.
- Local IndexedDB recovery, edit undo/redo, separate zoom history, real/imaginary/magnitude/FID views, and collapsible panels.

The initial project contains six explicitly labelled **synthetic demonstration spectra**. User-selected NMR files are decoded and processed in the browser; they are not uploaded to the hosting service. Source arrays, metadata, processing recipes, and analysis are preserved in the downloaded project. Local recovery is browser/origin specific; download a project for a portable copy.

## Familiar shortcuts

| Key | Action |
| --- | --- |
| Z | Horizontal zoom |
| Space + drag | Pan |
| I / Shift+I | Manual integrals / integral manager |
| J / Shift+J | Manual multiplets / multiplet manager |
| K / Ctrl or Cmd+K | Region peak picking / peak by peak |
| L / R | Reference signal |
| Shift+P | Manual phase |
| B | Baseline method chooser with blue preview |
| Shift+click | Select a range of spectra |
| + / − | Increase / decrease display height |
| Shift+Left / Right | Previous / next zoom |
| Alt+Left / Right | Pan by a fixed amount |
| Ctrl or Cmd+O / S | Open / save project |
| Ctrl or Cmd+Z / Y | Undo / redo |
| Escape | Cancel preview and return to selection |

Core bindings were checked against [Mnova's official documentation](https://mestrelab.com/downloads/mnova/manuals/latest/shortcuts.html). Shortcuts do not intercept typing in fields. This initial version implements horizontal zoom and a numeric reference editor; Mnova's alternate zoom modes and two-click graphic reference are simplified. Ctrl/Cmd+Shift+Z is also accepted for redo.

## Validation and limits

95 automated tests cover analytical DFT/FFT comparison, phase and baseline replay, reference invariance, signed endpoint integration, multiplet spacing, big-endian/float64 decoding, project precision, malformed projects, analytical exports, kinetic parameter recovery, and shortcut matching. When the supplied `../Example Files` are present, the tests also load the proton and million-point carbon datasets, compare raw/processed peak positions, and verify processed COSY/NOESY, raw-only States-TPPI orientation, matrix archive roundtrips, calibrated integrals and resolved split lines. The local browser was checked for actual Bruker ZIP import, recovery, analysis, individual gain, kinetic fitting, and phase preview/cancel.

Automatic phase is a positive-absorption heuristic for routine positive 1D spectra. Automatic baseline methods include polynomial, Bernstein, Whittaker, splines, ablative shaving, arPLS and SNIP, plus clearly labelled independent joint phase/baseline adaptations for proprietary PcBc/apbk; broad or signed signals require manual review. Raw and vendor-processed amplitude scales are not assumed interchangeable for quantitative kinetics. Internal-standard kinetics reports area ratios corrected for proton count and optional concentrations from a known standard. Quantitative acquisition suitability must still be established. Numerical details are in [src/core/README.md](src/core/README.md).

Native Varian/Agilent, JEOL, Mnova projects, compressed JCAMP, unsupported raw 2D acquisition modes, interactive 2D phase/baseline processing, 2D peak volumes, structure assignment, freeform publication page layouts, and higher-order multiplet simulation are outside this initial build. Imports are limited to 256 MB; transforms to about four million points. Local recovery currently keeps one workspace per browser origin, so save portable projects when using several tabs.

## Structure

- `src/core`: vendor/interchange parsers, numerical operations, worker and asynchronous client.
- `src/features`: portable projects/recovery, exports, synthetic examples, kinetics, shortcuts, folder drops.
- `src/components`: canvas spectrum renderer with extrema-preserving cached summaries and SVG annotations; kinetic chart.
- `src/App.tsx`: workspace controls, explicit processing scope, analysis and view histories.
- `.openai/hosting.json`: private static-site identity and build output directory.

General-purpose dependencies are React, Lucide icons, fflate, and idb-keyval. The NMR algorithms and application state are independent implementations.

## Stack and baseline workflow

Click a spectrum to select it; Shift-click selects the range from the first clicked spectrum, and Ctrl/Cmd-click toggles an individual item. Red outlines show selection. Click empty space to clear it. Click **Stack** or **Stack selected** to create a named stack item in the left navigator. Original items remain available; stacks refer to the same spectrum records, so processing/alignment edits are reflected in both. Stacks, their order and members participate in undo/redo.

A stack supports a shared integration region applied to every member, reference-peak alignment over a chosen region, individual horizontal dragging and exact ppm shifts. Reference edits translate stored phase pivots, baseline masks and analysis positions together without changing areas. Kinetics uses the active stack membership and its shared integral regions. Choose raw area, internal-standard ratio, or internal-standard concentration; CSV exports include regions, raw areas and validation errors.

Press **B** to preview a fitted blue baseline on the uncorrected, phased spectrum. Choose a method and parameters, optionally limit the region or exclude blind regions, then Apply or Cancel. Manual points support segments, splines, polynomial and Whittaker smoothing. Extract exports the fitted model. PcBc/apbk choices are independently implemented adaptations, not reproductions of proprietary vendor internals; regional masks disable their global phase adjustment. Algorithms estimate on a bounded grid then interpolate onto the original numerical axis; measurements remain full resolution.

The Properties dialog covers implemented 1D NMR options. Mnova settings for 2D analysis, prediction, assignments and fitting plugins are not emulated. Browser page geometry uses percentages and pixels rather than desktop print-layout units.

## Spectrum-first analysis

File title and comments are drawn inside the spectrum frame. **Show title** hides both. Tables and right panels stay closed by default; use Integral controls, Integral table, Shift+I or the toolbar toggle to open them. Tool modes use distinct cursors.

Integral brackets and values sit below each trace. Uncalibrated values are relative to the first positive integral, with raw signed areas retained. Click to select an integral, drag its boundary handles, double-click to edit, or right-click for Edit Integral, Show Table of Integrals, Delete Integral, Delete All and tentative Autodetect Nuclides Count. A reference integral stores its ID and desired value; processing and boundary changes recalculate the factor while preserving that reference. Label-only edits retain the current calibration. Matching shared stack regions can be edited and normalized together. Auto normalize all resets member gain and normalizes display maxima without changing areas.

Peak picking resolves individual split lines using noise-aware prominence. Auto multiplets suggests bounded groups with conservative first-order pattern/J estimates. These suggestions require review for overlap and second-order spectra. Numerical and display normalization are independent of kinetics measurements.

## Compact tools and 2D traces

The ribbon uses original blue spectrum icons with red action markers and is about 20% shorter. The manual integral icon and default integral curves are blue. Right-side tools show hover labels; confirmations appear at the top right. Navigator previews follow visible zoom, processing preview, display component and intensity.

Auto phase applies directly without opening controls. Manual phase previews slider and numeric changes continuously through the numerical worker, coalescing rapid inputs and ignoring canceled or superseded results. Apply preserves integral calibration; Cancel restores the committed spectrum. Baseline correction opens a compact chooser with advanced parameters and region controls collapsed.

Every supported 2D plane shows top (F2) and left (F1) maximum projections. Higher F1 ppm is at the bottom; axes appear on the bottom and right. Open **2D settings** to choose an imported, nucleus-compatible 1D spectrum for either trace. Import the higher-resolution spectrum through Open files first. Referenced ppm axes align the trace to the plane; regions without overlapping source data remain blank. Scroll while hovering over each trace to adjust its intensity independently. Scrolling over contours changes the contour threshold. 2D ranges, sources and gains are preserved in portable projects and recovery; figure exports include the side traces.

## Kinetics workspace

Kinetics has a full-width **Curve / Spectra** workspace. The compact **Setup** panel floats above the plot and can be resized; opening it does not reduce the plot dimensions. Click outside, press Escape, or choose Done to close it. Target regions are blue, internal-standard regions green. Draw either region directly in the spectrum view; **I** measures the target and **Z** zooms without leaving Kinetics. Choose an existing stack or all 1D spectra of the active nucleus. The time-point table stays collapsed until requested; missing acquisition times have a direct setup prompt instead of a blank graph. Fits show compact results and additional parameters on demand. CSV export retains full analytical values, selected regions and validation errors.

Acquisition times are saved on spectrum records. Kinetics regions, model, exclusions and internal-standard settings are currently session settings; save a kinetics CSV to retain their report context. Full kinetics project persistence, automatic acquisition-time import, multiple monitored signals and chart/report export remain useful follow-up work.
