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
}

export class MihomoLatencyError extends Error {
  constructor(message: string, readonly status = 503) {
    super(message);
  }
}

const delay = (milliseconds: number) =>
  new Promise<void>((resolveDelay) => setTimeout(resolveDelay, milliseconds));

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

const waitForController = async (baseUrl: string, secret: string, child: ChildProcess) => {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new MihomoLatencyError("Mihomo 测试进程启动失败。");
    try {
      const response = await fetch(`${baseUrl}/version`, {
        headers: { Authorization: `Bearer ${secret}` },
        signal: AbortSignal.timeout(300)
      });
      if (response.ok) return;
    } catch {
      // 控制端口尚未就绪。
    }
    await delay(50);
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
  const binary = resolveMihomoBinary(options);
  if (!binary) throw new MihomoLatencyError("服务端未安装 Mihomo，暂时无法测试节点延迟。");

  const workDir = resolve(tmpdir(), `pp-latency-${randomUUID()}`);
  const secret = randomUUID();
  const port = await reserveLoopbackPort();
  const baseUrl = `http://127.0.0.1:${port}`;
  mkdirSync(workDir, { recursive: true, mode: 0o700 });
  try {
    copyVerifiedMihomoGeodata(options.assetsDir, workDir);
  } catch (error) {
    rmSync(workDir, { recursive: true, force: true });
    throw new MihomoLatencyError(
      error instanceof Error ? error.message : "Mihomo 离线 geodata 校验失败。"
    );
  }
  writeFileSync(resolve(workDir, "config.yaml"), yaml.dump({
    "external-controller": `127.0.0.1:${port}`,
    secret,
    mode: "rule",
    "log-level": "silent",
    proxies: targets.map((target) => target.proxy),
    "proxy-groups": [{ name: "ProxyParser Latency", type: "select", proxies: targets.map((target) => target.name) }],
    rules: ["MATCH,ProxyParser Latency"]
  }, { noRefs: true, lineWidth: -1 }), { mode: 0o600 });

  const child = spawn(binary, ["-d", workDir, "-f", resolve(workDir, "config.yaml")], {
    stdio: "ignore"
  });
  try {
    await waitForController(baseUrl, secret, child);
    const results = new Array<LatencyResult>(targets.length);
    let cursor = 0;
    const worker = async () => {
      while (cursor < targets.length) {
        const index = cursor++;
        const target = targets[index]!;
        try {
          const url = new URL(`${baseUrl}/proxies/${encodeURIComponent(target.name)}/delay`);
          url.searchParams.set("url", options.testUrl);
          url.searchParams.set("timeout", String(options.timeoutMs));
          const response = await fetch(url, {
            headers: { Authorization: `Bearer ${secret}` },
            signal: AbortSignal.timeout(options.timeoutMs + 1_000)
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
          results[index] = {
            nodeId: target.nodeId, name: target.name, status: "unreachable", delayMs: null,
            message: error instanceof Error && error.name === "TimeoutError" ? "测试超时" : "测试请求失败"
          };
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(options.concurrency ?? 4, targets.length) }, worker));
    return results;
  } finally {
    await stopChild(child);
    rmSync(workDir, { recursive: true, force: true });
  }
};
