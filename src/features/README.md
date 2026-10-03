# Scientific support features

`measureKinetics(spectra, options)` measures full-resolution signed areas from processed real data. Input limits use the displayed ppm scale, including each spectrum's reference offset. Membership can be restricted with `spectrumIds`; invalid rows retain diagnostics and cannot become fit observations.

- **Area:** target signed area in intensity·ppm.
- **Ratio:** target area / internal standard area × standard signal proton count / target signal proton count.
- **Concentration:** ratio × known internal standard concentration. The result uses the concentration unit supplied by the user.

Display gains, stack normalization, and integral reporting scales do not enter measurements. Target and standard regions must be disjoint and fully contained in each spectrum. Nonpositive or effectively zero standard areas, invalid proton counts, and missing times are reported per row. `kineticsPoints(rows)` selects valid observations, preserves user exclusions, and sorts by time. Quantitative use still requires suitable acquisition and a valid internal standard.

`fitKinetics(points, model)` fits included observations with linear regression or offset exponential growth/decay. Exponential parameters include `timeOrigin`; evaluate the exponent with `time - timeOrigin`. Predictions and residuals follow the input point order. `exportKineticsCSV(points, fit?, context?)` can additionally report target/standard areas, invalid rows, units, region settings, and the stack label. Predictions join measurements by spectrum ID.

Portable `.webnmr` archives retain optional stack definitions, active stack identity, validated project/spectrum appearance settings, and processing recipes. Earlier version-1 archives remain readable. Members must reference existing spectrum IDs, and a stack reference must belong to that stack. Original, processed, and FID arrays use binary Float64 values. Local recovery uses IndexedDB structured cloning. Kinetic region/standard/model choices are reported in CSV context; the project does not yet retain those UI choices.
