import { describe, expect, it } from "bun:test";
import { createHash } from "node:crypto";
import {
  getMihomoAsset,
  MIHOMO_ASSETS,
  MIHOMO_RELEASE,
  verifyMihomoAsset
} from "../scripts/fetch-mihomo";

describe("fetch-mihomo", () => {
  it("固定官方 release 及四个平台资产", () => {
    expect(MIHOMO_RELEASE).toBe("v1.19.28");
    expect(Object.keys(MIHOMO_ASSETS).sort()).toEqual([
      "darwin-amd64",
      "darwin-arm64",
      "linux-amd64",
      "linux-arm64"
    ]);
    for (const asset of Object.values(MIHOMO_ASSETS)) {
      expect(asset.name).toEndWith(`-${MIHOMO_RELEASE}.gz`);
      expect(asset.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(asset.size).toBeGreaterThan(0);
    }
    expect(MIHOMO_ASSETS["darwin-amd64"].name).toContain("-amd64-v1-");
    expect(MIHOMO_ASSETS["linux-amd64"].name).toContain("-amd64-v1-");
  });

  it("为 Linux/Darwin 的 x64/arm64 选择精确下载 URL", () => {
    const linuxX64 = getMihomoAsset("linux", "x64");
    expect(linuxX64.name).toBe("mihomo-linux-amd64-v1-v1.19.28.gz");
    expect(linuxX64.url).toBe(
      "https://github.com/MetaCubeX/mihomo/releases/download/v1.19.28/mihomo-linux-amd64-v1-v1.19.28.gz"
    );
    expect(getMihomoAsset("darwin", "arm64").name).toBe(
      "mihomo-darwin-arm64-v1.19.28.gz"
    );
  });

  it("拒绝不支持的平台与架构", () => {
    expect(() => getMihomoAsset("win32", "x64")).toThrow("不支持的平台");
    expect(() => getMihomoAsset("linux", "ia32")).toThrow("不支持的架构");
  });

  it("下载内容必须同时通过大小与 SHA-256 校验", () => {
    const bytes = new TextEncoder().encode("pinned-mihomo-asset");
    expect(() =>
      verifyMihomoAsset(
        {
          name: "fixture.gz",
          size: bytes.byteLength,
          sha256: createHash("sha256").update(bytes).digest("hex")
        },
        bytes
      )
    ).not.toThrow();
    expect(() =>
      verifyMihomoAsset(
        {
          name: "fixture.gz",
          size: bytes.byteLength,
          sha256: "0".repeat(64)
        },
        bytes
      )
    ).toThrow("SHA-256 校验失败");
    expect(() =>
      verifyMihomoAsset(
        {
          name: "fixture.gz",
          size: bytes.byteLength + 1,
          sha256: "0".repeat(64)
        },
        bytes
      )
    ).toThrow("大小校验失败");
  });
});
