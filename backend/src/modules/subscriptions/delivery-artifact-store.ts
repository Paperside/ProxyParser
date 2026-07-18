import { mkdir, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { gzip, gunzip } from "node:zlib";

import { logger } from "../../lib/logging/logger";
import { observeResources } from "../../lib/logging/resource-observation";

export interface GzipDeliveryArtifact {
  bytes: Uint8Array;
  cacheStatus: "hit" | "generated" | "repaired";
}

const gzipAsync = promisify(gzip);
const gunzipAsync = promisify(gunzip);

export class DeliveryArtifactStore {
  private readonly pending = new Map<string, Promise<GzipDeliveryArtifact>>();

  constructor(private readonly directory: string) {}

  async getOrCreate(renderedHash: string, yamlText: string): Promise<GzipDeliveryArtifact> {
    const existing = this.pending.get(renderedHash);
    if (existing) return existing;

    const operation = this.readOrCreate(renderedHash, yamlText).finally(() => {
      this.pending.delete(renderedHash);
    });
    this.pending.set(renderedHash, operation);
    return operation;
  }

  private async readOrCreate(
    renderedHash: string,
    yamlText: string
  ): Promise<GzipDeliveryArtifact> {
    await mkdir(this.directory, { recursive: true });
    const artifactPath = resolve(this.directory, `${renderedHash}.yaml.gz`);
    let repaired = false;
    try {
      const bytes = await readFile(artifactPath);
      try {
        const restored = await gunzipAsync(bytes);
        if (restored.equals(Buffer.from(yamlText, "utf8"))) {
          return { bytes, cacheStatus: "hit" };
        }
        throw new Error("解压后的内容与发布版本不一致");
      } catch (error) {
        repaired = true;
        logger.warn({
          event: "delivery.artifact.corrupt",
          renderedHash,
          reason: error instanceof Error ? error.message : "gzip 产物校验失败"
        });
        await unlink(artifactPath).catch(() => undefined);
      }
    } catch (error) {
      if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
    }

    const startedAt = performance.now();
    logger.info({
      event: "delivery.artifact.generate.started",
      renderedHash,
      yamlBytes: Buffer.byteLength(yamlText, "utf8"),
      ...observeResources()
    });
    const compressed = await gzipAsync(yamlText, { level: 1 });
    const temporaryPath = `${artifactPath}.${process.pid}.${crypto.randomUUID()}.tmp`;
    try {
      await writeFile(temporaryPath, compressed, { flag: "wx" });
      await rename(temporaryPath, artifactPath);
    } catch (error) {
      await unlink(temporaryPath).catch(() => undefined);
      throw error;
    }
    const size = (await stat(artifactPath)).size;
    logger.info({
      event: "delivery.artifact.generate.finished",
      renderedHash,
      gzipBytes: size,
      durationMs: Math.round(performance.now() - startedAt),
      ...observeResources()
    });
    return { bytes: compressed, cacheStatus: repaired ? "repaired" : "generated" };
  }
}
