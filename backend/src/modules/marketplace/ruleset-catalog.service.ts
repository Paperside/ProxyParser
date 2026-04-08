import { createId } from "../../lib/ids";
import { MarketplaceRepository } from "./marketplace.repository";
import { RulesetSyncService } from "./ruleset-sync.service";

interface CreateRulesetInput {
  name: string;
  slug?: string;
  description?: string | null;
  sourceUrl: string;
  visibility?: "private" | "unlisted" | "public";
  behavior?: "domain" | "ipcidr" | "classical";
}

interface UpdateRulesetInput {
  name?: string;
  slug?: string;
  description?: string | null;
  sourceUrl?: string;
  visibility?: "private" | "unlisted" | "public";
  behavior?: "domain" | "ipcidr" | "classical";
  status?: "active" | "disabled" | "archived";
}

export class RulesetCatalogError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message);
  }
}

const normalizeSlug = (value: string | undefined | null) => {
  if (!value) {
    return null;
  }

  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "");
};

export class RulesetCatalogService {
  constructor(
    private readonly repository: MarketplaceRepository,
    private readonly syncService: RulesetSyncService
  ) {}

  listAccessible(ownerUserId: string) {
    return this.repository.listAccessibleRulesets(ownerUserId);
  }

  getOwned(ownerUserId: string, rulesetId: string) {
    const detail = this.repository.findRulesetByIdAndOwner(rulesetId, ownerUserId);

    if (!detail) {
      throw new RulesetCatalogError("未找到该规则源。", 404);
    }

    return detail;
  }

  async create(ownerUserId: string, input: CreateRulesetInput) {
    const name = input.name.trim();
    const sourceUrl = input.sourceUrl.trim();

    if (!name) {
      throw new RulesetCatalogError("规则源名称不能为空。", 400);
    }

    if (!/^https?:\/\//i.test(sourceUrl)) {
      throw new RulesetCatalogError("规则源地址必须是 http 或 https。", 400);
    }

    const slug =
      normalizeSlug(input.slug) ?? normalizeSlug(`${ownerUserId.slice(0, 8)}-${name}`) ?? "";

    const created = this.repository.createRuleset({
      id: createId("ruleset"),
      ownerUserId,
      slug,
      name,
      description: input.description?.trim() ?? null,
      sourceType: "http_file",
      sourceUrl,
      sourceRepo: null,
      visibility: input.visibility ?? "private",
      metadataJson: JSON.stringify({
        category: "user_ruleset",
        kind: "rule_provider",
        format: "yaml",
        parser: "yaml_payload_or_lines",
        behavior: input.behavior ?? "classical",
        importedByUser: true,
        updateIntervalSeconds: 24 * 60 * 60
      })
    });

    if (!created) {
      throw new RulesetCatalogError("创建规则源失败。", 500);
    }

    try {
      await this.syncService.syncRulesetById(created.id);
    } catch {
      return this.getOwned(ownerUserId, created.id);
    }

    return this.getOwned(ownerUserId, created.id);
  }

  async update(ownerUserId: string, rulesetId: string, input: UpdateRulesetInput) {
    const current = this.getOwned(ownerUserId, rulesetId);
    const slug =
      input.slug === undefined ? undefined : normalizeSlug(input.slug) ?? current.slug;
    const metadata = {
      ...current.metadata,
      behavior: input.behavior ?? current.metadata.behavior ?? "classical"
    };
    const updated = this.repository.updateRuleset(rulesetId, ownerUserId, {
      slug: slug ?? undefined,
      name: input.name?.trim(),
      description:
        input.description === undefined ? undefined : input.description?.trim() ?? null,
      sourceUrl: input.sourceUrl?.trim(),
      visibility: input.visibility,
      status: input.status,
      metadataJson: JSON.stringify(metadata)
    });

    if (!updated) {
      throw new RulesetCatalogError("更新规则源失败。", 500);
    }

    if (input.sourceUrl !== undefined || input.behavior !== undefined) {
      try {
        await this.syncService.syncRulesetById(rulesetId);
      } catch {
        return this.getOwned(ownerUserId, rulesetId);
      }
    }

    return this.getOwned(ownerUserId, rulesetId);
  }

  delete(ownerUserId: string, rulesetId: string) {
    const current = this.getOwned(ownerUserId, rulesetId);

    if (current.isOfficial) {
      throw new RulesetCatalogError("官方规则源不允许删除。", 400);
    }

    this.repository.deleteRuleset(rulesetId, ownerUserId);
    return {
      success: true
    };
  }

  async sync(ownerUserId: string, rulesetId: string) {
    this.getOwned(ownerUserId, rulesetId);
    await this.syncService.syncRulesetById(rulesetId);
    return this.getOwned(ownerUserId, rulesetId);
  }
}
