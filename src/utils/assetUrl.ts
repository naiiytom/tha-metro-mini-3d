/**
 * Resolve a root-relative public asset path ("/data/x", "/models/y.glb")
 * against Vite's `base`, so a deploy under a sub-path (e.g. a GitHub Pages
 * project site at `/<repo>/`) still finds it. Absolute URLs pass through.
 */
export function assetUrl(path: string, base: string = import.meta.env.BASE_URL): string {
  if (!path.startsWith("/")) return path;
  return base.replace(/\/$/, "") + path;
}
