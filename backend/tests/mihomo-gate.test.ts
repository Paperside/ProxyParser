import { afterEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import {
  copyVerifiedMihomoGeodata,
  validateWithMihomoAsync
} from "../src/lib/validate/mihomo-gate";

const temporaryDirectories: string[] = [];

const makeTempDir = (prefix: string) => {
  const directory = mkdtempSync(resolve(tmpdir(), prefix));
  temporaryDirectories.push(directory);
  return directory;
};

const writeAssets = (assetsDir: string, names: string[]) => {
  const geodataDir = resolve(assetsDir, "geodata");
  mkdirSync(geodataDir, { recursive: true });
  const files = names.map((name) => {
    const bytes = Buffer.from(`fixture:${name}`);
    writeFileSync(resolve(geodataDir, name), bytes);
    return {
      name,
      sourceUrl: `https://fixture.invalid/${name}`,
      sha256: createHash("sha256").update(bytes).digest("hex"),
      size: bytes.byteLength
    };
  });
  writeFileSync(resolve(geodataDir, "manifest.json"), JSON.stringify({ version: 1, files }));
};

const writeFakeMihomo = (directory: string, body: string) => {
  const binary = resolve(directory, "mihomo");
  writeFileSync(binary, `#!/bin/sh\n${body}\n`);
  chmodSync(binary, 0o755);
  return binary;
};

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("Mihomo 离线发布门禁", () => {
  test("仓库内 geodata 清单和三份资产完整一致", () => {
    const workDir = makeTempDir("pp-geodata-work-");
    const assetsDir = resolve(import.meta.dir, "..", "assets");
    copyVerifiedMihomoGeodata(assetsDir, workDir);
    for (const name of ["geosite.dat", "country.mmdb", "ASN.mmdb"]) {
      expect(existsSync(resolve(workDir, name))).toBe(true);
    }
  });

  test("缺少 ASN.mmdb 时在启动 Mihomo 前失败", async () => {
    const root = makeTempDir("pp-mihomo-missing-asn-");
    const assetsDir = resolve(root, "assets");
    const marker = resolve(root, "invoked");
    writeAssets(assetsDir, ["geosite.dat", "country.mmdb"]);
    const binary = writeFakeMihomo(root, `touch "${marker}"\nexit 0`);

    const result = await validateWithMihomoAsync("rules: []\n", {
      mihomoPath: binary,
      dataDir: root,
      assetsDir
    });
    expect(result.passed).toBe(false);
    expect(result.output).toContain("ASN.mmdb");
    expect(existsSync(marker)).toBe(false);
  });

  test("即使进程退出为零，检测到下载尝试也必须失败", async () => {
    const root = makeTempDir("pp-mihomo-download-attempt-");
    const assetsDir = resolve(root, "assets");
    writeAssets(assetsDir, ["geosite.dat", "country.mmdb", "ASN.mmdb"]);
    const binary = writeFakeMihomo(
      root,
      "echo \"Can't find ASN.mmdb, start download\"\nexit 0"
    );

    const result = await validateWithMihomoAsync("rules: []\n", {
      mihomoPath: binary,
      dataDir: root,
      assetsDir
    });
    expect(result.passed).toBe(false);
    expect(result.output).toContain("尝试联网下载 geodata");
  });

  test("资产完整且内核退出为零时通过", async () => {
    const root = makeTempDir("pp-mihomo-success-");
    const assetsDir = resolve(root, "assets");
    writeAssets(assetsDir, ["geosite.dat", "country.mmdb", "ASN.mmdb"]);
    const binary = writeFakeMihomo(root, 'echo "configuration test is successful"\nexit 0');

    const result = await validateWithMihomoAsync("rules: []\n", {
      mihomoPath: binary,
      dataDir: root,
      assetsDir
    });
    expect(result.passed).toBe(true);
    expect(result.exitCode).toBe(0);
  });
});
