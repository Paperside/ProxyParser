import type { TemplateDetail, TemplatePayload, TemplateSummary } from "../../types";
import { createId } from "../../lib/ids";
import { createDefaultTemplatePayload, normalizeTemplatePayload } from "../../lib/render/template-payload";
import { renderManagedConfig } from "../../lib/render/render-managed-config";
import { TemplateRepository } from "./template.repository";

export class TemplateError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message);
  }
}

interface CreateTemplateInput {
  displayName: string;
  slug?: string | null;
  description?: string | null;
  sourceTemplateId?: string | null;
  sourceLabel?: string | null;
  sourceUrl?: string | null;
  visibility?: "private" | "unlisted" | "public";
  shareMode?: "disabled" | "view" | "fork";
  publishStatus?: "draft" | "published" | "archived";
  versionNote?: string | null;
  payload?: unknown;
}

interface UpdateTemplateInput extends CreateTemplateInput {}

const normalizeSlug = (value: string | null | undefined) => {
  if (!value) {
    return null;
  }

  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "");
};

const exportTemplatePreviewYaml = (payload: TemplatePayload) => {
  try {
    const preview = renderManagedConfig(
      {
        proxies: payload.customProxies,
        "proxy-groups": payload.proxyGroups,
        rules: payload.rules,
        ...payload.configPatch
      },
      createDefaultTemplatePayload()
    );

    return preview.yamlText;
  } catch {
    return null;
  }
};

export class TemplateService {
  constructor(private readonly repository: TemplateRepository) {}

  listByOwner(ownerUserId: string): TemplateSummary[] {
    return this.repository.listByOwner(ownerUserId);
  }

  getById(ownerUserId: string, templateId: string): TemplateDetail {
    const detail = this.repository.findDetailByIdAndOwner(templateId, ownerUserId);

    if (!detail) {
      throw new TemplateError("未找到该模板。", 404);
    }

    return detail;
  }

  create(ownerUserId: string, input: CreateTemplateInput) {
    if (!input.displayName.trim()) {
      throw new TemplateError("模板名称不能为空。", 400);
    }

    const payload = normalizeTemplatePayload(input.payload);

    const created = this.repository.create({
      id: createId("tpl"),
      ownerUserId,
      displayName: input.displayName.trim(),
      slug: normalizeSlug(input.slug),
      description: input.description?.trim() ?? null,
      sourceTemplateId: input.sourceTemplateId ?? null,
      sourceLabel: input.sourceLabel?.trim() ?? null,
      sourceUrl: input.sourceUrl?.trim() ?? null,
      visibility: input.visibility ?? "private",
      shareMode: input.shareMode ?? "disabled",
      publishStatus: input.publishStatus ?? "draft",
      versionId: createId("tplv"),
      versionNote: input.versionNote ?? "初始版本",
      payloadJson: JSON.stringify(payload),
      exportedYaml: exportTemplatePreviewYaml(payload)
    });

    if (!created) {
      throw new TemplateError("创建模板失败。", 500);
    }

    return created;
  }

  update(ownerUserId: string, templateId: string, input: UpdateTemplateInput) {
    const current = this.repository.findDetailByIdAndOwner(templateId, ownerUserId);

    if (!current) {
      throw new TemplateError("未找到该模板。", 404);
    }

    const payload = normalizeTemplatePayload(input.payload ?? current.payload);
    const updated = this.repository.update(templateId, ownerUserId, {
      displayName: input.displayName?.trim(),
      slug: input.slug === undefined ? undefined : normalizeSlug(input.slug),
      description: input.description?.trim() ?? input.description,
      sourceTemplateId: input.sourceTemplateId,
      sourceLabel: input.sourceLabel?.trim() ?? input.sourceLabel,
      sourceUrl: input.sourceUrl?.trim() ?? input.sourceUrl,
      visibility: input.visibility,
      shareMode: input.shareMode,
      publishStatus: input.publishStatus,
      versionId: createId("tplv"),
      versionNote: input.versionNote ?? "更新模板",
      payloadJson: JSON.stringify(payload),
      exportedYaml: exportTemplatePreviewYaml(payload)
    });

    if (!updated) {
      throw new TemplateError("更新模板失败。", 500);
    }

    return updated;
  }

  delete(ownerUserId: string, templateId: string) {
    const current = this.repository.findDetailByIdAndOwner(templateId, ownerUserId);

    if (!current) {
      throw new TemplateError("未找到该模板。", 404);
    }

    this.repository.delete(templateId, ownerUserId);

    return {
      success: true
    };
  }

  forkPublicTemplate(ownerUserId: string, templateId: string) {
    const template = this.repository.findPublicDetailById(templateId);

    if (!template) {
      throw new TemplateError("未找到可复制的公开模板。", 404);
    }

    const created = this.repository.create({
      id: createId("tpl"),
      ownerUserId,
      displayName: `${template.displayName} 副本`,
      slug: null,
      description: template.description,
      sourceTemplateId: template.id,
      sourceLabel: template.displayName,
      sourceUrl: template.slug ? `/templates/${template.slug}` : `/templates/${template.id}`,
      visibility: "private",
      shareMode: "disabled",
      publishStatus: "draft",
      versionId: createId("tplv"),
      versionNote: `复制自 ${template.displayName}`,
      payloadJson: JSON.stringify(template.payload),
      exportedYaml: exportTemplatePreviewYaml(template.payload)
    });

    if (!created) {
      throw new TemplateError("复制模板失败。", 500);
    }

    return created;
  }
}
