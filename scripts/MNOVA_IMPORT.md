# Opening Mnova documents in Web NMR

Web NMR opens supported **native `.mnova` documents directly in the browser**, preserving modern 1D real/complex processed spectra and real-only processed 2D matrices. Saved intensities and calibrated axes are read from the native data; existing phase and baseline are retained. See [the native reader capabilities, limits and reproducible codec build](mnova-codec/README.md).

Web NMR also reads **Mnova 17 JSON document files (`.mnjs`)** and exported **JSON NMR datasets (`.json`)**. The optional JSON route below restores ordered/hidden stacks and available 1D FIDs; it can also be useful when a native serialization dialect is unsupported.

1. Open the `.mnova` document in Mnova 17 or later.
2. Choose **File → Save As → MestReNova JSON Document** and save a `.mnjs` copy.
3. Upload that copy to Web NMR. Each NMR item opens in document page order. Stacked items become separate named stacks.

The provided `convert-mnova.qs` is an independently authored convenience script using Mnova's official scripting API. Run it through Mnova's scripting tools; it asks for the source and destination files and performs the same conversion. It requires an installed, licensed Mnova 17+ application. It does not reverse-engineer or decode native `.mnova` bytes. For older Mnova versions, export JCAMP-DX or a ppm/intensity CSV; those formats preserve fewer source details.

The JSON importer preserves stored processed real/imaginary samples, calibrated ppm axes, available complex 1D FIDs, complete Title/Comment fields, page order, stack membership/hidden traces, and the first ppm view range. It does not run Mnova processing instructions again. The processing description is retained as metadata; Web NMR starts with an identity recipe so existing phase and baseline corrections remain intact. Unsupported resources receive explicit errors.

Current limitations: JSON import supports processed 1D data only. It does not recreate page artwork, molecule drawings, analysis annotations, array acquisition settings, arbitrary stack gains, colors, or page geometry. It does not restore native processing algorithms as editable Web NMR recipes. Bruker 2D imports are supported separately. Browser imports stay local and do not send source files to a conversion server.

Bruker imports prefer saved `pdata/.../1r` and optional `1i`, or `2rr` and its available quadrants. These files already contain the machine's saved processing. Raw FIDs/ser are retained separately for reprocessing. When no processed samples exist, the browser must reconstruct a spectrum from the FID; saved parameter settings cannot substitute for missing baseline coefficients or reproduce every vendor algorithm.

Implementation verified against a real Mnova 17 export: ZIP resource references and inline JSON arrays, calibrated frequency/width/lowest-frequency values, and binary arrays with the `MNOVA JSON BINARY` header plus big-endian float32 samples. Parsing is bounded and rejects truncated arrays, non-finite values and resource path traversal. It does not execute embedded code.

Official references:

- [Mnova 17 release notes and JSON document format](https://support.mestrelab.com/kb/article/567-what-s-new-in-mnova-17-changelog/)
- [Mnova scripting guide](https://mestrelab.com/starting-guides/how-to-get-started-with-mnova-scripts.html)
- [Official script examples, including document serialization](https://www.mestrelabcn.com/Manual_HTML_Mnova_15/scripts_samples.htm)
- [Saving spectra as ASCII](https://mestrelab.com/resources/save-spectra-as-ascii.html)
