## Description

<!-- Describe what this PR changes and why. Include relevant issue numbers if applicable. -->

## Subsystem / Scope Affected

- [ ] UI / React Components (`src/components/`, `src/stores/`)
- [ ] 3D Rendering & Map (`src/map/`, MapLibre ↔ Three.js bridge)
- [ ] Simulation Core & Wasm (`rust-engine/sim-core/`, `rust-engine/wasm/`)
- [ ] Data Pipeline & Preprocessor (`rust-engine/preprocessor/`, `tools/`)
- [ ] Documentation (`docs/`, `README.md`)

## Checklist

- [ ] `npm test` passes (Vitest unit tests)
- [ ] `npm run typecheck` passes without TypeScript errors
- [ ] `npm run build` succeeds
- [ ] `npm run check:bundle` verified (gzip bundle total ≤ 5.00 MB)
- [ ] `npm run rust:test` and `npm run rust:lint` pass (if `rust-engine/` was modified)
- [ ] `docs/ENGINE_CONTRACT.md` updated (if Wasm API, buffer strides, or worker protocols changed)
- [ ] Attributions for OpenStreetMap (ODbL) and Namtang GTFS (CC-BY 4.0) remain intact
