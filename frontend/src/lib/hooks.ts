import { useRef } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { useAuth } from "../providers/auth-provider";
import type {
  AccessInfo,
  CreateSubscriptionResponse,
  EventEntry,
  InstanceHealth,
  LatencyTestResponse,
  IssuedToken,
  PasteParseReportDto,
  ParsedNodeUriDto,
  PreviewResult,
  PreviewYamlResult,
  PublishCandidateResult,
  ReleaseDetail,
  ReleaseMutationResult,
  ReleaseSummary,
  RevealedToken,
  RulesetCatalogEntry,
  RulesetDiff,
  RulesetDirectorySearchResult,
  SourceSummary,
  SubscriptionDetail,
  SubscriptionSummary,
  SyncLatestRulesetsResult,
  SyncReport,
  UploadedSourceContent,
  TemplateDetail,
  TemplateSummary,
  TraceResultDto,
  WorkspaceIndexResult
} from "./types";
import type { BuildConfig, TemplateExtractionReport } from "./build-config-types";

// 服务端状态层：react-query + authorizedRequest。
// 命名约定：useXxx 查询，useXxxMutation 变更；变更成功后按 key 失效。

const keys = {
  sources: ["sources"] as const,
  source: (id: string) => ["sources", id] as const,
  sourceReports: (id: string) => ["sources", id, "reports"] as const,
  sourceContent: (id: string) => ["sources", id, "content"] as const,
  subscriptions: ["subscriptions"] as const,
  subscription: (id: string) => ["subscriptions", id] as const,
  releases: (id: string) => ["subscriptions", id, "releases"] as const,
  release: (id: string, releaseId: string) =>
    ["subscriptions", id, "releases", releaseId] as const,
  access: (id: string) => ["subscriptions", id, "access"] as const,
  rulesets: ["rulesets"] as const,
  templates: ["templates"] as const,
  template: (id: string) => ["templates", id] as const,
  templateExtractPreview: (subscriptionId: string, retainSensitive: boolean) =>
    ["template-extract-preview", subscriptionId, retainSensitive] as const,
  events: ["events"] as const,
  instance: ["instance"] as const
};

export const useSources = () => {
  const { authorizedRequest } = useAuth();
  return useQuery({
    queryKey: keys.sources,
    queryFn: () => authorizedRequest<SourceSummary[]>("/api/sources")
  });
};

export const useSourceReports = (id: string) => {
  const { authorizedRequest } = useAuth();
  return useQuery({
    queryKey: keys.sourceReports(id),
    queryFn: () => authorizedRequest<SyncReport[]>(`/api/sources/${id}/sync-reports`)
  });
};

export const useSourceContent = (id: string, enabled: boolean) => {
  const { authorizedRequest } = useAuth();
  return useQuery({
    queryKey: keys.sourceContent(id),
    queryFn: () =>
      authorizedRequest<UploadedSourceContent>(`/api/sources/${id}/content`),
    enabled
  });
};

export const useSourceMutations = () => {
  const { authorizedRequest } = useAuth();
  const qc = useQueryClient();
  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: keys.sources });
    void qc.invalidateQueries({ queryKey: keys.subscriptions });
  };
  return {
    create: useMutation({
      mutationFn: (body: Record<string, unknown>) =>
        authorizedRequest<SourceSummary>("/api/sources", {
          method: "POST",
          body: JSON.stringify(body)
        }),
      onSuccess: invalidate
    }),
    update: useMutation({
      mutationFn: ({ id, ...body }: Record<string, unknown> & { id: string }) =>
        authorizedRequest<SourceSummary>(`/api/sources/${id}`, {
          method: "PATCH",
          body: JSON.stringify(body)
        }),
      onSuccess: invalidate
    }),
    sync: useMutation({
      mutationFn: (id: string) =>
        authorizedRequest<SourceSummary>(`/api/sources/${id}/sync`, { method: "POST" }),
      onSuccess: invalidate
    }),
    remove: useMutation({
      mutationFn: (id: string) =>
        authorizedRequest<{ ok: boolean }>(`/api/sources/${id}`, { method: "DELETE" }),
      onSuccess: invalidate
    })
  };
};

export const useSubscriptions = () => {
  const { authorizedRequest } = useAuth();
  return useQuery({
    queryKey: keys.subscriptions,
    queryFn: () => authorizedRequest<SubscriptionSummary[]>("/api/subscriptions")
  });
};

export const useSubscription = (id: string) => {
  const { authorizedRequest } = useAuth();
  return useQuery({
    queryKey: keys.subscription(id),
    queryFn: () => authorizedRequest<SubscriptionDetail>(`/api/subscriptions/${id}`)
  });
};

export const useSubscriptionMutations = (id?: string) => {
  const { authorizedRequest } = useAuth();
  const qc = useQueryClient();
  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: keys.subscriptions });
    if (id) {
      void qc.invalidateQueries({ queryKey: keys.subscription(id) });
      void qc.invalidateQueries({ queryKey: keys.releases(id) });
    }
  };
  return {
    create: useMutation({
      mutationFn: (body: {
        displayName: string;
        sourceIds: string[];
        start: {
          kind: string;
          templateId?: string;
          confirmSensitive?: boolean;
        };
      }) =>
        authorizedRequest<CreateSubscriptionResponse>("/api/subscriptions", {
          method: "POST",
          body: JSON.stringify(body)
        }),
      onSuccess: invalidate
    }),
    updateMeta: useMutation({
      mutationFn: (body: Record<string, unknown>) =>
        authorizedRequest<SubscriptionDetail>(`/api/subscriptions/${id}`, {
          method: "PATCH",
          body: JSON.stringify(body)
        }),
      onSuccess: invalidate
    }),
    saveDraft: useMutation({
      mutationFn: ({
        subscriptionId,
        buildConfig,
        expectedDraftRevision
      }: {
        subscriptionId: string;
        buildConfig: BuildConfig;
        expectedDraftRevision: number;
      }) =>
        authorizedRequest<SubscriptionDetail>(`/api/subscriptions/${subscriptionId}/draft`, {
          method: "PUT",
          body: JSON.stringify({ buildConfig, expectedDraftRevision })
        }),
      onSuccess: (_detail, { subscriptionId }) => {
        void qc.invalidateQueries({ queryKey: keys.subscriptions });
        void qc.invalidateQueries({ queryKey: keys.subscription(subscriptionId) });
        void qc.invalidateQueries({ queryKey: keys.releases(subscriptionId) });
      }
    }),
    discardDraft: useMutation({
      mutationFn: ({
        subscriptionId,
        expectedDraftRevision
      }: {
        subscriptionId: string;
        expectedDraftRevision: number;
      }) =>
        authorizedRequest<SubscriptionDetail>(`/api/subscriptions/${subscriptionId}/draft`, {
          method: "DELETE",
          body: JSON.stringify({ expectedDraftRevision })
        }),
      onSuccess: (_detail, { subscriptionId }) => {
        void qc.invalidateQueries({ queryKey: keys.subscriptions });
        void qc.invalidateQueries({ queryKey: keys.subscription(subscriptionId) });
        void qc.invalidateQueries({ queryKey: keys.releases(subscriptionId) });
      }
    }),
    publish: useMutation({
      mutationFn: ({
        subscriptionId,
        candidateId,
        expectedDraftRevision,
        expectedRenderedHash
      }: {
        subscriptionId: string;
        candidateId: string;
        expectedDraftRevision: number;
        expectedRenderedHash: string;
      }) =>
        authorizedRequest<ReleaseMutationResult>(`/api/subscriptions/${subscriptionId}/publish`, {
          method: "POST",
          body: JSON.stringify({ candidateId, expectedDraftRevision, expectedRenderedHash })
        }),
      onSuccess: (_release, { subscriptionId }) => {
        void qc.invalidateQueries({ queryKey: keys.subscriptions });
        void qc.invalidateQueries({ queryKey: keys.subscription(subscriptionId) });
        void qc.invalidateQueries({ queryKey: keys.releases(subscriptionId) });
      }
    }),
    syncLatestRulesets: useMutation({
      mutationFn: (expectedDraftRevision: number) => {
        if (!id) throw new Error("缺少订阅 ID");
        return authorizedRequest<SyncLatestRulesetsResult>(
          `/api/subscriptions/${id}/rulesets/sync-latest`,
          { method: "POST", body: JSON.stringify({ expectedDraftRevision }) }
        );
      },
      onSuccess: async () => {
        if (!id) return;
        await Promise.all([
          qc.invalidateQueries({ queryKey: keys.subscriptions, exact: true }),
          qc.invalidateQueries({ queryKey: keys.subscription(id) })
        ]);
      }
    }),
    rollback: useMutation({
      mutationFn: ({
        subscriptionId,
        releaseId,
        expectedDraftRevision
      }: {
        subscriptionId: string;
        releaseId: string;
        expectedDraftRevision: number;
      }) =>
        authorizedRequest<ReleaseMutationResult>(`/api/subscriptions/${subscriptionId}/rollback`, {
          method: "POST",
          body: JSON.stringify({ releaseId, expectedDraftRevision })
        }),
      onSuccess: (_release, { subscriptionId }) => {
        void qc.invalidateQueries({ queryKey: keys.subscriptions });
        void qc.invalidateQueries({ queryKey: keys.subscription(subscriptionId) });
        void qc.invalidateQueries({ queryKey: keys.releases(subscriptionId) });
      }
    }),
    remove: useMutation({
      mutationFn: (subscriptionId: string) =>
        authorizedRequest<{ ok: boolean }>(`/api/subscriptions/${subscriptionId}`, {
          method: "DELETE"
        }),
      onSuccess: invalidate
    }),
    // 工作台卡片 / 订阅列表「复制链接」快捷按钮：优先复用已有长期链接，没有时后端会补建一条
    copyPrimaryLink: useMutation({
      mutationFn: () => {
        if (!id) throw new Error("缺少订阅 ID");
        return authorizedRequest<RevealedToken>(`/api/subscriptions/${id}/primary-link`, {
          method: "GET"
        });
      }
    })
  };
};

export const usePreview = (id: string, enabled: boolean) => {
  const { authorizedRequest } = useAuth();
  return useQuery({
    queryKey: [...keys.subscription(id), "preview"],
    queryFn: () =>
      authorizedRequest<PreviewResult>(`/api/subscriptions/${id}/preview`, { method: "POST" }),
    enabled,
    staleTime: 0,
    refetchOnMount: "always"
  });
};

export const usePreparePublishCandidate = (id: string) => {
  const { authorizedRequest } = useAuth();
  // Each mounted publish flow gets a unique key. React Query can therefore
  // deduplicate Strict Mode's effect replay without ever reusing a candidate
  // from an earlier dialog/session.
  const flowId = useRef(crypto.randomUUID()).current;
  return useQuery({
    queryKey: ["publish-candidate", id, flowId],
    queryFn: () =>
      authorizedRequest<PublishCandidateResult>(
        `/api/subscriptions/${id}/publish-candidates`,
        { method: "POST" }
      ),
    retry: false,
    staleTime: Number.POSITIVE_INFINITY,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false
  });
};

export const useValidatePublishCandidate = (id: string, candidateId: string | null) => {
  const { authorizedRequest } = useAuth();
  return useQuery({
    queryKey: ["publish-candidate-validation", id, candidateId],
    queryFn: () => {
      if (!candidateId) throw new Error("缺少发布候选版本");
      return authorizedRequest<PublishCandidateResult>(
        `/api/subscriptions/${id}/publish-candidates/${candidateId}/validate`,
        { method: "POST" }
      );
    },
    enabled: candidateId !== null,
    retry: false,
    staleTime: Number.POSITIVE_INFINITY,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false
  });
};

export const useWorkspaceIndex = (id: string, enabled: boolean) => {
  const { authorizedRequest } = useAuth();
  return useQuery({
    queryKey: [...keys.subscription(id), "workspace-index"],
    queryFn: () =>
      authorizedRequest<WorkspaceIndexResult>(
        `/api/subscriptions/${id}/workspace-index`,
        { method: "POST" }
      ),
    enabled,
    staleTime: 0
  });
};

export const usePreviewRequest = (id: string) => {
  const { authorizedRequest } = useAuth();
  return useMutation({
    mutationFn: () =>
      authorizedRequest<PreviewResult>(`/api/subscriptions/${id}/preview`, {
        method: "POST"
      })
  });
};

export const usePreviewYaml = (id: string) => {
  const { authorizedResponse } = useAuth();
  return useMutation({
    mutationFn: async ({
      expectedDraftRevision,
      expectedRenderedHash
    }: {
      expectedDraftRevision: number;
      expectedRenderedHash: string;
    }): Promise<PreviewYamlResult> => {
      const response = await authorizedResponse(
        `/api/subscriptions/${id}/preview/yaml`,
        { method: "POST", headers: { Accept: "application/yaml" }, cache: "no-store" }
      );
      const draftRevision = Number(response.headers.get("X-Draft-Revision"));
      const renderedHash = response.headers.get("X-Rendered-Hash");
      if (!Number.isSafeInteger(draftRevision) || !renderedHash) {
        await response.body?.cancel();
        throw new Error("完整预览响应缺少草稿版本信息，请重试。");
      }
      if (
        draftRevision !== expectedDraftRevision ||
        renderedHash !== expectedRenderedHash
      ) {
        await response.body?.cancel();
        throw new Error("草稿已变化，请重新生成预览后再加载 YAML。");
      }
      return {
        draftRevision,
        renderedHash,
        yamlText: await response.text()
      };
    }
  });
};

export const usePreviewYamlDownload = (id: string) => {
  const { authorizedResponse } = useAuth();
  return useMutation({
    mutationFn: async ({
      expectedDraftRevision,
      expectedRenderedHash,
      fileName
    }: {
      expectedDraftRevision: number;
      expectedRenderedHash: string;
      fileName: string;
    }) => {
      const response = await authorizedResponse(
        `/api/subscriptions/${id}/preview/yaml`,
        { method: "POST", headers: { Accept: "application/yaml" }, cache: "no-store" }
      );
      const draftRevision = Number(response.headers.get("X-Draft-Revision"));
      const renderedHash = response.headers.get("X-Rendered-Hash");
      if (!Number.isSafeInteger(draftRevision) || !renderedHash) {
        await response.body?.cancel();
        throw new Error("完整预览响应缺少草稿版本信息，请重试。");
      }
      if (
        draftRevision !== expectedDraftRevision ||
        renderedHash !== expectedRenderedHash
      ) {
        await response.body?.cancel();
        throw new Error("草稿已变化，请重新生成预览后再下载 YAML。");
      }

      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `${fileName.replace(/[\\/:*?"<>|]/g, "_") || "subscription"}.yaml`;
      link.style.display = "none";
      document.body.append(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 0);
      return { draftRevision, renderedHash };
    }
  });
};

export const useReleases = (id: string) => {
  const { authorizedRequest } = useAuth();
  return useQuery({
    queryKey: keys.releases(id),
    queryFn: () => authorizedRequest<ReleaseSummary[]>(`/api/subscriptions/${id}/releases`)
  });
};

export const useRelease = (id: string, releaseId: string | null) => {
  const { authorizedRequest } = useAuth();
  return useQuery({
    queryKey: keys.release(id, releaseId ?? "none"),
    queryFn: () =>
      authorizedRequest<ReleaseDetail>(`/api/subscriptions/${id}/releases/${releaseId}`),
    enabled: releaseId !== null
  });
};

export const useAccess = (id: string) => {
  const { authorizedRequest } = useAuth();
  return useQuery({
    queryKey: keys.access(id),
    queryFn: () => authorizedRequest<AccessInfo>(`/api/subscriptions/${id}/access`)
  });
};

export const useAccessMutations = (id: string) => {
  const { authorizedRequest } = useAuth();
  const qc = useQueryClient();
  const invalidate = () => void qc.invalidateQueries({ queryKey: keys.access(id) });
  return {
    createToken: useMutation({
      mutationFn: (label: string | null) =>
        authorizedRequest<IssuedToken>(`/api/subscriptions/${id}/tokens`, {
          method: "POST",
          body: JSON.stringify({ label })
        }),
      onSuccess: invalidate
    }),
    rotateToken: useMutation({
      mutationFn: (tokenId: string) =>
        authorizedRequest<IssuedToken>(`/api/subscriptions/${id}/tokens/${tokenId}/rotate`, {
          method: "POST"
        }),
      onSuccess: invalidate
    }),
    revokeToken: useMutation({
      mutationFn: (tokenId: string) =>
        authorizedRequest<{ ok: boolean }>(`/api/subscriptions/${id}/tokens/${tokenId}`, {
          method: "DELETE"
        }),
      onSuccess: invalidate
    }),
    renameToken: useMutation({
      mutationFn: ({ tokenId, label }: { tokenId: string; label: string | null }) =>
        authorizedRequest<{ ok: boolean }>(`/api/subscriptions/${id}/tokens/${tokenId}`, {
          method: "PATCH",
          body: JSON.stringify({ label })
        }),
      onSuccess: invalidate
    }),
    revealToken: useMutation({
      mutationFn: (tokenId: string) =>
        authorizedRequest<RevealedToken>(`/api/subscriptions/${id}/tokens/${tokenId}/reveal`, {
          method: "GET"
        })
    }),
    createTempToken: useMutation({
      mutationFn: (body: { label: string | null; ttlSeconds: number }) =>
        authorizedRequest<IssuedToken>(`/api/subscriptions/${id}/temp-tokens`, {
          method: "POST",
          body: JSON.stringify(body)
        }),
      onSuccess: invalidate
    }),
    revealTempToken: useMutation({
      mutationFn: (tokenId: string) =>
        authorizedRequest<RevealedToken>(`/api/subscriptions/${id}/temp-tokens/${tokenId}/reveal`, {
          method: "GET"
        })
    }),
    revokeTempToken: useMutation({
      mutationFn: (tokenId: string) =>
        authorizedRequest<{ ok: boolean }>(`/api/subscriptions/${id}/temp-tokens/${tokenId}`, {
          method: "DELETE"
        }),
      onSuccess: invalidate
    })
  };
};

export const useTrace = (id: string) => {
  const { authorizedRequest } = useAuth();
  return useMutation({
    mutationFn: (body: { query: string; draft?: boolean }) =>
      authorizedRequest<TraceResultDto>(`/api/subscriptions/${id}/trace`, {
        method: "POST",
        body: JSON.stringify(body)
      })
  });
};

export const useRulesets = () => {
  const { authorizedRequest } = useAuth();
  return useQuery({
    queryKey: keys.rulesets,
    queryFn: () => authorizedRequest<RulesetCatalogEntry[]>("/api/rulesets")
  });
};

// 扩展目录：blackmatrix7 全量规则组，搜索 + 分页浏览，不落库直到用户导入
export const useRulesetDirectory = (query: string, page: number, pageSize = 30) => {
  const { authorizedRequest } = useAuth();
  return useQuery({
    queryKey: ["rulesets", "directory", query, page, pageSize],
    queryFn: () =>
      authorizedRequest<RulesetDirectorySearchResult>(
        `/api/rulesets/directory?q=${encodeURIComponent(query)}&page=${page}&pageSize=${pageSize}`
      ),
    placeholderData: (previous) => previous
  });
};

export const useRulesetMutations = () => {
  const { authorizedRequest } = useAuth();
  const qc = useQueryClient();
  const invalidate = () => void qc.invalidateQueries({ queryKey: keys.rulesets });
  return {
    ensureSnapshot: useMutation({
      mutationFn: (catalogId: string) =>
        authorizedRequest<{ hash: string; behavior: string; entryCount: number }>(
          `/api/rulesets/${catalogId}/ensure-snapshot`,
          { method: "POST" }
        ),
      onSuccess: invalidate
    }),
    refresh: useMutation({
      mutationFn: (catalogId: string) =>
        authorizedRequest<{ updated: boolean; newHash: string | null }>(
          `/api/rulesets/${catalogId}/refresh`,
          { method: "POST" }
        ),
      // 失败也会在后端落 lastCheckError；无论结果如何都刷新列表，避免 UI 仍显示旧状态。
      onSettled: invalidate
    }),
    importFromUrl: useMutation({
      mutationFn: (body: { name: string; sourceUrl: string; behavior: string }) =>
        authorizedRequest<RulesetCatalogEntry>("/api/rulesets/import", {
          method: "POST",
          body: JSON.stringify(body)
        }),
      onSuccess: invalidate
    }),
    parsePaste: useMutation({
      mutationFn: (text: string) =>
        authorizedRequest<PasteParseReportDto>("/api/rulesets/parse", {
          method: "POST",
          body: JSON.stringify({ text })
        })
    }),
    applyUpdate: useMutation({
      mutationFn: (body: {
        catalogId: string;
        toHash: string;
        subscriptions: Array<{ id: string; expectedDraftRevision: number }>;
      }) =>
        authorizedRequest<Array<{ subscriptionId: string; changed: boolean; conflict?: boolean }>>(
          "/api/rulesets/apply-update",
          { method: "POST", body: JSON.stringify(body) }
        ),
      onSuccess: () => {
        invalidate();
        void qc.invalidateQueries({ queryKey: keys.subscriptions });
      }
    })
  };
};

export const useRulesetDiff = (catalogId: string | null, from: string | null, to: string | null) => {
  const { authorizedRequest } = useAuth();
  return useQuery({
    queryKey: ["rulesets", catalogId, "diff", from, to],
    queryFn: () =>
      authorizedRequest<RulesetDiff>(
        `/api/rulesets/${catalogId}/diff?to=${to}${from ? `&from=${from}` : ""}`
      ),
    enabled: catalogId !== null && to !== null
  });
};

export const useReferencingSubscriptions = (catalogId: string | null) => {
  const { authorizedRequest } = useAuth();
  return useQuery({
    queryKey: ["rulesets", catalogId, "referencing"],
    queryFn: () =>
      authorizedRequest<Array<{ id: string; displayName: string; draftRevision: number }>>(
        `/api/rulesets/${catalogId}/referencing-subscriptions`
      ),
    enabled: catalogId !== null
  });
};

export const useTemplates = () => {
  const { authorizedRequest } = useAuth();
  return useQuery({
    queryKey: keys.templates,
    queryFn: () => authorizedRequest<TemplateSummary[]>("/api/templates")
  });
};

export const useTemplate = (id: string | null) => {
  const { authorizedRequest } = useAuth();
  return useQuery({
    queryKey: keys.template(id ?? "none"),
    queryFn: () => authorizedRequest<TemplateDetail>(`/api/templates/${id}`),
    enabled: id !== null
  });
};

export const useTemplateExtractPreview = (subscriptionId: string, retainSensitive = false) => {
  const { authorizedRequest } = useAuth();
  return useQuery({
    queryKey: keys.templateExtractPreview(subscriptionId, retainSensitive),
    queryFn: () =>
      authorizedRequest<{
        payload: unknown;
        report: TemplateExtractionReport;
        draftRevision: number;
      }>(
        "/api/templates/extract-preview",
        { method: "POST", body: JSON.stringify({ subscriptionId, retainSensitive }) }
      ),
    // 每次打开都重新分析当前草稿；React Query 会复用同一轮仍在进行的请求。
    staleTime: 0,
    refetchOnMount: "always" as const,
    retry: false
  });
};

export const useTemplateMutations = () => {
  const { authorizedRequest } = useAuth();
  const qc = useQueryClient();
  const invalidate = () => void qc.invalidateQueries({ queryKey: keys.templates });
  return {
    create: useMutation({
      mutationFn: (body: {
        subscriptionId: string;
        expectedDraftRevision: number;
        displayName: string;
        description?: string;
        visibility?: string;
        retainSensitive?: boolean;
        confirmSensitive?: boolean;
        confirmShareSensitive?: boolean;
      }) =>
        authorizedRequest<TemplateDetail>("/api/templates", {
          method: "POST",
          body: JSON.stringify(body)
        }),
      onSuccess: invalidate
    }),
    instantiate: useMutation({
      mutationFn: ({ id, ...body }: { id: string; displayName: string; sourceIds: string[]; confirmSensitive?: boolean }) =>
        authorizedRequest<CreateSubscriptionResponse>(`/api/templates/${id}/instantiate`, {
          method: "POST",
          body: JSON.stringify(body)
        }),
      onSuccess: () => {
        invalidate();
        void qc.invalidateQueries({ queryKey: keys.subscriptions });
      }
    }),
    remove: useMutation({
      mutationFn: (id: string) =>
        authorizedRequest<{ ok: boolean }>(`/api/templates/${id}`, { method: "DELETE" }),
      onSuccess: invalidate
    })
  };
};

// 节点表单只有一张字段清单，敏感/非敏感的拆分与加密都在后端完成。
export const useSecretMutations = () => {
  const { authorizedRequest } = useAuth();
  return {
    split: useMutation({
      mutationFn: (body: { type: string; fields: Record<string, unknown>; secretRef?: string | null }) =>
        authorizedRequest<{ secretRef: string | null; extra: Record<string, unknown> }>(
          "/api/secrets/split",
          { method: "POST", body: JSON.stringify(body) }
        )
    }),
    // 仅用于打开编辑弹窗时回显敏感字段
    resolve: useMutation({
      mutationFn: (id: string) =>
        authorizedRequest<{ fields: Record<string, unknown> }>(`/api/secrets/${id}`)
    })
  };
};

export const useNodeUriParser = () => {
  const { authorizedRequest } = useAuth();
  return useMutation({
    mutationFn: (uri: string) =>
      authorizedRequest<ParsedNodeUriDto>("/api/nodes/parse-uri", {
        method: "POST",
        body: JSON.stringify({ uri })
      })
  });
};

export const useLatencyTest = (subscriptionId: string) => {
  const { authorizedRequest } = useAuth();
  return useMutation({
    mutationFn: (nodeIds?: string[]) =>
      authorizedRequest<LatencyTestResponse>(`/api/subscriptions/${subscriptionId}/latency-tests`, {
        method: "POST",
        body: JSON.stringify(nodeIds ? { nodeIds } : {})
      })
  });
};

export const useEvents = () => {
  const { authorizedRequest } = useAuth();
  return useQuery({
    queryKey: keys.events,
    queryFn: () => authorizedRequest<EventEntry[]>("/api/events?limit=50"),
    refetchInterval: 30_000
  });
};

export const useInstanceHealth = () => {
  const { authorizedRequest } = useAuth();
  return useQuery({
    queryKey: keys.instance,
    queryFn: () => authorizedRequest<InstanceHealth>("/api/instance/health")
  });
};
