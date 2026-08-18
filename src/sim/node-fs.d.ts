/**
 * Minimal scoped ambient declaration for `node:fs`, used only by
 * `protocol.test.ts` (a Vitest-only file that reads sibling source files as
 * text to cross-check `pkg.d.ts` against `wasm/src/lib.rs`).
 *
 * Deliberately NOT `@types/node`: this project's `tsconfig.app.json` has no
 * "types" restriction, so adding the real `@types/node` package would pull
 * in its global augmentations project-wide — notably redefining the global
 * `setTimeout`/`setInterval` return type from DOM's `number` to Node's
 * `Timeout`, which breaks `src/sim/worker.ts`'s `timer: number | null`
 * (a genuinely browser/Worker-global usage). Declaring only the one function
 * this test actually calls avoids that collision entirely.
 */
declare module "node:fs" {
  export function readFileSync(path: string | URL, encoding: string): string;
}
