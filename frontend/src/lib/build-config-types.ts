// ⚠️ 生成自 backend/src/lib/build-config/types.ts —— 勿手改，改动后运行 bun run sync-types。


export type BuildMode = "rebuild" | "patch";

export const BUILTIN_POLICIES = ["DIRECT", "REJECT", "REJECT-DROP", "PASS", "COMPATIBLE"] as const;
export type BuiltinPolicy = (typeof BUILTIN_POLICIES)[number];

export interface BuildConfig {
  version: 1;
  mode: BuildMode;
  sources: SourceRef[];
  nodes: NodesSection;
  groups: GroupsSection;
  rules: RulesSection;
  config: ConfigSection;
}

export interface SourceRef {
  sourceId: string;
  enabled: boolean;
}

// ── 节点 ─────────────────────────────────────────────────────

export interface NodesSection {
  transforms: NodeTransform[];
  overrides: NodeOverride[];
  custom: CustomNode[];
}

export type NodeTransform =
  | { kind: "strip-emoji" }
  | { kind: "strip-multiplier" }
  | { kind: "trim-whitespace" }
  | { kind: "regex-replace"; from: string; to: string; flags?: string };

export interface NodeOverride {
  nodeId: string;
  rename?: string;
  disabled?: boolean;
  tags?: string[];
}

export interface CustomNode {
  id: string; // cn_ 前缀，创建时生成
  name: string;
  type: string;
  server: string;
  port: number;
  secretRef: string | null; // custom_node_secrets.id；敏感字段不入 BuildConfig
  extra: Record<string, unknown>;
  tags?: string[];
}

// ── 代理组 ────────────────────────────────────────────────────

export interface GroupsSection {
  generators: GroupGenerator[];
  custom: CustomGroup[];
  order: string[]; // 输出顺序：生成器产物名与自定义组名混排；未列出的按生成顺序追加
}

export type GroupGenerator =
  | {
      kind: "proxies-root";
      name: string;
      includeAuto: boolean;
      extraMembers: GroupMember[];
    }
  | {
      kind: "region-groups";
      groupType: "select" | "url-test";
      unclassified: "others" | "ignore";
      regionOverrides?: Record<string, string>; // nodeId -> region code
    }
  | {
      kind: "auto-group";
      name: string;
      selector: NodeSelector;
    };

export interface CustomGroup {
  name: string;
  type: "select" | "url-test" | "fallback" | "load-balance";
  members: GroupMember[];
  options?: Record<string, unknown>;
}

export type GroupMember =
  | { kind: "node"; nodeId: string }
  | { kind: "group"; name: string }
  | { kind: "selector"; selector: NodeSelector }
  | { kind: "builtin"; policy: BuiltinPolicy };

export type NodeSelector =
  | { kind: "all-enabled" }
  | { kind: "region"; region: string }
  | { kind: "tag"; tag: string }
  | { kind: "protocol"; protocol: string }
  | { kind: "custom-only" };

// ── 规则 ─────────────────────────────────────────────────────

export interface RulesSection {
  targets: RuleTargetBlock[];
  order: string[]; // 块级输出顺序（target 名列表）
  prelude: PreludeRule[]; // 前置规则（恒在所有块之前），必须自带目标
  final: { target: string }; // MATCH 落点
}

export interface PreludeRule extends RuleEntry {
  target: string;
}

export interface RuleTargetBlock {
  target: string; // 已知组名或 BuiltinPolicy
  items: RuleItem[];
}

export type RuleItem =
  | { kind: "snapshot"; catalogId: string; slug: string; hash: string; emit: "provider" | "inline" }
  | { kind: "manual"; entries: RuleEntry[] };

export interface RuleEntry {
  type: RuleType;
  value: string;
  extra?: string; // 例如 no-resolve
}

export const RULE_TYPES = [
  "DOMAIN",
  "DOMAIN-SUFFIX",
  "DOMAIN-KEYWORD",
  "IP-CIDR",
  "IP-CIDR6",
  "GEOIP",
  "GEOSITE",
  "PROCESS-NAME",
  "SRC-IP-CIDR",
  "DST-PORT"
] as const;
export type RuleType = (typeof RULE_TYPES)[number];

// ── 配置 ─────────────────────────────────────────────────────

export interface ConfigSection {
  structured: StructuredConfig;
  rawPatch: string | null; // YAML 文本，深合并于 structured 之上
}

export interface StructuredConfig {
  ports?: { mixedPort?: number; port?: number; socksPort?: number };
  mode?: "rule" | "global" | "direct";
  logLevel?: "silent" | "error" | "warning" | "info" | "debug";
  ipv6?: boolean;
  dns?: Record<string, unknown>;
  tun?: Record<string, unknown>;
  sniffer?: Record<string, unknown>;
}

// ── 模板 ─────────────────────────────────────────────────────

// TemplatePayloadV2 = 源无关 BuildConfig：无 sources，
// 无原生节点 ID 成员，自建节点 secretRef 变为占位符。
export interface TemplatePayloadV2 {
  version: 1;
  mode: "rebuild";
  nodes: {
    transforms: NodeTransform[];
    custom: TemplateCustomNode[];
  };
  groups: GroupsSection;
  rules: RulesSection;
  config: ConfigSection;
}

export interface TemplateCustomNode extends Omit<CustomNode, "secretRef"> {
  secretPlaceholder: boolean; // 应用模板时要求补全敏感字段
}

export interface TemplateExtractionReport {
  recorded: string[];
  dropped: Array<{ reason: string; detail: string }>;
}
