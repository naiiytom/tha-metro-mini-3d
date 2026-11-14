import { describe, expect, it } from "vitest";
import { assetUrl } from "./assetUrl";

describe("assetUrl", () => {
  it("leaves a root deploy unchanged", () => {
    expect(assetUrl("/data/network.tmb", "/")).toBe("/data/network.tmb");
  });
  it("prefixes a sub-path deploy", () => {
    expect(assetUrl("/models/siam.glb", "/tha-metro-mini-3d/")).toBe(
      "/tha-metro-mini-3d/models/siam.glb",
    );
  });
  it("passes absolute URLs through", () => {
    expect(assetUrl("https://x.test/a.glb", "/sub/")).toBe("https://x.test/a.glb");
  });
});
