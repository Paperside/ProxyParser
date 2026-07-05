import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { useAuth } from "../providers/auth-provider";
import type {
  AccessInfo,
  CreateSubscriptionResponse,
  EventEntry,
  InstanceHealth,
  IssuedToken,
  PasteParseReportDto,
  PreviewResult,
  ReleaseDetail,
  ReleaseSummary,
  RulesetCatalogEntry,
  RulesetDiff,
  SourceSummary,
  SubscriptionDetail,
  SubscriptionSummary,
  SyncReport,
  TemplateDetail,
  TemplateSummary,
  TraceResultDto
} from "./types";
import type { BuildConfig } from "./build-config-types";

// 服务端状态层：react-query + authorizedRequest。
// 命名约定：useXxx 查询，useXxxMutation 变更；变更成功后按 key 失效。

const keys = {
  sources: ["sources"] as const,
  source: (id: string) => ["sources", id] as const,
  sourceReports: (id: string) => ["sources", id, "reports"] as const,
  subscriptions: ["subscriptions"] as const,
  subscription: (id: string) => ["subscriptions", id] as const,
  releases: (id: string) => ["subscriptions", id, "releases"] as const,
  release: (id: string, releaseId: string) =>
    ["subscriptions", id, "releases", releaseId] as const,
  access: (id: string) => ["subscriptions", id, "access"] as const,
  rulesets: ["rulesets"] as const,
  templates: ["templates"] as const,
  template: (id: string) => ["templates", id] as const,
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
        start: { kind: string; templateId?: string };
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
      mutationFn: (config: BuildConfig) =>
        authorizedRequest<SubscriptionDetail>(`/api/subscriptions/${id}/draft`, {
          method: "PUT",
          body: JSON.stringify(config)
        }),
      onSuccess: invalidate
    }),
    discardDraft: useMutation({
      mutationFn: () =>
        authorizedRequest<SubscriptionDetail>(`/api/subscriptions/${id}/draft`, {
          method: "DELETE"
        }),
      onSuccess: invalidate
    }),
    publish: useMutation({
      mutationFn: () =>
        authorizedRequest<ReleaseSummary>(`/api/subscriptions/${id}/publish`, {
          method: "POST"
        }),
      onSuccess: invalidate
    }),
    rollback: useMutation({
      mutationFn: (releaseId: string) =>
        authorizedRequest<ReleaseSummary>(`/api/subscriptions/${id}/rollback`, {
          method: "POST",
          body: JSON.stringify({ releaseId })
        }),
      onSuccess: invalidate
    }),
    remove: useMutation({
      mutationFn: (subscriptionId: string) =>
        authorizedRequest<{ ok: boolean }>(`/api/subscriptions/${subscriptionId}`, {
          method: "DELETE"
        }),
      onSuccess: invalidate
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
    staleTime: 0
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
    createTempToken: useMutation({
      mutationFn: (body: { label: string | null; ttlSeconds: number }) =>
        authorizedRequest<IssuedToken>(`/api/subscriptions/${id}/temp-tokens`, {
          method: "POST",
          body: JSON.stringify(body)
        }),
      onSuccess: invalidate
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
      onSuccess: invalidate
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
      mutationFn: (body: { catalogId: string; toHash: string; subscriptionIds: string[] }) =>
        authorizedRequest<Array<{ subscriptionId: string; changed: boolean }>>(
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
      authorizedRequest<Array<{ id: string; displayName: string }>>(
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

export const useTemplateMutations = () => {
  const { authorizedRequest } = useAuth();
  const qc = useQueryClient();
  const invalidate = () => void qc.invalidateQueries({ queryKey: keys.templates });
  return {
    extractPreview: useMutation({
      mutationFn: (subscriptionId: string) =>
        authorizedRequest<{ payload: unknown; report: { recorded: string[]; dropped: Array<{ reason: string; detail: string }> } }>(
          "/api/templates/extract-preview",
          { method: "POST", body: JSON.stringify({ subscriptionId }) }
        )
    }),
    create: useMutation({
      mutationFn: (body: {
        subscriptionId: string;
        displayName: string;
        description?: string;
        visibility?: string;
      }) =>
        authorizedRequest<TemplateDetail>("/api/templates", {
          method: "POST",
          body: JSON.stringify(body)
        }),
      onSuccess: invalidate
    }),
    instantiate: useMutation({
      mutationFn: ({ id, ...body }: { id: string; displayName: string; sourceIds: string[] }) =>
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

export const useSecretMutations = () => {
  const { authorizedRequest } = useAuth();
  return {
    create: useMutation({
      mutationFn: (fields: Record<string, unknown>) =>
        authorizedRequest<{ secretRef: string; fieldNames: string[] }>("/api/secrets", {
          method: "POST",
          body: JSON.stringify({ fields })
        })
    })
  };
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
