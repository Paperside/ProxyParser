import yaml from "js-yaml";

// 规则源内容规范化：任何入库的规则快照都统一为 payload YAML（技术方案 §8）。
// 支持两种输入：payload YAML（Loyalsoldier/MetaCubeX 格式）与纯文本行列表。

export interface NormalizedRuleset {
  content: string; // 规范化 payload YAML
  entryCount: number;
}

const dumpPayload = (payload: string[]): NormalizedRuleset => ({
  content: yaml.dump({ payload }, { noRefs: true, lineWidth: -1, sortKeys: false }),
  entryCount: payload.length
});

export const normalizeRulesetContent = (text: string): NormalizedRuleset => {
  // 优先按 payload YAML 解析
  try {
    const parsed = yaml.load(text);
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      Array.isArray((parsed as Record<string, unknown>).payload)
    ) {
      const payload = ((parsed as Record<string, unknown>).payload as unknown[])
        .map((entry) => String(entry).trim())
        .filter((entry) => entry.length > 0);
      return dumpPayload(payload);
    }
  } catch {
    // 继续按纯文本行处理
  }

  const payload = text
    .split("\n")
    .map((line) => line.trim())
    .filter(
      (line) =>
        line.length > 0 &&
        !line.startsWith("#") &&
        !line.startsWith("USER-AGENT") &&
        !line.startsWith("URL-REGEX")
    );

  if (payload.length === 0) {
    throw new Error("内容为空或无法识别为规则列表。");
  }

  return dumpPayload(payload);
};
