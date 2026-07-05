// 自建节点字段拆分：把用户在表单/RAW 中填写的完整字段对象，
// 拆成「secretFields（进 custom_node_secrets 加密存储）」与「extra（明文进 BuildConfig）」。
// 调用方需先剔除 name/type/server/port（这三者由 CustomNode 顶层字段承载，不参与拆分）。

import { findProtocolSchema, type FieldSchema, type ProtocolSchema } from "./protocol-schema";

// 未知协议（或已知协议里 schema 未覆盖到的字段）的兜底判定：
// 保证任何看起来像凭据的字段都不会明文落库。
const FALLBACK_SENSITIVE_PATTERN =
  /password|uuid|psk|token|private-?key|pre-shared-key|^auth$|^auth-str$|^obfs$|obfs-password|encryption|secret/i;

// 记录 schema 里每个顶层 key 的敏感性（包括显式声明为非敏感的），
// 这样已知字段严格按 schema 判定，只有 schema 完全没提到的字段才走正则兜底。
const collectTopLevelKeys = (schema: ProtocolSchema): Map<string, boolean> => {
  const keys = new Map<string, boolean>();
  const visit = (field: FieldSchema) => {
    if (field.type === "variant") {
      for (const variant of field.variants ?? []) {
        for (const nested of variant.fields) visit(nested);
      }
      return;
    }
    keys.set(field.key, Boolean(field.sensitive));
  };
  for (const field of schema.fields) visit(field);
  return keys;
};

export interface SplitFieldsResult {
  secretFields: Record<string, unknown>;
  extra: Record<string, unknown>;
}

export const splitFields = (type: string, fields: Record<string, unknown>): SplitFieldsResult => {
  const schema = findProtocolSchema(type);
  const knownKeys = schema ? collectTopLevelKeys(schema) : null;

  const secretFields: Record<string, unknown> = {};
  const extra: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(fields)) {
    const sensitive = knownKeys?.has(key) ? knownKeys.get(key)! : FALLBACK_SENSITIVE_PATTERN.test(key);
    if (sensitive) secretFields[key] = value;
    else extra[key] = value;
  }

  return { secretFields, extra };
};
