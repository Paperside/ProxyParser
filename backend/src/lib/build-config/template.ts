import type {
  BuildConfig,
  CustomGroup,
  GroupMember,
  TemplateCustomNode,
  TemplateExtractionReport,
  TemplatePayloadV2
} from "./types";

// 模板 v2（技术方案 §13）：TemplatePayloadV2 = 源无关 BuildConfig。
// 提炼 = 字段过滤 + 报告；应用 = 回填 sources 与占位符。
// 往返收敛：extract(instantiate(extract(x))) === extract(x)（测试锁定）。

const isNativeNodeRef = (member: GroupMember): boolean =>
  member.kind === "node" && member.nodeId.startsWith("n_");

export const extractTemplate = (
  config: BuildConfig,
  options: { retainSensitive?: boolean } = {}
): { payload: TemplatePayloadV2; report: TemplateExtractionReport } | { error: string } => {
  if (config.mode !== "rebuild") {
    return { error: "保留源配置（patch）模式与源订阅绑定，不能提炼为通用模板。请使用重组模式。" };
  }

  const report: TemplateExtractionReport = { recorded: [], dropped: [] };

  // 自建节点：敏感字段变为占位符
  const custom: TemplateCustomNode[] = config.nodes.custom.map((node) => {
    const { secretRef, ...rest } = node;
    if (secretRef && !options.retainSensitive) {
      report.dropped.push({
        reason: "secret-placeholder",
        detail: `自建节点「${node.name}」的敏感字段不进入模板，应用时需补全。`
      });
    }
    if (secretRef && options.retainSensitive) {
      report.recorded.push(`自建节点「${node.name}」的敏感字段将以加密密文随模板版本保存。`);
    }
    return {
      ...rest,
      secretPlaceholder: Boolean(secretRef) && !options.retainSensitive,
      ...(secretRef && options.retainSensitive ? { embeddedSecret: true } : {})
    };
  });
  if (custom.length > 0) {
    report.recorded.push(
      `${custom.length} 个自建节点（${options.retainSensitive ? "选择保留的敏感字段使用独立密文" : "敏感字段为占位符"}）`
    );
  }

  // overrides 绑定原生节点稳定 ID，源无关模板无法携带
  if (config.nodes.overrides.length > 0) {
    report.dropped.push({
      reason: "native-overrides",
      detail: `${config.nodes.overrides.length} 条针对原生节点的改名/禁用/标签不进入模板（换源后节点不同）。`
    });
  }
  if (config.nodes.transforms.length > 0) {
    report.recorded.push(`${config.nodes.transforms.length} 条持续名称转换`);
  }

  // 代理组：原生节点 ID 成员剔除；抽象集合、自建节点、组引用、内置目标保留
  const groups: CustomGroup[] = config.groups.custom.map((group) => {
    const kept = group.members.filter((member) => !isNativeNodeRef(member));
    const droppedCount = group.members.length - kept.length;
    if (droppedCount > 0) {
      report.dropped.push({
        reason: "native-node-member",
        detail: `代理组「${group.name}」中 ${droppedCount} 个原生节点成员无法进入通用模板，已移除。`
      });
    }
    return { ...group, members: kept };
  });
  report.recorded.push(
    `${config.groups.generators.length} 个组生成器、${groups.length} 个自定义代理组`
  );

  const snapshotCount = config.rules.targets.reduce(
    (count, block) => count + block.items.filter((item) => item.kind === "snapshot").length,
    0
  );
  report.recorded.push(
    `${config.rules.targets.length} 个规则目标块（${snapshotCount} 个钉版本规则快照）`
  );
  report.recorded.push("DNS / TUN / Sniffer 等配置覆盖");

  const payload: TemplatePayloadV2 = {
    version: 1,
    mode: "rebuild",
    nodes: {
      transforms: structuredClone(config.nodes.transforms),
      custom
    },
    groups: {
      generators: structuredClone(config.groups.generators),
      custom: groups,
      order: [...config.groups.order]
    },
    rules: structuredClone(config.rules),
    config: structuredClone(config.config)
  };

  return { payload, report };
};

export const instantiateTemplate = (
  payload: TemplatePayloadV2,
  sourceIds: string[],
  secretRefs: Map<string, string> = new Map()
): BuildConfig => {
  return {
    version: 1,
    mode: "rebuild",
    sources: sourceIds.map((sourceId) => ({ sourceId, enabled: true })),
    nodes: {
      transforms: structuredClone(payload.nodes.transforms),
      overrides: [],
      // 占位符节点带回；secretRef 置空，用户需在节点页补全敏感字段
      custom: payload.nodes.custom.map(({ secretPlaceholder: _placeholder, embeddedSecret: _embedded, ...node }) => ({
        ...structuredClone(node),
        secretRef: secretRefs.get(node.id) ?? null
      }))
    },
    groups: structuredClone(payload.groups),
    rules: structuredClone(payload.rules),
    config: structuredClone(payload.config)
  };
};
