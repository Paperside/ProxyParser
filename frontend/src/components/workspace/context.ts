import { createContext, useContext } from "react";

import type { BuildConfig } from "../../lib/build-config-types";
import { regionCodesForScope } from "../../lib/regions";
import type {
  SubscriptionDetail,
  SyncLatestRulesetsResult,
  WorkspaceIndexResult
} from "../../lib/types";

// 订阅工作台上下文：
// config 是当前编辑中的 BuildConfig（草稿 ?? 已发布），
// update() 以不可变方式修改并触发防抖保存草稿；workspaceIndex 是不展开规则正文的轻量索引。

export interface WorkspaceContextValue {
  detail: SubscriptionDetail;
  config: BuildConfig;
  update: (mutator: (draft: BuildConfig) => void) => boolean;
  editingLocked: boolean;
  saving: boolean;
  syncingRulesets: boolean;
  discardingDraft: boolean;
  draftRevision: number;
  syncLatestRulesets: () => Promise<SyncLatestRulesetsResult>;
  workspaceIndex: WorkspaceIndexResult | null;
  workspaceIndexLoading: boolean;
  knownGroupNames: string[]; // 生成器产物 + 自定义组（规则目标/成员选择用）
}

export const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);

export const useWorkspace = () => {
  const context = useContext(WorkspaceContext);
  if (!context) {
    throw new Error("useWorkspace must be used within workspace page.");
  }
  return context;
};

export const BUILTIN_POLICY_OPTIONS = [
  { value: "DIRECT", label: "DIRECT", desc: "直连，不走代理" },
  { value: "REJECT", label: "REJECT", desc: "拒绝连接" },
  { value: "REJECT-DROP", label: "REJECT-DROP", desc: "静默丢弃" },
  { value: "PASS", label: "PASS", desc: "跳过本规则集" },
  { value: "COMPATIBLE", label: "COMPATIBLE", desc: "兼容占位" }
] as const;

// 从 BuildConfig 推导会存在的组名（不含地区组——它们取决于节点）
export const deriveGroupNames = (config: BuildConfig): string[] => {
  const names: string[] = [];
  for (const generator of config.groups.generators) {
    if (generator.kind === "proxies-root") {
      names.push(generator.name);
      if (generator.includeAuto) names.push("Auto");
    }
    if (generator.kind === "auto-group") names.push(generator.name);
    if (generator.kind === "region-groups") {
      // scope 缺省是历史配置，与渲染管线一样按 full 兼容。
      names.push(...regionCodesForScope(generator.scope ?? "full"), "Others");
    }
  }
  for (const group of config.groups.custom) {
    names.push(group.name);
  }
  return [...new Set(names)];
};
