import { afterEach, describe, expect, test } from "bun:test";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import {
  MihomoLatencyError,
  runMihomoLatencyTests,
  type LatencyTarget
} from "../src/lib/latency/mihomo-latency";

const temporaryDirectories: string[] = [];

const createIdleMihomo = () => {
  const directory = mkdtempSync(resolve(tmpdir(), "pp-fake-mihomo-"));
  temporaryDirectories.push(directory);
  const binary = resolve(directory, "mihomo");
  writeFileSync(binary, "#!/bin/sh\nwhile :; do sleep 1; done\n", { mode: 0o700 });
  chmodSync(binary, 0o700);
  return binary;
};

const target: LatencyTarget = {
  nodeId: "node-1",
  name: "Test Node",
  proxy: {
    name: "Test Node",
    type: "ss",
    server: "example.test",
    port: 443,
    cipher: "aes-128-gcm",
    password: "secret"
  }
};

const optionsFor = (mihomoPath: string) => ({
  mihomoPath,
  dataDir: "/nonexistent-dir",
  assetsDir: resolve(import.meta.dir, "../assets"),
  testUrl: "https://example.test/generate_204",
  timeoutMs: 5_000,
  concurrency: 1
});

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("Mihomo 延迟测试作业边界", () => {
  test("整体时限到达时终止尚未就绪的 Mihomo 作业", async () => {
    const startedAt = Date.now();
    let error: unknown;
    try {
      await runMihomoLatencyTests([target], {
        ...optionsFor(createIdleMihomo()),
        totalTimeoutMs: 100
      });
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(MihomoLatencyError);
    expect(error).toMatchObject({ status: 504 });
    expect(Date.now() - startedAt).toBeLessThan(2_000);
  });

  test("调用方取消信号会立即停止作业", async () => {
    const controller = new AbortController();
    const promise = runMihomoLatencyTests([target], {
      ...optionsFor(createIdleMihomo()),
      totalTimeoutMs: 5_000,
      signal: controller.signal
    });
    setTimeout(() => controller.abort(), 50);

    await expect(promise).rejects.toHaveProperty("name", "AbortError");
  });
});
