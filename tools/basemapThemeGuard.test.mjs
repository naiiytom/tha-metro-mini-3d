import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Regression guard for the basemap night-theming compounding hazard (Task
// 10b brief, "blend from the captured original, never from the current
// value"). src/map/basemapTheme.test.ts's mixColor tests can only show that
// mixColor itself is a pure, non-compounding function — they say nothing
// about whether styleBinding.ts's `applyThemeElevation` actually feeds it
// each layer's *captured* original colour every time, versus re-reading the
// layer's live (already-blended) paint property and drifting the whole map
// to black over the ~2 Hz loop. src/map/styleBinding.test.ts's "blends from
// the captured original every time" case already exercises this via the
// public API, but this pins it at the source-text level too, cheaply: the
// body of `applyThemeElevation` must never call `map.getPaintProperty`.
//
// Originally scanned MapContainer.tsx's inline `applyBasemapTheme` closure;
// moved to scan src/map/styleBinding.ts's `applyThemeElevation` when Task 5
// (MVP 7) extracted that logic out of MapContainer into its own module.
//
// Lives in tools/ (not src/) as a .mjs file, like lines.config.test.mjs,
// because src/**/*.ts is type-checked by `tsc -b` and this repo has no
// @types/node — a .ts file under src importing `node:fs` fails the build.
describe("applyThemeElevation source guard", () => {
  it("never re-reads map.getPaintProperty inside applyThemeElevation", () => {
    const src = readFileSync(new URL("../src/map/styleBinding.ts", import.meta.url), "utf8");
    const marker = "const applyThemeElevation = ";
    const start = src.indexOf(marker);
    expect(start).toBeGreaterThan(-1);

    // Isolate the function body via brace matching rather than a fixed line
    // range, so this doesn't silently stop covering anything the moment the
    // surrounding code shifts.
    const braceStart = src.indexOf("{", start);
    expect(braceStart).toBeGreaterThan(-1);
    let depth = 0;
    let i = braceStart;
    for (; i < src.length; i++) {
      if (src[i] === "{") depth++;
      else if (src[i] === "}") {
        depth--;
        if (depth === 0) break;
      }
    }
    expect(i).toBeLessThan(src.length);
    const body = src.slice(braceStart, i + 1);

    expect(body).not.toMatch(/getPaintProperty/);
  });
});
