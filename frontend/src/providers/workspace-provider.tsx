import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type PropsWithChildren
} from "react";

import type {
  GeneratedSubscriptionDraft,
  GeneratedSubscriptionDraftDetail,
  GeneratedSubscriptionDraftPreview,
  GeneratedSubscriptionSnapshot,
  GeneratedSubscriptionSnapshotCompare,
  GeneratedSubscription,
  GeneratedSubscriptionDetail,
  MarketplaceRuleset,
  MarketplaceTemplate,
  SubscriptionShareGrant,
  SubscriptionShareGrantMode,
  SubscriptionShareScope,
  SubscriptionTempTokenSummary,
  Template,
  TemplateDetail,
  UpstreamSource,
  UpstreamSourceDetail
} from "../lib/types";
import { API_BASE_URL } from "../lib/api";
import { useAuth } from "./auth-provider";

interface WorkspaceContextValue {
  isLoading: boolean;
  sources: UpstreamSource[];
  templates: Template[];
  generatedSubscriptions: GeneratedSubscription[];
  generatedSubscriptionDrafts: GeneratedSubscriptionDraft[];
  marketplaceRulesets: MarketplaceRuleset[];
  marketplaceTemplates: MarketplaceTemplate[];
  refreshAll: () => Promise<void>;
  getSourceDetail: (id: string) => Promise<UpstreamSourceDetail>;
  createSource: (input: Record<string, unknown>) => Promise<UpstreamSourceDetail>;
  updateSource: (id: string, input: Record<string, unknown>) => Promise<UpstreamSourceDetail>;
  syncSource: (id: string) => Promise<UpstreamSourceDetail>;
  deleteSource: (id: string) => Promise<void>;
  createRuleset: (input: Record<string, unknown>) => Promise<MarketplaceRuleset>;
  updateRuleset: (id: string, input: Record<string, unknown>) => Promise<MarketplaceRuleset>;
  syncRuleset: (id: string) => Promise<MarketplaceRuleset>;
  deleteRuleset: (id: string) => Promise<void>;
  getTemplateDetail: (id: string) => Promise<TemplateDetail>;
  createTemplate: (input: Record<string, unknown>) => Promise<TemplateDetail>;
  updateTemplate: (id: string, input: Record<string, unknown>) => Promise<TemplateDetail>;
  deleteTemplate: (id: string) => Promise<void>;
  forkTemplate: (id: string) => Promise<TemplateDetail>;
  getGeneratedSubscriptionDetail: (id: string) => Promise<GeneratedSubscriptionDetail>;
  listGeneratedSubscriptionSnapshots: (id: string) => Promise<GeneratedSubscriptionSnapshot[]>;
  compareGeneratedSubscriptionSnapshots: (
    id: string,
    baseSnapshotId: string,
    targetSnapshotId: string
  ) => Promise<GeneratedSubscriptionSnapshotCompare>;
  getGeneratedSubscriptionDraft: (id: string) => Promise<GeneratedSubscriptionDraftDetail>;
  createGeneratedSubscriptionDraft: (
    input: Record<string, unknown>
  ) => Promise<GeneratedSubscriptionDraftDetail>;
  updateGeneratedSubscriptionDraft: (
    id: string,
    input: Record<string, unknown>
  ) => Promise<GeneratedSubscriptionDraftDetail>;
  saveGeneratedSubscriptionDraftStep: (
    id: string,
    input: Record<string, unknown>
  ) => Promise<GeneratedSubscriptionDraftDetail>;
  previewGeneratedSubscriptionDraft: (id: string) => Promise<GeneratedSubscriptionDraftPreview>;
  publishGeneratedSubscriptionDraft: (
    id: string,
    input: Record<string, unknown>
  ) => Promise<GeneratedSubscriptionDetail>;
  extractTemplateFromDraft: (id: string, input: Record<string, unknown>) => Promise<TemplateDetail>;
  createGeneratedSubscription: (
    input: Record<string, unknown>
  ) => Promise<GeneratedSubscriptionDetail>;
  updateGeneratedSubscription: (
    id: string,
    input: Record<string, unknown>
  ) => Promise<GeneratedSubscriptionDetail>;
  deleteGeneratedSubscription: (id: string) => Promise<void>;
  renderGeneratedSubscription: (id: string) => Promise<GeneratedSubscriptionDetail>;
  listTempTokens: (id: string) => Promise<SubscriptionTempTokenSummary[]>;
  createTempLink: (id: string, expiresInSeconds?: number) => Promise<string>;
  revokeTempToken: (id: string, tokenId: string) => Promise<void>;
  listShareGrants: (id: string) => Promise<SubscriptionShareGrant[]>;
  upsertShareGrant: (
    id: string,
    input: {
      scope: SubscriptionShareScope;
      mode: SubscriptionShareGrantMode;
      targetUserId?: string | null;
      targetEmail?: string | null;
    }
  ) => Promise<SubscriptionShareGrant>;
  revokeShareGrant: (id: string, grantId: string) => Promise<void>;
  rotateSubscriptionSecret: (id?: string) => Promise<string>;
}

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);

export const WorkspaceProvider = ({ children }: PropsWithChildren) => {
  const auth = useAuth();
  const [isLoading, setIsLoading] = useState(false);
  const [sources, setSources] = useState<UpstreamSource[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [generatedSubscriptions, setGeneratedSubscriptions] = useState<GeneratedSubscription[]>(
    []
  );
  const [generatedSubscriptionDrafts, setGeneratedSubscriptionDrafts] = useState<
    GeneratedSubscriptionDraft[]
  >([]);
  const [marketplaceRulesets, setMarketplaceRulesets] = useState<MarketplaceRuleset[]>([]);
  const [marketplaceTemplates, setMarketplaceTemplates] = useState<MarketplaceTemplate[]>([]);

  const refreshAll = async () => {
    if (!auth.session) {
      return;
    }

    setIsLoading(true);

    try {
      const [
        nextSources,
        nextTemplates,
        nextGeneratedSubscriptions,
        nextGeneratedSubscriptionDrafts,
        nextMarketplaceRulesets
      ] =
        await Promise.all([
          auth.authorizedRequest<UpstreamSource[]>("/api/upstream-sources"),
          auth.authorizedRequest<Template[]>("/api/templates"),
          auth.authorizedRequest<GeneratedSubscription[]>("/api/subscriptions"),
          auth.authorizedRequest<GeneratedSubscriptionDraft[]>("/api/generated-subscription-drafts"),
          auth.authorizedRequest<MarketplaceRuleset[]>("/api/rulesets")
        ]);
      const nextMarketplaceTemplates = await fetch(
        `${API_BASE_URL}/api/marketplace/templates`
      ).then((response) => response.json() as Promise<MarketplaceTemplate[]>);

      setSources(nextSources);
      setTemplates(nextTemplates);
      setGeneratedSubscriptions(nextGeneratedSubscriptions);
      setGeneratedSubscriptionDrafts(nextGeneratedSubscriptionDrafts);
      setMarketplaceRulesets(nextMarketplaceRulesets);
      setMarketplaceTemplates(nextMarketplaceTemplates);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (!auth.session) {
      setSources([]);
      setTemplates([]);
      setGeneratedSubscriptions([]);
      setGeneratedSubscriptionDrafts([]);
      setMarketplaceRulesets([]);
      setMarketplaceTemplates([]);
      return;
    }

    void refreshAll();
  }, [auth.session?.user.id]);

  const value = useMemo<WorkspaceContextValue>(() => {
    return {
      isLoading,
      sources,
      templates,
      generatedSubscriptions,
      generatedSubscriptionDrafts,
      marketplaceRulesets,
      marketplaceTemplates,
      refreshAll,
      getSourceDetail: (id) => auth.authorizedRequest(`/api/upstream-sources/${id}`),
      createSource: async (input) => {
        const created = await auth.authorizedRequest<UpstreamSourceDetail>("/api/upstream-sources", {
          method: "POST",
          body: JSON.stringify(input)
        });
        await refreshAll();
        return created;
      },
      updateSource: async (id, input) => {
        const updated = await auth.authorizedRequest<UpstreamSourceDetail>(
          `/api/upstream-sources/${id}`,
          {
            method: "PATCH",
            body: JSON.stringify(input)
          }
        );
        await refreshAll();
        return updated;
      },
      syncSource: async (id) => {
        const updated = await auth.authorizedRequest<UpstreamSourceDetail>(
          `/api/upstream-sources/${id}/sync`,
          {
            method: "POST"
          }
        );
        await refreshAll();
        return updated;
      },
      deleteSource: async (id) => {
        await auth.authorizedRequest(`/api/upstream-sources/${id}`, {
          method: "DELETE"
        });
        await refreshAll();
      },
      createRuleset: async (input) => {
        const created = await auth.authorizedRequest<MarketplaceRuleset>("/api/rulesets", {
          method: "POST",
          body: JSON.stringify(input)
        });
        await refreshAll();
        return created;
      },
      updateRuleset: async (id, input) => {
        const updated = await auth.authorizedRequest<MarketplaceRuleset>(`/api/rulesets/${id}`, {
          method: "PATCH",
          body: JSON.stringify(input)
        });
        await refreshAll();
        return updated;
      },
      syncRuleset: async (id) => {
        const updated = await auth.authorizedRequest<MarketplaceRuleset>(`/api/rulesets/${id}/sync`, {
          method: "POST"
        });
        await refreshAll();
        return updated;
      },
      deleteRuleset: async (id) => {
        await auth.authorizedRequest(`/api/rulesets/${id}`, {
          method: "DELETE"
        });
        await refreshAll();
      },
      getTemplateDetail: (id) => auth.authorizedRequest(`/api/templates/${id}`),
      createTemplate: async (input) => {
        const created = await auth.authorizedRequest<TemplateDetail>("/api/templates", {
          method: "POST",
          body: JSON.stringify(input)
        });
        await refreshAll();
        return created;
      },
      updateTemplate: async (id, input) => {
        const updated = await auth.authorizedRequest<TemplateDetail>(`/api/templates/${id}`, {
          method: "PATCH",
          body: JSON.stringify(input)
        });
        await refreshAll();
        return updated;
      },
      deleteTemplate: async (id) => {
        await auth.authorizedRequest(`/api/templates/${id}`, {
          method: "DELETE"
        });
        await refreshAll();
      },
      forkTemplate: async (id) => {
        const created = await auth.authorizedRequest<TemplateDetail>(`/api/templates/${id}/fork`, {
          method: "POST"
        });
        await refreshAll();
        return created;
      },
      getGeneratedSubscriptionDetail: (id) => auth.authorizedRequest(`/api/subscriptions/${id}`),
      listGeneratedSubscriptionSnapshots: (id) =>
        auth.authorizedRequest(`/api/subscriptions/${id}/snapshots`),
      compareGeneratedSubscriptionSnapshots: (id, baseSnapshotId, targetSnapshotId) =>
        auth.authorizedRequest(
          `/api/subscriptions/${id}/snapshots/compare?baseSnapshotId=${encodeURIComponent(
            baseSnapshotId
          )}&targetSnapshotId=${encodeURIComponent(targetSnapshotId)}`
        ),
      getGeneratedSubscriptionDraft: (id) =>
        auth.authorizedRequest(`/api/generated-subscription-drafts/${id}`),
      createGeneratedSubscriptionDraft: async (input) => {
        const created = await auth.authorizedRequest<GeneratedSubscriptionDraftDetail>(
          "/api/generated-subscription-drafts",
          {
            method: "POST",
            body: JSON.stringify(input)
          }
        );
        await refreshAll();
        return created;
      },
      updateGeneratedSubscriptionDraft: async (id, input) => {
        const updated = await auth.authorizedRequest<GeneratedSubscriptionDraftDetail>(
          `/api/generated-subscription-drafts/${id}`,
          {
            method: "PATCH",
            body: JSON.stringify(input)
          }
        );
        await refreshAll();
        return updated;
      },
      saveGeneratedSubscriptionDraftStep: async (id, input) => {
        const updated = await auth.authorizedRequest<GeneratedSubscriptionDraftDetail>(
          `/api/generated-subscription-drafts/${id}/steps`,
          {
            method: "POST",
            body: JSON.stringify(input)
          }
        );
        await refreshAll();
        return updated;
      },
      previewGeneratedSubscriptionDraft: async (id) => {
        const preview = await auth.authorizedRequest<GeneratedSubscriptionDraftPreview>(
          `/api/generated-subscription-drafts/${id}/preview`,
          {
            method: "POST"
          }
        );
        await refreshAll();
        return preview;
      },
      publishGeneratedSubscriptionDraft: async (id, input) => {
        const created = await auth.authorizedRequest<GeneratedSubscriptionDetail>(
          `/api/generated-subscription-drafts/${id}/publish`,
          {
            method: "POST",
            body: JSON.stringify(input)
          }
        );
        await refreshAll();
        return created;
      },
      extractTemplateFromDraft: async (id, input) => {
        const created = await auth.authorizedRequest<TemplateDetail>(
          `/api/generated-subscription-drafts/${id}/extract-template`,
          {
            method: "POST",
            body: JSON.stringify(input)
          }
        );
        await refreshAll();
        return created;
      },
      createGeneratedSubscription: async (input) => {
        const created = await auth.authorizedRequest<GeneratedSubscriptionDetail>(
          "/api/subscriptions",
          {
            method: "POST",
            body: JSON.stringify(input)
          }
        );
        await refreshAll();
        return created;
      },
      updateGeneratedSubscription: async (id, input) => {
        const updated = await auth.authorizedRequest<GeneratedSubscriptionDetail>(
          `/api/subscriptions/${id}`,
          {
            method: "PATCH",
            body: JSON.stringify(input)
          }
        );
        await refreshAll();
        return updated;
      },
      deleteGeneratedSubscription: async (id) => {
        await auth.authorizedRequest(`/api/subscriptions/${id}`, {
          method: "DELETE"
        });
        await refreshAll();
      },
      renderGeneratedSubscription: async (id) => {
        const updated = await auth.authorizedRequest<GeneratedSubscriptionDetail>(
          `/api/subscriptions/${id}/render`,
          {
            method: "POST"
          }
        );
        await refreshAll();
        return updated;
      },
      listTempTokens: (id) => auth.authorizedRequest(`/api/subscriptions/${id}/temp-tokens`),
      createTempLink: async (id, expiresInSeconds = 24 * 60 * 60) => {
        const result = await auth.authorizedRequest<{ token: string }>(
          `/api/subscriptions/${id}/temp-token`,
          {
            method: "POST",
            body: JSON.stringify({
              expiresInSeconds
            })
          }
        );

        await refreshAll();
        return `${API_BASE_URL}/subscribe/${id}?token=${result.token}`;
      },
      revokeTempToken: async (id, tokenId) => {
        await auth.authorizedRequest(`/api/subscriptions/${id}/temp-tokens/${tokenId}`, {
          method: "DELETE"
        });
        await refreshAll();
      },
      listShareGrants: (id) => auth.authorizedRequest(`/api/subscriptions/${id}/share-grants`),
      upsertShareGrant: async (id, input) => {
        const created = await auth.authorizedRequest<SubscriptionShareGrant>(
          `/api/subscriptions/${id}/share-grants`,
          {
            method: "POST",
            body: JSON.stringify(input)
          }
        );
        await refreshAll();
        return created;
      },
      revokeShareGrant: async (id, grantId) => {
        await auth.authorizedRequest(`/api/subscriptions/${id}/share-grants/${grantId}`, {
          method: "DELETE"
        });
        await refreshAll();
      },
      rotateSubscriptionSecret: async (id) => {
        const result = await auth.authorizedRequest<{ secret: string }>(
          id ? `/api/subscriptions/${id}/secret/rotate` : "/api/settings/subscription-secret/rotate",
          {
            method: "POST"
          }
        );

        auth.rememberSubscriptionSecret(result.secret);
        return result.secret;
      }
    };
  }, [
    auth,
    generatedSubscriptionDrafts,
    generatedSubscriptions,
    isLoading,
    marketplaceRulesets,
    marketplaceTemplates,
    sources,
    templates
  ]);

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
};

export const useWorkspace = () => {
  const context = useContext(WorkspaceContext);

  if (!context) {
    throw new Error("useWorkspace must be used within WorkspaceProvider.");
  }

  return context;
};
