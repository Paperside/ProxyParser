import { useEffect, useState } from "react";
import yaml from "js-yaml";
import { toast } from "sonner";

import type { CustomNode } from "../../lib/build-config-types";
import { useSecretMutations } from "../../lib/hooks";
import {
  PROTOCOL_SCHEMAS,
  findProtocolSchema,
  type FieldSchema,
  type ProtocolSchema
} from "../../lib/node-protocol-schema.generated";
import { Button } from "../ui/button";
import { Collapsible } from "../ui/collapsible";
import { Dialog, DialogContent, DialogFooter } from "../ui/dialog";
import { Field, Input } from "../ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui/select";
import { Switch } from "../ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../ui/tabs";
import { Textarea } from "../ui/textarea";
import { useWorkspace } from "./context";

// 节点表单只有一张字段清单：用户不用区分「敏感字段」和「其他字段」，
// 敏感/非敏感的拆分与加密都在提交时交给后端（POST /api/secrets/split）。

const CUSTOM_TYPE_SENTINEL = "__custom__";
const EMPTY_ENUM_SENTINEL = "__none__";

type ValuesUpdater = (prev: Record<string, unknown>) => Record<string, unknown>;
type SetValues = (updater: ValuesUpdater) => void;

const isFieldVisible = (field: FieldSchema, values: Record<string, unknown>): boolean => {
  if (!field.visibleWhen) return true;
  return values[field.visibleWhen.field] === field.visibleWhen.equals;
};

const buildDefaultFields = (schema?: ProtocolSchema): Record<string, unknown> => {
  if (!schema) return {};
  const defaults: Record<string, unknown> = {};
  for (const field of schema.fields) {
    if (field.type === "variant") continue;
    if (field.default !== undefined) defaults[field.key] = field.default;
  }
  return defaults;
};

interface ParsedRaw {
  name: string;
  type: string;
  server: string;
  port: string;
  fields: Record<string, unknown>;
}

const parseRawYaml = (text: string): ParsedRaw | null => {
  try {
    const parsed = yaml.load(text);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    const { name, type, server, port, ...rest } = parsed as Record<string, unknown>;
    return {
      name: typeof name === "string" ? name : "",
      type: typeof type === "string" ? type : "",
      server: typeof server === "string" ? server : "",
      port: typeof port === "number" || typeof port === "string" ? String(port) : "",
      fields: rest
    };
  } catch {
    return null;
  }
};

// ── 数组/映射类字段的文本编辑：本地文本状态与父级 value 解耦，避免打字时被反推导的文本覆盖 ──

const StringListField = ({
  value,
  onChange,
  placeholder
}: {
  value: unknown;
  onChange: (v: string[]) => void;
  placeholder?: string;
}) => {
  const [text, setText] = useState(() => (Array.isArray(value) ? value.map(String).join(", ") : ""));
  return (
    <Input
      value={text}
      placeholder={placeholder}
      onChange={(e) => {
        setText(e.target.value);
        onChange(
          e.target.value
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean)
        );
      }}
    />
  );
};

const StringMapField = ({ value, onChange }: { value: unknown; onChange: (v: Record<string, string>) => void }) => {
  const [text, setText] = useState(() =>
    value && typeof value === "object"
      ? Object.entries(value as Record<string, unknown>)
          .map(([k, v]) => `${k}: ${v}`)
          .join("\n")
      : ""
  );
  return (
    <Textarea
      value={text}
      className="min-h-16"
      placeholder={"Header-Name: value"}
      onChange={(e) => {
        setText(e.target.value);
        const result: Record<string, string> = {};
        for (const line of e.target.value.split("\n")) {
          const idx = line.indexOf(":");
          if (idx === -1) continue;
          const key = line.slice(0, idx).trim();
          if (key) result[key] = line.slice(idx + 1).trim();
        }
        onChange(result);
      }}
    />
  );
};

const ObjectListYamlField = ({
  value,
  onChange,
  hint
}: {
  value: unknown;
  onChange: (v: unknown) => void;
  hint?: string;
}) => {
  const [text, setText] = useState(() => {
    try {
      return Array.isArray(value) && value.length > 0 ? yaml.dump(value).trimEnd() : "";
    } catch {
      return "";
    }
  });
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="flex flex-col gap-1">
      <Textarea
        value={text}
        className="min-h-28"
        placeholder={'- server: 1.2.3.4\n  port: 51820\n  public-key: "..."\n  allowed-ips: ["0.0.0.0/0"]'}
        onChange={(e) => {
          const next = e.target.value;
          setText(next);
          if (next.trim() === "") {
            setError(null);
            onChange(undefined);
            return;
          }
          try {
            const parsed = yaml.load(next);
            if (!Array.isArray(parsed)) throw new Error("需要是数组");
            setError(null);
            onChange(parsed);
          } catch {
            setError("YAML 格式不合法，未保存该项改动");
          }
        }}
      />
      {error ? <span className="text-[11px] text-err">{error}</span> : hint ? <span className="text-[11px] text-faint">{hint}</span> : null}
    </div>
  );
};

// ── 按 tier 分组渲染：common 直接展示，advanced 收进折叠区 ──────

const FieldGroup = ({
  fields,
  values,
  setValues
}: {
  fields: FieldSchema[];
  values: Record<string, unknown>;
  setValues: SetValues;
}) => {
  const visible = fields.filter((f) => isFieldVisible(f, values));
  const common = visible.filter((f) => f.tier === "common");
  const advanced = visible.filter((f) => f.tier === "advanced");
  return (
    <div className="flex flex-col gap-3">
      {common.length > 0 ? (
        <div className="grid grid-cols-2 gap-3">
          {common.map((f) => (
            <FieldControl key={f.key} field={f} values={values} setValues={setValues} />
          ))}
        </div>
      ) : null}
      {advanced.length > 0 ? (
        <Collapsible title="高级配置" hint={`${advanced.length} 项`}>
          <div className="grid grid-cols-2 gap-3">
            {advanced.map((f) => (
              <FieldControl key={f.key} field={f} values={values} setValues={setValues} />
            ))}
          </div>
        </Collapsible>
      ) : null}
    </div>
  );
};

const VariantFieldControl = ({
  field,
  values,
  setValues
}: {
  field: FieldSchema;
  values: Record<string, unknown>;
  setValues: SetValues;
}) => {
  const variants = field.variants ?? [];
  const detect = () =>
    variants.find((v) => v.fields.some((f) => values[f.key] !== undefined && values[f.key] !== ""))?.value ??
    variants[0]?.value ??
    "";
  const [selected, setSelected] = useState(detect);
  const active = variants.find((v) => v.value === selected) ?? variants[0];

  const handleSelect = (next: string) => {
    setSelected(next);
    setValues((prev) => {
      const copy = { ...prev };
      for (const variant of variants) {
        if (variant.value === next) continue;
        for (const f of variant.fields) delete copy[f.key];
      }
      return copy;
    });
  };

  return (
    <div className="col-span-2 flex flex-col gap-3">
      <Field label={field.label}>
        <Select value={selected} onValueChange={handleSelect}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {variants.map((v) => (
              <SelectItem key={v.value} value={v.value}>
                {v.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
      <div className="grid grid-cols-2 gap-3">
        {(active?.fields ?? []).map((f) => (
          <FieldControl key={f.key} field={f} values={values} setValues={setValues} />
        ))}
      </div>
    </div>
  );
};

const FieldControl = ({
  field,
  values,
  setValues
}: {
  field: FieldSchema;
  values: Record<string, unknown>;
  setValues: SetValues;
}) => {
  const value = values[field.key];
  const onChange = (v: unknown) => setValues((prev) => ({ ...prev, [field.key]: v }));
  const label = field.label + (field.required ? " *" : "");

  switch (field.type) {
    case "string":
      return (
        <Field label={label} hint={field.hint}>
          <Input
            value={typeof value === "string" ? value : ""}
            placeholder={field.placeholder}
            onChange={(e) => onChange(e.target.value)}
          />
        </Field>
      );
    case "number":
      return (
        <Field label={label} hint={field.hint}>
          <Input
            type="number"
            value={typeof value === "number" ? String(value) : typeof value === "string" ? value : ""}
            placeholder={field.placeholder}
            onChange={(e) => onChange(e.target.value === "" ? undefined : Number(e.target.value))}
          />
        </Field>
      );
    case "boolean":
      return (
        <div className="flex items-center justify-between gap-2 rounded-md border border-line px-2.5 py-1.5">
          <span className="text-xs text-muted">{label}</span>
          <Switch checked={Boolean(value)} onCheckedChange={onChange} />
        </div>
      );
    case "enum": {
      const options = field.enumOptions ?? [];
      const hasEmptyOption = options.some((o) => o.value === "");
      const currentValue = typeof value === "string" ? value : "";
      const selectValue =
        currentValue === "" ? (hasEmptyOption ? EMPTY_ENUM_SENTINEL : undefined) : currentValue;
      return (
        <Field label={label} hint={field.hint}>
          <Select
            value={selectValue}
            onValueChange={(v) => onChange(v === EMPTY_ENUM_SENTINEL ? "" : v)}
          >
            <SelectTrigger>
              <SelectValue placeholder="选择…" />
            </SelectTrigger>
            <SelectContent>
              {options.map((opt) => (
                <SelectItem key={opt.value || EMPTY_ENUM_SENTINEL} value={opt.value === "" ? EMPTY_ENUM_SENTINEL : opt.value}>
                  {opt.label ?? opt.value}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
      );
    }
    case "stringList":
      return (
        <Field label={label} hint={field.hint ?? "逗号分隔"}>
          <StringListField value={value} onChange={onChange} placeholder={field.placeholder} />
        </Field>
      );
    case "stringMap":
      return (
        <div className="col-span-2">
          <Field label={label} hint={field.hint ?? "每行一个，格式 key: value"}>
            <StringMapField value={value} onChange={onChange} />
          </Field>
        </div>
      );
    case "objectList":
      return (
        <div className="col-span-2">
          <Field label={label}>
            <ObjectListYamlField value={value} onChange={onChange} hint={field.hint} />
          </Field>
        </div>
      );
    case "object": {
      const nested = (value as Record<string, unknown>) ?? {};
      const nestedSetValues: SetValues = (updater) =>
        setValues((prev) => ({
          ...prev,
          [field.key]: updater((prev[field.key] as Record<string, unknown>) ?? {})
        }));
      return (
        <div className="col-span-2 rounded-md border border-line p-3">
          <div className="mb-2 text-xs font-medium text-muted">{field.label}</div>
          {field.hint ? <p className="mb-2 text-[11px] text-faint">{field.hint}</p> : null}
          <FieldGroup fields={field.fields ?? []} values={nested} setValues={nestedSetValues} />
        </div>
      );
    }
    case "variant":
      return <VariantFieldControl field={field} values={values} setValues={setValues} />;
    default:
      return null;
  }
};

// ── 主弹窗：新增 / 编辑复用同一组件 ──────────────────────────

export const CustomNodeDialog = ({ node, onClose }: { node?: CustomNode; onClose: () => void }) => {
  const { update } = useWorkspace();
  const secrets = useSecretMutations();

  const [name, setName] = useState(node?.name ?? "");
  const [type, setType] = useState(node?.type ?? "trojan");
  const [server, setServer] = useState(node?.server ?? "");
  const [port, setPort] = useState(node ? String(node.port) : "443");
  const [fields, setFields] = useState<Record<string, unknown>>(() =>
    node ? { ...node.extra } : buildDefaultFields(findProtocolSchema(type))
  );
  const [mode, setMode] = useState<"basic" | "advanced">("basic");
  const [rawYaml, setRawYaml] = useState("");
  const [loadingSecret, setLoadingSecret] = useState(Boolean(node?.secretRef));

  useEffect(() => {
    if (!node?.secretRef) return;
    secrets.resolve
      .mutateAsync(node.secretRef)
      .then((res) => setFields((prev) => ({ ...prev, ...res.fields })))
      .catch(() => toast.error("敏感字段解密失败，可在高级模式里重新填写"))
      .finally(() => setLoadingSecret(false));
    // 仅在弹窗打开时拉取一次
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const schema = findProtocolSchema(type);
  const isKnownType = Boolean(schema);

  const handleTypeSelect = (nextValue: string) => {
    const nextType = nextValue === CUSTOM_TYPE_SENTINEL ? "" : nextValue;
    if (nextType === type) return;
    setType(nextType);
    if (!node) {
      setFields(buildDefaultFields(findProtocolSchema(nextType)));
    }
  };

  const buildYamlPayload = () => {
    const portNum = Number(port);
    return {
      name,
      type,
      server,
      port: port.trim() !== "" && Number.isFinite(portNum) ? portNum : port,
      ...fields
    };
  };

  const handleModeChange = (next: string) => {
    if (next === mode) return;
    if (next === "advanced") {
      setRawYaml(yaml.dump(buildYamlPayload()));
      setMode("advanced");
      return;
    }
    const parsed = parseRawYaml(rawYaml);
    if (!parsed) {
      toast.error("YAML 格式不合法，请修正后再切换回基础模式");
      return;
    }
    setName(parsed.name);
    setType(parsed.type);
    setServer(parsed.server);
    setPort(parsed.port);
    setFields(parsed.fields);
    setMode("basic");
  };

  const submit = async () => {
    let finalName = name;
    let finalType = type;
    let finalServer = server;
    let finalPort = port;
    let finalFields = fields;

    if (mode === "advanced") {
      const parsed = parseRawYaml(rawYaml);
      if (!parsed) {
        toast.error("YAML 格式不合法");
        return;
      }
      finalName = parsed.name;
      finalType = parsed.type;
      finalServer = parsed.server;
      finalPort = parsed.port;
      finalFields = parsed.fields;
    }

    const portNum = Number(finalPort);
    if (!finalName.trim() || !finalType.trim() || !finalServer.trim() || !Number.isInteger(portNum)) {
      toast.error("请填写名称、协议、服务器与端口");
      return;
    }

    try {
      const result = await secrets.split.mutateAsync({
        type: finalType,
        fields: finalFields,
        secretRef: node?.secretRef ?? null
      });
      update((draft) => {
        const existing = node ? draft.nodes.custom.find((n) => n.id === node.id) : undefined;
        if (existing) {
          existing.name = finalName;
          existing.type = finalType;
          existing.server = finalServer;
          existing.port = portNum;
          existing.secretRef = result.secretRef;
          existing.extra = result.extra;
        } else {
          draft.nodes.custom.push({
            id: `cn_${crypto.randomUUID().replaceAll("-", "").slice(0, 16)}`,
            name: finalName,
            type: finalType,
            server: finalServer,
            port: portNum,
            secretRef: result.secretRef,
            extra: result.extra
          });
        }
      });
      toast.success(node ? "节点已更新" : "自建节点已加入草稿");
      onClose();
    } catch {
      toast.error("保存失败，请检查字段");
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        wide
        title={node ? `编辑节点：${node.name}` : "新增自建节点"}
        description="敏感字段（密码 / UUID / 私钥等）会自动加密单独存储，不出现在模板与分享中——你只需要专注填好这一张表单。"
      >
        <div className="grid grid-cols-2 gap-3.5">
          <Field label="名称">
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Home VPS" />
          </Field>
          <Field label="协议">
            <div className="flex flex-col gap-1.5">
              <Select value={isKnownType ? type : CUSTOM_TYPE_SENTINEL} onValueChange={handleTypeSelect}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PROTOCOL_SCHEMAS.map((s) => (
                    <SelectItem key={s.type} value={s.type} description={s.type}>
                      {s.label}
                    </SelectItem>
                  ))}
                  <SelectItem value={CUSTOM_TYPE_SENTINEL}>自定义协议…</SelectItem>
                </SelectContent>
              </Select>
              {!isKnownType ? (
                <Input value={type} onChange={(e) => setType(e.target.value)} placeholder="协议名，如 mieru" />
              ) : null}
            </div>
          </Field>
          <Field label="服务器">
            <Input value={server} onChange={(e) => setServer(e.target.value)} placeholder="example.com" />
          </Field>
          <Field label="端口">
            <Input value={port} onChange={(e) => setPort(e.target.value)} />
          </Field>
        </div>

        {loadingSecret ? <p className="mt-2 text-xs text-faint">正在解密敏感字段…</p> : null}

        <Tabs value={mode} onValueChange={handleModeChange} className="mt-3.5 block">
          <TabsList>
            <TabsTrigger value="basic">基础模式</TabsTrigger>
            <TabsTrigger value="advanced">高级模式（RAW）</TabsTrigger>
          </TabsList>
          <TabsContent value="basic" className="mt-3 block">
            {isKnownType && schema ? (
              <FieldGroup fields={schema.fields} values={fields} setValues={setFields} />
            ) : (
              <p className="text-xs text-faint">
                该协议未内置字段模板，请切到「高级模式」直接写完整配置（与 mihomo proxies 下的一项写法一致）。
              </p>
            )}
          </TabsContent>
          <TabsContent value="advanced" className="mt-3 block">
            <Field label="节点配置（YAML）" hint="与 mihomo 配置里 proxies 下的一项写法一致，可直接粘贴现成节点配置">
              <Textarea value={rawYaml} onChange={(e) => setRawYaml(e.target.value)} className="min-h-64" />
            </Field>
          </TabsContent>
        </Tabs>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            取消
          </Button>
          <Button variant="primary" onClick={() => void submit()}>
            {node ? "保存修改" : "加入草稿"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
