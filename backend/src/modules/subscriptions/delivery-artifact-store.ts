import { mkdir, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { gzip } from "node:zlib";

import { logger } from "../../lib/logging/logger";
import { observeResources } from "../../lib/logging/resource-observation";

export interface GzipDeliveryArtifact {
  bytes: Uint8Array;
  cacheStatus: "hit" | "generated";
}

const gzipAsync = promisify(gzip);

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
    try {
      const bytes = await readFile(artifactPath);
      return { bytes, cacheStatus: "hit" };
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
    return { bytes: compressed, cacheStatus: "generated" };
  }
}
