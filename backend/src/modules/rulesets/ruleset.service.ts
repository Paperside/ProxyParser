import { createHash } from "node:crypto";

import { createId } from "../../lib/ids";
import { normalizeRulesetContent } from "../../lib/rulesets/normalize";
import { decodeMultiSourceSpec, mergeMultiSourceClassical } from "../../lib/rulesets/merge";
import { parsePastedRules, type PasteParseReport } from "../../lib/rulesets/parse";
import { logger } from "../../lib/logging/logger";
import type { EventRepository } from "../events/event.repository";
import type { RulesetCatalogEntry, RulesetRepository, RulesetSnapshotRecord } from "./ruleset.repository";

export class RulesetError extends Error {
  constructor(
    message: string,
    readonly status = 400
  ) {
    super(message);
  }
}

const sha256Hex = (input: string) => createHash("sha256").update(input).digest("hex");

export class RulesetService {
  constructor(
    private readonly repository: RulesetRepository,
    private readonly events: EventRepository
  ) {}

  list(userId: string) {
    return this.repository.listVisible(userId);
  }

  getById(userId: string, id: string): RulesetCatalogEntry {
    const entry = this.repository.findById(id);
    if (!entry || (entry.ownerUserId !== null && entry.ownerUserId !== userId)) {
      throw new RulesetError("规则源不存在。", 404);
    }
    return entry;
  }

  getSnapshot(hash: string): RulesetSnapshotRecord | null {
    return this.repository.findSnapshot(hash);
  }

  getPublicSnapshot(hash: string): RulesetSnapshotRecord | null {
    return this.repository.findPublicSnapshot(hash);
  }

  // 导入到订阅前调用：保证该规则源存在可引用的快照（无则即时抓取）
  async ensureLatestSnapshot(userId: string, catalogId: string): Promise<RulesetSnapshotRecord> {
    const entry = this.getById(userId, catalogId);
    if (entry.latestSnapshotHash) {
      const snapshot = this.repository.findSnapshot(entry.latestSnapshotHash);
      if (snapshot) return snapshot;
    }
    return await this.fetchAndStore(entry, { setLatest: true, badge: false });
  }

  // 用户从 URL 导入自定义规则源
  async importFromUrl(
    userId: string,
    input: {
      name: string;
      sourceUrl: string;
      behavior: "domain" | "ipcidr" | "classical";
      recommendedTarget?: string;
    }
  ): Promise<RulesetCatalogEntry> {
    if (!/^https?:\/\//.test(input.sourceUrl)) {
      throw new RulesetError("规则源 URL 必须是 http(s) 链接。");
    }
    const baseSlug = input.name
      .toLowerCase()
      .replace(/[^a-z0-9一-龥]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40);
    let slug = baseSlug.length > 0 ? baseSlug : "ruleset";
    let suffix = 1;
    while (this.repository.slugExists(slug)) {
      suffix += 1;
      slug = `${baseSlug}-${suffix}`;
    }
    const entry = this.repository.createUserCatalog({
      id: createId("rsc"),
      ownerUserId: userId,
      slug,
      name: input.name,
      description: null,
      sourceUrl: input.sourceUrl,
      behavior: input.behavior,
      recommendedTarget: input.recommendedTarget ?? null
    });
    await this.fetchAndStore(entry, { setLatest: true, badge: false });
    return this.repository.findById(entry.id)!;
  }

  // 后台/手动检查更新：有新内容 → 存新快照 + 徽章 + 事件；绝不改任何 BuildConfig
  async checkForUpdates(catalogId: string): Promise<{ updated: boolean; newHash: string | null }> {
    const entry = this.repository.findById(catalogId);
    if (!entry || !entry.sourceUrl) {
      return { updated: false, newHash: null };
    }
    try {
      const snapshot = await this.fetchAndStore(entry, { setLatest: false, badge: false });
      this.repository.markChecked(catalogId, null);
      if (snapshot.hash !== entry.latestSnapshotHash) {
        this.repository.setLatestSnapshot(catalogId, snapshot.hash, true);
        this.events.insertForAll({
          entityKind: "ruleset",
          entityId: catalogId,
          kind: "ruleset.update_available",
          payload: {
            slug: entry.slug,
            name: entry.name,
            fromHash: entry.latestSnapshotHash,
            toHash: snapshot.hash,
            entryCount: snapshot.entryCount
          }
        });
        return { updated: true, newHash: snapshot.hash };
      }
      return { updated: false, newHash: snapshot.hash };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.repository.markChecked(catalogId, message);
      logger.warn({ event: "ruleset.check.failed", catalogId, reason: message });
      return { updated: false, newHash: null };
    }
  }

  listDueForCheck(intervalMinutes: number, limit: number) {
    return this.repository.listDueForCheck(intervalMinutes, limit);
  }

  // 两个快照的条目级差异（前端展示 +N/-M 与明细）
  diffSnapshots(fromHash: string | null, toHash: string) {
    const to = this.repository.findSnapshot(toHash);
    if (!to) {
      throw new RulesetError("目标快照不存在。", 404);
    }
    const from = fromHash ? this.repository.findSnapshot(fromHash) : null;
    const parse = (content: string) =>
      content
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line.startsWith("- "))
        .map((line) => line.slice(2).replace(/^['"]|['"]$/g, ""));
    const fromEntries = new Set(from ? parse(from.content) : []);
    const toEntries = new Set(parse(to.content));
    const added: string[] = [];
    const removed: string[] = [];
    for (const entry of toEntries) {
      if (!fromEntries.has(entry)) added.push(entry);
    }
    for (const entry of fromEntries) {
      if (!toEntries.has(entry)) removed.push(entry);
    }
    return {
      fromHash,
      toHash,
      addedCount: added.length,
      removedCount: removed.length,
      addedSample: added.slice(0, 50),
      removedSample: removed.slice(0, 50),
      toEntryCount: to.entryCount
    };
  }

  parsePaste(text: string): PasteParseReport {
    return parsePastedRules(text);
  }

  private async fetchAndStore(
    entry: RulesetCatalogEntry,
    options: { setLatest: boolean; badge: boolean }
  ): Promise<RulesetSnapshotRecord> {
    if (!entry.sourceUrl) {
      throw new RulesetError("该规则源没有远端地址，无法抓取。");
    }
    // 官方多源规则组（source_url 是 JSON 编码的 {sources, extraRules}）与用户单一 URL 导入
    // 走同一套合并/规范化逻辑，保证在线复检与离线快照重新生成结果一致。
    const multiSource = decodeMultiSourceSpec(entry.sourceUrl);
    const normalized = multiSource
      ? await mergeMultiSourceClassical(multiSource)
      : normalizeRulesetContent(await this.fetchText(entry.sourceUrl));
    const snapshot: RulesetSnapshotRecord = {
      hash: sha256Hex(normalized.content),
      catalogId: entry.id,
      content: normalized.content,
      behavior: entry.behavior,
      entryCount: normalized.entryCount,
      isPublic: entry.ownerUserId === null, // 官方内置公开；用户导入的内容默认不经 /rs/ 提供
      fetchedAt: new Date().toISOString()
    };
    this.repository.insertSnapshot(snapshot);
    if (options.setLatest) {
      this.repository.setLatestSnapshot(entry.id, snapshot.hash, options.badge);
    }
    return this.repository.findSnapshot(snapshot.hash) ?? snapshot;
  }

  private async fetchText(url: string): Promise<string> {
    const response = await fetch(url);
    if (!response.ok) {
      throw new RulesetError(`抓取失败：HTTP ${response.status}`);
    }
    return response.text();
  }
}
