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

- Import Bruker 1D experiment folders or ZIP archives, including processed `1r`/`1i` and complex raw `fid` with parameters. Existing processed spectra are preferred.
- Import two-column ppm/intensity CSV, TSV, or text, optionally with a third imaginary column. Enter an observed nucleus and MHz frequency in the inspector when absent.
- Import and export basic uncompressed AFFN JCAMP-DX in ppm. Unsupported compression or multidimensional data are reported explicitly.
- Fourier transform, zero filling, exponential/Gaussian/sine apodization, Bruker group-delay compensation, manual/automatic phase, and manual/automatic baseline correction. Preview, Apply, and Cancel operate from immutable source data.
- Reference spectra, pick positive/optional negative peaks, integrate signed areas, normalize reported integrals, and estimate conservative first-order s/d/t/q patterns and J values. Other patterns remain `m` for review.
- Stack or overlay spectra of the same nucleus, select an active trace, show/hide/reorder members, normalize by maximum/absolute area, and adjust individual gain. Display factors never alter analytical areas.
- Assign time points and measure a common region across 1D spectra. Fit linear, offset exponential decay, or offset exponential growth, with inclusion controls, residuals, R², RMSE, and half-life.
- Export full-resolution spectra and analysis/kinetics CSV, JCAMP, SVG, PNG, or Print/Save PDF. Save and reopen a lossless `.webnmr` project archive.
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
| + / − | Increase / decrease display height |
| Shift+Left / Right | Previous / next zoom |
| Alt+Left / Right | Pan by a fixed amount |
| Ctrl or Cmd+O / S | Open / save project |
| Ctrl or Cmd+Z / Y | Undo / redo |
| Escape | Cancel preview and return to selection |

Core bindings were checked against [Mnova's official documentation](https://mestrelab.com/downloads/mnova/manuals/latest/shortcuts.html). Shortcuts do not intercept typing in fields. This initial version implements horizontal zoom and a numeric reference editor; Mnova's alternate zoom modes and two-click graphic reference are simplified. Ctrl/Cmd+Shift+Z is also accepted for redo.

## Validation and limits

28 automated tests cover analytical DFT/FFT comparison, phase and baseline replay, reference invariance, signed endpoint integration, multiplet spacing, big-endian/float64 decoding, project precision, malformed projects, analytical exports, kinetic parameter recovery, and shortcut matching. When the supplied `../Example Files` are present, the tests also load the proton and million-point carbon datasets, compare raw/processed peak positions, and reject COSY/NOESY as unsupported 2D. The local browser was checked for actual Bruker ZIP import, recovery, analysis, individual gain, kinetic fitting, and phase preview/cancel.

Automatic phase is a positive-absorption heuristic for routine positive 1D spectra. The automatic baseline is a robust block/interpolation estimate; broad or signed signals require manual review. Raw and vendor-processed amplitude scales are not assumed interchangeable for quantitative kinetics. This version reports integrated signal trends; acquisition calibration and an internal standard are needed for concentration measurements. Numerical details are in [src/core/README.md](src/core/README.md).

Native Varian/Agilent, JEOL, Mnova projects, compressed JCAMP, raw `ser` arrays, true 2D processing, structure assignment, freeform publication page layouts, and higher-order multiplet simulation are outside this initial build. Imports are limited to 256 MB; transforms to about four million points. Local recovery currently keeps one workspace per browser origin, so save portable projects when using several tabs.

## Structure

- `src/core`: vendor/interchange parsers, numerical operations, worker and asynchronous client.
- `src/features`: portable projects/recovery, exports, synthetic examples, kinetics, shortcuts, folder drops.
- `src/components`: canvas spectrum renderer with extrema-preserving cached summaries and SVG annotations; kinetic chart.
- `src/App.tsx`: workspace controls, explicit processing scope, analysis and view histories.
- `.openai/hosting.json`: private static-site identity and build output directory.

General-purpose dependencies are React, Lucide icons, fflate, and idb-keyval. The NMR algorithms and application state are independent implementations.
