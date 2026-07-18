import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import { randomUUID } from "node:crypto";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import yaml from "js-yaml";

import type { ProxyNode } from "../../types";
import {
  copyVerifiedMihomoGeodata,
  resolveMihomoBinary,
  type MihomoGateOptions
} from "../validate/mihomo-gate";

export interface LatencyTarget {
  nodeId: string;
  name: string;
  proxy: ProxyNode;
}

export interface LatencyResult {
  nodeId: string;
  name: string;
  status: "ok" | "unreachable" | "error";
  delayMs: number | null;
  message?: string;
}

export interface MihomoLatencyOptions extends MihomoGateOptions {
  testUrl: string;
  timeoutMs: number;
  concurrency?: number;
  totalTimeoutMs?: number;
  signal?: AbortSignal;
}

export class MihomoLatencyError extends Error {
  constructor(message: string, readonly status = 503) {
    super(message);
  }
}

const DEFAULT_TOTAL_TIMEOUT_MS = 60_000;

const abortError = (signal: AbortSignal) =>
  signal.reason instanceof Error ? signal.reason : new Error("latency test aborted");

const assertJobActive = (jobSignal: AbortSignal, requestSignal?: AbortSignal) => {
  if (!jobSignal.aborted) return;
  if (requestSignal?.aborted) throw abortError(requestSignal);
  throw new MihomoLatencyError("Mihomo 延迟测试超过整体时限，已终止。", 504);
};

const delay = (milliseconds: number, signal?: AbortSignal) =>
  new Promise<void>((resolveDelay, rejectDelay) => {
    if (signal?.aborted) {
      rejectDelay(abortError(signal));
      return;
    }
    const timer = setTimeout(() => {
      if (signal && onAbort) signal.removeEventListener("abort", onAbort);
      resolveDelay();
    }, milliseconds);
    const onAbort = signal
      ? () => {
          clearTimeout(timer);
          rejectDelay(abortError(signal));
        }
      : null;
    if (signal && onAbort) signal.addEventListener("abort", onAbort, { once: true });
  });

const reserveLoopbackPort = () =>
  new Promise<number>((resolvePort, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close((error) => error ? reject(error) : resolvePort(port));
    });
  });

const waitForController = async (
  baseUrl: string,
  secret: string,
  child: ChildProcess,
  jobSignal: AbortSignal,
  requestSignal?: AbortSignal
) => {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    assertJobActive(jobSignal, requestSignal);
    if (child.exitCode !== null) throw new MihomoLatencyError("Mihomo 测试进程启动失败。");
    try {
      const response = await fetch(`${baseUrl}/version`, {
        headers: { Authorization: `Bearer ${secret}` },
        signal: AbortSignal.any([jobSignal, AbortSignal.timeout(300)])
      });
      if (response.ok) return;
    } catch {
      assertJobActive(jobSignal, requestSignal);
      // 控制端口尚未就绪。
    }
    try {
      await delay(50, jobSignal);
    } catch {
      assertJobActive(jobSignal, requestSignal);
    }
  }
  throw new MihomoLatencyError("Mihomo 测试进程启动超时。");
};

const stopChild = async (child: ChildProcess) => {
  if (child.exitCode !== null) return;
  child.kill("SIGTERM");
  await Promise.race([
    new Promise<void>((resolveExit) => child.once("exit", () => resolveExit())),
    delay(1_000).then(() => { if (child.exitCode === null) child.kill("SIGKILL"); })
  ]);
};

export const runMihomoLatencyTests = async (
  targets: LatencyTarget[],
  options: MihomoLatencyOptions
): Promise<LatencyResult[]> => {
  if (targets.length === 0) return [];
  const totalTimeoutMs =
    Number.isFinite(options.totalTimeoutMs) && (options.totalTimeoutMs ?? 0) > 0
      ? options.totalTimeoutMs!
      : DEFAULT_TOTAL_TIMEOUT_MS;
  const deadlineSignal = AbortSignal.timeout(totalTimeoutMs);
  const jobSignal = options.signal
    ? AbortSignal.any([options.signal, deadlineSignal])
    : deadlineSignal;
  assertJobActive(jobSignal, options.signal);
  const binary = resolveMihomoBinary(options);
  if (!binary) throw new MihomoLatencyError("服务端未安装 Mihomo，暂时无法测试节点延迟。");

  const workDir = resolve(tmpdir(), `pp-latency-${randomUUID()}`);
  const secret = randomUUID();
  const port = await reserveLoopbackPort();
  const baseUrl = `http://127.0.0.1:${port}`;
  mkdirSync(workDir, { recursive: true, mode: 0o700 });
  try {
    try {
      copyVerifiedMihomoGeodata(options.assetsDir, workDir);
    } catch (error) {
      throw new MihomoLatencyError(
        error instanceof Error ? error.message : "Mihomo 离线 geodata 校验失败。"
      );
    }
    assertJobActive(jobSignal, options.signal);
    writeFileSync(resolve(workDir, "config.yaml"), yaml.dump({
      "external-controller": `127.0.0.1:${port}`,
      secret,
      mode: "rule",
      "log-level": "silent",
      proxies: targets.map((target) => target.proxy),
      "proxy-groups": [{ name: "ProxyParser Latency", type: "select", proxies: targets.map((target) => target.name) }],
      rules: ["MATCH,ProxyParser Latency"]
    }, { noRefs: true, lineWidth: -1 }), { mode: 0o600 });
    assertJobActive(jobSignal, options.signal);

    const child = spawn(binary, ["-d", workDir, "-f", resolve(workDir, "config.yaml")], {
      stdio: "ignore"
    });
    try {
      await waitForController(baseUrl, secret, child, jobSignal, options.signal);
      const results = new Array<LatencyResult>(targets.length);
      let cursor = 0;
      const worker = async () => {
        while (cursor < targets.length) {
          assertJobActive(jobSignal, options.signal);
          const index = cursor++;
          const target = targets[index]!;
          try {
            const url = new URL(`${baseUrl}/proxies/${encodeURIComponent(target.name)}/delay`);
            url.searchParams.set("url", options.testUrl);
            url.searchParams.set("timeout", String(options.timeoutMs));
            const response = await fetch(url, {
              headers: { Authorization: `Bearer ${secret}` },
              signal: AbortSignal.any([
                jobSignal,
                AbortSignal.timeout(options.timeoutMs + 1_000)
              ])
            });
            const body = await response.json().catch(() => ({})) as { delay?: unknown; message?: unknown };
            if (response.ok && typeof body.delay === "number" && body.delay > 0) {
              results[index] = { nodeId: target.nodeId, name: target.name, status: "ok", delayMs: body.delay };
            } else {
              results[index] = {
                nodeId: target.nodeId, name: target.name, status: "unreachable", delayMs: null,
                message: typeof body.message === "string" ? body.message.slice(0, 160) : "节点无法连接测试地址"
              };
            }
          } catch (error) {
            assertJobActive(jobSignal, options.signal);
            results[index] = {
              nodeId: target.nodeId, name: target.name, status: "unreachable", delayMs: null,
              message: error instanceof Error && error.name === "TimeoutError" ? "测试超时" : "测试请求失败"
            };
          }
        }
      };
      await Promise.all(Array.from({ length: Math.min(options.concurrency ?? 4, targets.length) }, worker));
      assertJobActive(jobSignal, options.signal);
      return results;
    } finally {
      await stopChild(child);
    }
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
};
