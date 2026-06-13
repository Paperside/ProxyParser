import { Link, useNavigate, useParams } from "@tanstack/react-router";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Copy,
  Eye,
  EyeOff,
  Plus,
  RefreshCw,
  Save,
  Sparkles,
  Trash2
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Card } from "../components/ui/card";
import { Input } from "../components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "../components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../components/ui/tabs";
import { Textarea } from "../components/ui/textarea";
import { copyText } from "../lib/clipboard";
import { cn } from "../lib/cn";
import { formatTime, shareModeText, visibilityText } from "../lib/format";
import type {
  AutoGroupOptions,
  GeneratedSubscriptionDetail,
  GeneratedSubscriptionDraftCurrentStep,
  GeneratedSubscriptionDraftDetail,
  GeneratedSubscriptionDraftPreview,
  GeneratedSubscriptionDraftStep,
  MarketplaceRuleset,
  RuleProviderAttachment,
  ShareMode,
  UpstreamSourceDetail,
  Visibility
} from "../lib/types";
import { useWorkspace } from "../providers/workspace-provider";

type StepKey = GeneratedSubscriptionDraftCurrentStep;
type PatchMode = "patch" | "full_override";
type EditorMode = "visual" | "raw";

interface VisualProxyOperation {
  id: string;
  type: "add" | "replace" | "remove";
  targetName?: string;
  rawText: string;
}

interface VisualGroupOperation {
  id: string;
  type: "add" | "replace" | "remove";
  targetName?: string;
  rawText: string;
}

interface SettingPair {
  id: string;
  key: string;
  valueText: string;
}

interface FormRecordItem {
  id: string;
  rawText: string;
}

interface FormFieldDefinition {
  key: string;
  label: string;
  type: "text" | "number" | "boolean" | "select" | "textarea";
  placeholder?: string;
  options?: string[];
}

const stepItems: Array<{ key: StepKey; label: string; short: string }> = [
  { key: "source", label: "选择外部订阅", short: "1" },
  { key: "proxies", label: "编辑节点", short: "2" },
  { key: "groups_rules", label: "代理组与规则", short: "3" },
  { key: "settings", label: "其他设置", short: "4" },
  { key: "preview", label: "预览并发布", short: "5" }
];

const shareabilityTone = {
  unknown: "border-[#dedcd1] bg-[#f5f4ed] text-[#5f5e58]",
  shareable: "border-[#7ab948]/40 bg-[#e9f1dc] text-[#265b19]",
  source_locked: "border-[#d1a041]/40 bg-[#f6eedf] text-[#5a4815]"
} as const;

const shareabilityText = {
  unknown: "尚未判定",
  shareable: "可沉淀为通用模板",
  source_locked: "已锁定到当前订阅"
} as const;

const defaultProxyDraft = () => ({
  name: "",
  type: "ss",
  server: "",
  port: 443,
  cipher: "",
  password: ""
});

const defaultGroupDraft = () => ({
  name: "",
  type: "select",
  proxies: ["DIRECT"]
});

const defaultAutoGroupOptions = (): AutoGroupOptions => ({
  enabled: true,
  includeAutoGroup: true,
  unclassifiedPolicy: "others"
});

const defaultSettingForm = () => ({
  "mixed-port": "",
  port: "",
  "socks-port": "",
  mode: "",
  "log-level": "",
  "allow-lan": "",
  ipv6: "",
  "external-controller": ""
});

const prettyJson = (value: unknown) => JSON.stringify(value ?? {}, null, 2);

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === "object" && value !== null;
};

const linesToArray = (value: string) => {
  return value
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
};

const getDraftStep = (
  draft: GeneratedSubscriptionDraftDetail | null,
  stepKey: GeneratedSubscriptionDraftStep["stepKey"]
) => {
  return draft?.steps.find((step) => step.stepKey === stepKey) ?? null;
};

const parseJsonText = <T,>(value: string, label: string): T => {
  try {
    return JSON.parse(value) as T;
  } catch {
    throw new Error(`${label} 不是合法的 JSON。`);
  }
};

const parseObjectText = (value: string, label: string) => {
  const parsed = parseJsonText<unknown>(value, label);

  if (!isRecord(parsed)) {
    throw new Error(`${label} 必须是 JSON 对象。`);
  }

  return parsed;
};

const parseArrayText = (value: string, label: string) => {
  const parsed = parseJsonText<unknown>(value, label);

  if (!Array.isArray(parsed)) {
    throw new Error(`${label} 必须是 JSON 数组。`);
  }

  return parsed;
};

const tryParseObjectText = (value: string) => {
  try {
    const parsed = JSON.parse(value) as unknown;
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
};

const parseScalar = (value: string): unknown => {
  const trimmed = value.trim();

  if (!trimmed) {
    return undefined;
  }

  if (trimmed === "true") {
    return true;
  }

  if (trimmed === "false") {
    return false;
  }

  if (/^-?\d+(\.\d+)?$/.test(trimmed)) {
    return Number(trimmed);
  }

  return trimmed;
};

const describeObjectEntries = (value: Record<string, unknown>) => {
  return Object.entries(value).filter(([key]) => !key.startsWith("_"));
};

const sensitiveFieldPattern = /(password|passwd|secret|token|uuid|private-key|public-key|server|host|sni)/i;

const formatObjectEntryValue = (key: string, value: unknown) => {
  if (sensitiveFieldPattern.test(key)) {
    return "已隐藏";
  }

  return typeof value === "string" ? value : JSON.stringify(value);
};

const buildId = (prefix: string) => {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `${prefix}-${crypto.randomUUID()}`;
  }

  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
};

const commonSettingKeys = new Set([
  "mixed-port",
  "port",
  "socks-port",
  "mode",
  "log-level",
  "allow-lan",
  "ipv6",
  "external-controller"
]);

const createFormRecordItems = (prefix: string, items: unknown[]): FormRecordItem[] => {
  return items.flatMap<FormRecordItem>((item) =>
    isRecord(item)
      ? [
          {
            id: buildId(prefix),
            rawText: prettyJson(item)
          }
        ]
      : []
  );
};

const buildSettingsVisualState = (value: Record<string, unknown>) => {
  const nextSettingsForm = defaultSettingForm();
  const nextPairs: SettingPair[] = [];

  for (const [key, currentValue] of Object.entries(value)) {
    if (commonSettingKeys.has(key)) {
      nextSettingsForm[key as keyof typeof nextSettingsForm] =
        typeof currentValue === "string" ? currentValue : JSON.stringify(currentValue);
      continue;
    }

    nextPairs.push({
      id: buildId("setting"),
      key,
      valueText: typeof currentValue === "string" ? currentValue : prettyJson(currentValue)
    });
  }

  return {
    settingsForm: nextSettingsForm,
    settingPairs: nextPairs
  };
};

const buildSettingsConfigFromVisualState = (
  form: ReturnType<typeof defaultSettingForm>,
  pairs: SettingPair[]
) => {
  const setBlock: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(form)) {
    const parsed = parseScalar(value);

    if (parsed !== undefined) {
      setBlock[key] = parsed;
    }
  }

  for (const pair of pairs) {
    const key = pair.key.trim();

    if (!key) {
      continue;
    }

    try {
      setBlock[key] = parseJsonText(pair.valueText, `配置项 ${key}`);
    } catch {
      const parsed = parseScalar(pair.valueText);
      setBlock[key] = parsed === undefined ? pair.valueText : parsed;
    }
  }

  return setBlock;
};

const StepButton = ({
  active,
  completed,
  disabled,
  label,
  short,
  onClick
}: {
  active: boolean;
  completed: boolean;
  disabled?: boolean;
  label: string;
  short: string;
  onClick: () => void;
}) => {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "flex min-w-[160px] items-center gap-3 rounded-lg border px-4 py-3 text-left transition",
        active
          ? "border-[#141413] bg-[#141413] text-[#faf9f5] shadow-[0_2px_6px_rgba(20,20,19,0.16)]"
          : "border-[#dedcd1] bg-[#fffdf8] text-[#5f5e58] hover:border-[#c9c6ba] hover:text-[#141413]",
        disabled && "cursor-not-allowed opacity-50"
      )}
    >
      <span
        className={cn(
          "flex size-8 items-center justify-center rounded-full text-xs font-semibold",
          active ? "bg-white/18 text-[#faf9f5]" : "bg-[#f1eee6] text-[#73726c]"
        )}
      >
        {completed ? <Check className="size-4" /> : short}
      </span>
      <span className="text-sm font-medium">{label}</span>
    </button>
  );
};

const RawToggle = ({
  enabled,
  onToggle
}: {
  enabled: boolean;
  onToggle: () => void;
}) => {
  return (
    <button
      type="button"
      onClick={onToggle}
      className="inline-flex items-center gap-2 rounded-xl border border-[#dedcd1] bg-[#fffdf8] px-3 py-2 text-xs font-medium text-[#5f5e58] transition hover:border-[#c9c6ba] hover:text-[#141413]"
    >
      {enabled ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
      {enabled ? "隐藏 RAW" : "查看 RAW"}
    </button>
  );
};

const clientFingerprintOptions = [
  "chrome",
  "firefox",
  "safari",
  "iOS",
  "android",
  "edge",
  "360",
  "qq",
  "random"
];

const transportNetworkOptions = ["tcp", "ws", "http", "h2", "grpc"];
const packetEncodingOptions = ["packetaddr", "xudp"];

const splitPath = (key: string) => key.split(".").filter(Boolean);

const getRecordFieldValue = (record: Record<string, unknown>, key: string): unknown => {
  const parts = splitPath(key);
  let current: unknown = record;

  for (const part of parts) {
    if (!isRecord(current)) {
      return undefined;
    }

    current = current[part];
  }

  return current;
};

const deleteRecordFieldValue = (record: Record<string, unknown>, key: string) => {
  const parts = splitPath(key);

  if (parts.length === 0) {
    return;
  }

  const [head, ...rest] = parts;

  if (rest.length === 0) {
    delete record[head];
    return;
  }

  const child = record[head];

  if (!isRecord(child)) {
    return;
  }

  deleteRecordFieldValue(child, rest.join("."));

  if (Object.keys(child).length === 0) {
    delete record[head];
  }
};

const setRecordFieldValue = (
  record: Record<string, unknown>,
  key: string,
  value: unknown
) => {
  const parts = splitPath(key);

  if (parts.length === 0) {
    return;
  }

  if (value === "" || value === undefined || value === null) {
    deleteRecordFieldValue(record, key);
    return;
  }

  let current: Record<string, unknown> = record;

  for (const part of parts.slice(0, -1)) {
    const next = current[part];

    if (!isRecord(next)) {
      current[part] = {};
    }

    current = current[part] as Record<string, unknown>;
  }

  current[parts[parts.length - 1]!] = value;
};

const proxyTypeOptions = [
  "ss",
  "vmess",
  "vless",
  "trojan",
  "hysteria2",
  "tuic",
  "wireguard",
  "socks5",
  "http"
];

const commonProxyFields: FormFieldDefinition[] = [
  { key: "name", label: "节点名称", type: "text" },
  { key: "type", label: "协议类型", type: "select", options: proxyTypeOptions },
  { key: "server", label: "服务器", type: "text" },
  { key: "port", label: "端口", type: "number" },
  { key: "udp", label: "UDP", type: "boolean" }
];

const tlsProxyFields: FormFieldDefinition[] = [
  { key: "tls", label: "启用 TLS", type: "boolean" },
  { key: "servername", label: "SNI / Server Name", type: "text" },
  {
    key: "alpn",
    label: "ALPN",
    type: "textarea",
    placeholder: "每行一个协议，例如 h2 或 http/1.1"
  },
  { key: "fingerprint", label: "证书指纹", type: "text" },
  {
    key: "client-fingerprint",
    label: "客户端指纹",
    type: "select",
    options: clientFingerprintOptions
  },
  { key: "skip-cert-verify", label: "跳过证书校验", type: "boolean" },
  { key: "reality-opts.public-key", label: "REALITY 公钥", type: "text" },
  { key: "reality-opts.short-id", label: "REALITY Short ID", type: "text" },
  {
    key: "reality-opts.support-x25519mlkem768",
    label: "启用 X25519-MLKEM768",
    type: "boolean"
  }
];

const proxyFieldsByType: Record<string, FormFieldDefinition[]> = {
  ss: [
    { key: "cipher", label: "加密方式", type: "text" },
    { key: "password", label: "密码", type: "text" },
    { key: "plugin", label: "插件", type: "text" }
  ],
  vmess: [
    { key: "uuid", label: "UUID", type: "text" },
    { key: "alterId", label: "Alter ID", type: "number" },
    { key: "cipher", label: "Cipher", type: "text" },
    { key: "packet-encoding", label: "UDP 包编码", type: "select", options: packetEncodingOptions },
    ...tlsProxyFields,
    { key: "network", label: "传输层", type: "select", options: transportNetworkOptions },
    { key: "ws-path", label: "WS Path", type: "text" },
    { key: "ws-host", label: "WS Host", type: "text" }
  ],
  vless: [
    { key: "uuid", label: "UUID", type: "text" },
    { key: "flow", label: "Flow", type: "text" },
    { key: "packet-encoding", label: "UDP 包编码", type: "select", options: packetEncodingOptions },
    { key: "encryption", label: "Encryption", type: "text" },
    ...tlsProxyFields,
    { key: "network", label: "传输层", type: "select", options: transportNetworkOptions },
    { key: "ws-path", label: "WS Path", type: "text" },
    { key: "ws-host", label: "WS Host", type: "text" }
  ],
  trojan: [
    { key: "password", label: "密码", type: "text" },
    ...tlsProxyFields.map((field) =>
      field.key === "servername"
        ? {
            ...field,
            key: "sni"
          }
        : field
    ),
    { key: "network", label: "传输层", type: "select", options: transportNetworkOptions },
    { key: "ws-path", label: "WS Path", type: "text" },
    { key: "ws-host", label: "WS Host", type: "text" }
  ],
  hysteria2: [
    { key: "password", label: "密码", type: "text" },
    { key: "sni", label: "SNI", type: "text" },
    { key: "alpn", label: "ALPN", type: "text" },
    { key: "skip-cert-verify", label: "跳过证书校验", type: "boolean" }
  ],
  tuic: [
    { key: "uuid", label: "UUID", type: "text" },
    { key: "password", label: "密码", type: "text" },
    { key: "congestion-controller", label: "拥塞控制", type: "text" },
    { key: "sni", label: "SNI", type: "text" },
    { key: "alpn", label: "ALPN", type: "text" },
    { key: "skip-cert-verify", label: "跳过证书校验", type: "boolean" }
  ],
  wireguard: [
    { key: "ip", label: "IP", type: "text" },
    { key: "private-key", label: "Private Key", type: "text" },
    { key: "public-key", label: "Public Key", type: "text" }
  ],
  socks5: [
    { key: "username", label: "用户名", type: "text" },
    { key: "password", label: "密码", type: "text" },
    { key: "tls", label: "TLS", type: "boolean" }
  ],
  http: [
    { key: "username", label: "用户名", type: "text" },
    { key: "password", label: "密码", type: "text" },
    { key: "tls", label: "TLS", type: "boolean" }
  ]
};

const proxyGroupFields: FormFieldDefinition[] = [
  { key: "name", label: "代理组名称", type: "text" },
  {
    key: "type",
    label: "分组类型",
    type: "select",
    options: ["select", "url-test", "fallback", "load-balance", "relay"]
  },
  { key: "proxies", label: "成员列表", type: "textarea" },
  { key: "url", label: "测速 URL", type: "text" },
  { key: "interval", label: "检查间隔", type: "number" },
  { key: "tolerance", label: "容差", type: "number" },
  { key: "strategy", label: "负载策略", type: "text" },
  { key: "lazy", label: "Lazy", type: "boolean" }
];

const updateRecordField = (rawText: string, key: string, value: unknown) => {
  const record = tryParseObjectText(rawText) ?? {};
  const nextRecord = {
    ...record
  };
  setRecordFieldValue(nextRecord, key, value);

  return prettyJson(nextRecord);
};

const renderFieldControl = (
  field: FormFieldDefinition,
  record: Record<string, unknown>,
  onChange: (nextRawText: string) => void,
  rawText: string
) => {
  const value = getRecordFieldValue(record, field.key);

  if (field.type === "select") {
    return (
      <Select
        value={typeof value === "string" ? value : ""}
        onValueChange={(nextValue) => onChange(updateRecordField(rawText, field.key, nextValue))}
      >
        <SelectTrigger>
          <SelectValue placeholder={`选择${field.label}`} />
        </SelectTrigger>
        <SelectContent>
          {field.options?.map((option) => (
            <SelectItem key={option} value={option}>
              {option}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    );
  }

  if (field.type === "boolean") {
    return (
      <Select
        value={typeof value === "boolean" ? String(value) : ""}
        onValueChange={(nextValue) =>
          onChange(updateRecordField(rawText, field.key, nextValue === "true"))
        }
      >
        <SelectTrigger>
          <SelectValue placeholder={`设置${field.label}`} />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="true">true</SelectItem>
          <SelectItem value="false">false</SelectItem>
        </SelectContent>
      </Select>
    );
  }

  if (field.type === "textarea") {
    const textareaValue = Array.isArray(value)
      ? value.join("\n")
      : typeof value === "string"
        ? value
        : "";

    return (
      <Textarea
        value={textareaValue}
        onChange={(event) =>
          onChange(
            updateRecordField(
              rawText,
              field.key,
              event.target.value
                .split("\n")
                .map((item) => item.trim())
                .filter(Boolean)
            )
          )
        }
        className="min-h-28 text-xs"
        placeholder={field.placeholder ?? "每行一个成员"}
      />
    );
  }

  return (
    <Input
      type={field.type === "number" ? "number" : "text"}
      value={typeof value === "string" || typeof value === "number" ? String(value) : ""}
      onChange={(event) =>
        onChange(
          updateRecordField(
            rawText,
            field.key,
            field.type === "number" && event.target.value
              ? Number(event.target.value)
              : event.target.value
          )
        )
      }
      placeholder={field.placeholder ?? field.label}
    />
  );
};

const ProxyOperationForm = ({
  rawText,
  onChange
}: {
  rawText: string;
  onChange: (nextRawText: string) => void;
}) => {
  const record = tryParseObjectText(rawText) ?? {};
  const proxyType = typeof record.type === "string" ? record.type : "ss";
  const fieldDefs = [...commonProxyFields, ...(proxyFieldsByType[proxyType] ?? [])];

  return (
    <div className="space-y-4">
      {proxyType === "vless" ? (
        <div className="rounded-lg border border-[#80aadd]/45 bg-[#d6e4f6] px-4 py-3 text-sm text-[#3266ad]">
          REALITY 常用组合：开启 `TLS`，填写 `servername`、`client-fingerprint`，再补
          `reality-opts.public-key` 与 `reality-opts.short-id`。`fingerprint` 是证书指纹，和
          `client-fingerprint` 不是同一个概念。
        </div>
      ) : null}

      <div className="grid gap-4 xl:grid-cols-2">
        {fieldDefs.map((field) => (
          <label
            key={field.key}
            className={cn("block space-y-2", field.type === "textarea" && "xl:col-span-2")}
          >
            <span className="text-sm font-medium text-[#5f5e58]">{field.label}</span>
            {renderFieldControl(field, record, onChange, rawText)}
          </label>
        ))}
      </div>
    </div>
  );
};

const ProxyGroupOperationForm = ({
  rawText,
  onChange
}: {
  rawText: string;
  onChange: (nextRawText: string) => void;
}) => {
  const record = tryParseObjectText(rawText) ?? {};

  return (
    <div className="grid gap-4 xl:grid-cols-2">
      {proxyGroupFields.map((field) => (
        <label key={field.key} className={cn("block space-y-2", field.type === "textarea" && "xl:col-span-2")}>
          <span className="text-sm font-medium text-[#5f5e58]">{field.label}</span>
          {renderFieldControl(field, record, onChange, rawText)}
        </label>
      ))}
    </div>
  );
};

export const GeneratedSubscriptionWizardPage = () => {
  const { draftId } = useParams({ from: "/app/subscriptions/drafts/$draftId" });
  const navigate = useNavigate();
  const workspace = useWorkspace();

  const [draft, setDraft] = useState<GeneratedSubscriptionDraftDetail | null>(null);
  const [sourceDetail, setSourceDetail] = useState<UpstreamSourceDetail | null>(null);
  const [preview, setPreview] = useState<GeneratedSubscriptionDraftPreview | null>(null);
  const [publishedSubscription, setPublishedSubscription] =
    useState<GeneratedSubscriptionDetail | null>(null);
  const [extractedTemplateId, setExtractedTemplateId] = useState<string | null>(null);
  const [activeStep, setActiveStep] = useState<StepKey>("source");
  const [feedbackMessage, setFeedbackMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [busyAction, setBusyAction] = useState<string | null>(null);

  const [displayName, setDisplayName] = useState("");
  const [upstreamSourceId, setUpstreamSourceId] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");
  const [sourceDisplayName, setSourceDisplayName] = useState("");

  const [proxiesPatchMode, setProxiesPatchMode] = useState<PatchMode>("patch");
  const [proxiesEditorMode, setProxiesEditorMode] = useState<EditorMode>("visual");
  const [proxyVisualItems, setProxyVisualItems] = useState<VisualProxyOperation[]>([]);
  const [proxyFullOverrideItems, setProxyFullOverrideItems] = useState<FormRecordItem[]>([]);
  const [proxiesRawText, setProxiesRawText] = useState("[]");
  const [sourceProxyRawOpen, setSourceProxyRawOpen] = useState<Record<string, boolean>>({});

  const [groupsPatchMode, setGroupsPatchMode] = useState<PatchMode>("patch");
  const [groupsEditorMode, setGroupsEditorMode] = useState<EditorMode>("visual");
  const [groupVisualItems, setGroupVisualItems] = useState<VisualGroupOperation[]>([]);
  const [groupFullOverrideItems, setGroupFullOverrideItems] = useState<FormRecordItem[]>([]);
  const [selectedRulesets, setSelectedRulesets] = useState<string[]>([]);
  const [autoGroupOptions, setAutoGroupOptions] = useState<AutoGroupOptions>(
    defaultAutoGroupOptions
  );
  const [ruleTargetPolicy, setRuleTargetPolicy] = useState("Proxies");
  const [ruleInsertPosition, setRuleInsertPosition] =
    useState<RuleProviderAttachment["insert"]["position"]>("before-match");
  const [prependRulesText, setPrependRulesText] = useState("");
  const [appendRulesText, setAppendRulesText] = useState("");
  const [removeRulesText, setRemoveRulesText] = useState("");
  const [groupsRawText, setGroupsRawText] = useState(
    prettyJson({
      autoGroup: defaultAutoGroupOptions(),
      ruleProviderRefs: [],
      ruleProviderAttachments: [],
      proxyGroups: [],
      rules: []
    })
  );
  const [rulesFullOverrideText, setRulesFullOverrideText] = useState("");
  const [sourceGroupRawOpen, setSourceGroupRawOpen] = useState<Record<string, boolean>>({});

  const [settingsPatchMode, setSettingsPatchMode] = useState<PatchMode>("patch");
  const [settingsEditorMode, setSettingsEditorMode] = useState<EditorMode>("visual");
  const [settingsForm, setSettingsForm] = useState(defaultSettingForm());
  const [settingPairs, setSettingPairs] = useState<SettingPair[]>([]);
  const [unsetKeysText, setUnsetKeysText] = useState("");
  const [settingsRawText, setSettingsRawText] = useState("{}");

  const [publishVisibility, setPublishVisibility] = useState<Visibility>("private");
  const [publishShareMode, setPublishShareMode] = useState<ShareMode>("disabled");
  const [publishEnabled, setPublishEnabled] = useState(true);

  const sourceOptions = useMemo(() => {
    return workspace.sources.map((source) => ({
      id: source.id,
      label: source.displayName
    }));
  }, [workspace.sources]);

  const sourceLocator = sourceDetail
    ? sourceDetail.sourceKind === "uploaded_yaml"
      ? sourceDetail.uploadedFileName
        ? `YAML 文件：${sourceDetail.uploadedFileName}`
        : "YAML 文件"
      : sourceDetail.sourceUrl
    : "选择后这里会显示当前快照概况";

  const currentSourceProxies = (sourceDetail?.parsedConfig?.proxies ?? []) as Array<
    Record<string, unknown> & { name: string }
  >;
  const currentSourceGroups = (sourceDetail?.parsedConfig?.["proxy-groups"] ?? []) as Array<
    Record<string, unknown> & { name: string }
  >;

  const loadSourceDetail = async (sourceId: string) => {
    if (!sourceId) {
      setSourceDetail(null);
      return;
    }

    const detail = await workspace.getSourceDetail(sourceId);
    setSourceDetail(detail);
  };

  const hydrateFromDraft = async (nextDraft: GeneratedSubscriptionDraftDetail) => {
    setDraft(nextDraft);
    setDisplayName(nextDraft.displayName);
    setUpstreamSourceId(nextDraft.upstreamSourceId ?? "");
    setSourceUrl("");
    setSourceDisplayName("");
    setActiveStep(nextDraft.currentStep);
    setPreview(
      nextDraft.lastPreviewYaml
        ? {
            draft: nextDraft,
            sourceSnapshotId: nextDraft.selectedSourceSnapshotId ?? "",
            shareabilityStatus:
              nextDraft.shareabilityStatus === "unknown"
                ? "shareable"
                : nextDraft.shareabilityStatus,
            lockedReasons: [],
            stats: {
              proxyCount: 0,
              groupCount: 0,
              ruleCount: 0
            },
            document: {
              proxies: [],
              "proxy-groups": [],
              rules: []
            },
            yamlText: nextDraft.lastPreviewYaml
          }
        : null
    );

    const sourceStep = getDraftStep(nextDraft, "source");
    const sourceSummary = sourceStep?.summary ?? null;
    if (typeof sourceSummary?.displayName === "string") {
      setDisplayName(sourceSummary.displayName);
    }
    if (typeof sourceSummary?.sourceUrl === "string") {
      setSourceUrl(sourceSummary.sourceUrl);
    }
    if (typeof sourceSummary?.sourceDisplayName === "string") {
      setSourceDisplayName(sourceSummary.sourceDisplayName);
    }

    const proxiesStep = getDraftStep(nextDraft, "proxies");
    const proxyOperations = isRecord(proxiesStep?.operations) ? proxiesStep.operations : {};
    setProxiesPatchMode(proxiesStep?.patchMode === "full_override" ? "full_override" : "patch");
    setProxiesEditorMode(proxiesStep?.editorMode === "raw" ? "raw" : "visual");
    setProxyVisualItems(
      Array.isArray(proxyOperations.items)
        ? proxyOperations.items.flatMap<VisualProxyOperation>((item) => {
            if (!isRecord(item) || typeof item.type !== "string") {
              return [];
            }

            if (item.type === "add" && isRecord(item.proxy)) {
              return [
                {
                  id: buildId("proxy"),
                  type: "add" as const,
                  rawText: prettyJson(item.proxy)
                }
              ];
            }

            if (item.type === "replace" && typeof item.targetName === "string" && isRecord(item.proxy)) {
              return [
                {
                  id: buildId("proxy"),
                  type: "replace" as const,
                  targetName: item.targetName,
                  rawText: prettyJson(item.proxy)
                }
              ];
            }

            if (item.type === "remove" && typeof item.targetName === "string") {
              return [
                {
                  id: buildId("proxy"),
                  type: "remove" as const,
                  targetName: item.targetName,
                  rawText: ""
                }
              ];
            }

            return [];
          })
        : []
    );
    setProxiesRawText(prettyJson(proxiesStep?.raw ?? []));
    setProxyFullOverrideItems(
      createFormRecordItems(
        "proxy-override",
        Array.isArray(proxyOperations.proxies) ? proxyOperations.proxies : []
      )
    );

    const groupsStep = getDraftStep(nextDraft, "groups_rules");
    const groupOperations = isRecord(groupsStep?.operations) ? groupsStep.operations : {};
    const ruleProviderAttachments = Array.isArray(groupOperations.ruleProviderAttachments)
      ? groupOperations.ruleProviderAttachments.filter(isRecord)
      : [];
    setGroupsPatchMode(groupsStep?.patchMode === "full_override" ? "full_override" : "patch");
    setGroupsEditorMode(groupsStep?.editorMode === "raw" ? "raw" : "visual");
    setSelectedRulesets(
      ruleProviderAttachments.length > 0
        ? ruleProviderAttachments.flatMap((item) =>
            typeof item.providerSlug === "string" && item.providerSlug.trim().length > 0
              ? [item.providerSlug]
              : []
          )
        : Array.isArray(groupOperations.ruleProviderRefs)
        ? groupOperations.ruleProviderRefs.filter(
            (item): item is string => typeof item === "string" && item.trim().length > 0
          )
        : []
    );
    const firstAttachment = ruleProviderAttachments[0];
    setRuleTargetPolicy(
      typeof firstAttachment?.targetPolicy === "string" ? firstAttachment.targetPolicy : "Proxies"
    );
    const firstInsert = isRecord(firstAttachment?.insert) ? firstAttachment.insert : null;
    const firstInsertPosition = firstInsert?.position;
    setRuleInsertPosition(
      firstInsertPosition === "top" ||
        firstInsertPosition === "bottom" ||
        firstInsertPosition === "before-match"
        ? firstInsertPosition
        : "before-match"
    );
    const autoGroup = isRecord(groupOperations.autoGroup) ? groupOperations.autoGroup : null;
    setAutoGroupOptions({
      enabled: typeof autoGroup?.enabled === "boolean" ? autoGroup.enabled : true,
      includeAutoGroup:
        typeof autoGroup?.includeAutoGroup === "boolean" ? autoGroup.includeAutoGroup : true,
      unclassifiedPolicy: autoGroup?.unclassifiedPolicy === "ignore" ? "ignore" : "others"
    });
    setGroupVisualItems(
      Array.isArray(groupOperations.items)
        ? groupOperations.items.flatMap<VisualGroupOperation>((item) => {
            if (!isRecord(item) || typeof item.type !== "string") {
              return [];
            }

            if (item.type === "add" && isRecord(item.group)) {
              return [
                {
                  id: buildId("group"),
                  type: "add" as const,
                  rawText: prettyJson(item.group)
                }
              ];
            }

            if (item.type === "replace" && typeof item.targetName === "string" && isRecord(item.group)) {
              return [
                {
                  id: buildId("group"),
                  type: "replace" as const,
                  targetName: item.targetName,
                  rawText: prettyJson(item.group)
                }
              ];
            }

            if (item.type === "remove" && typeof item.targetName === "string") {
              return [
                {
                  id: buildId("group"),
                  type: "remove" as const,
                  targetName: item.targetName,
                  rawText: ""
                }
              ];
            }

            return [];
          })
        : []
    );
    setPrependRulesText(
      Array.isArray(groupOperations.prependRules) ? groupOperations.prependRules.join("\n") : ""
    );
    setAppendRulesText(
      Array.isArray(groupOperations.appendRules) ? groupOperations.appendRules.join("\n") : ""
    );
    setRemoveRulesText(
      Array.isArray(groupOperations.removeRules) ? groupOperations.removeRules.join("\n") : ""
    );
    setGroupsRawText(
      prettyJson(
        groupsStep?.raw ?? {
          autoGroup: defaultAutoGroupOptions(),
          ruleProviderRefs: [],
          ruleProviderAttachments: [],
          proxyGroups: [],
          rules: []
        }
      )
    );
    setGroupFullOverrideItems(
      createFormRecordItems(
        "group-override",
        Array.isArray(groupOperations.proxyGroups) ? groupOperations.proxyGroups : []
      )
    );
    setRulesFullOverrideText(
      Array.isArray(groupOperations.rules) ? groupOperations.rules.join("\n") : ""
    );

    const settingsStep = getDraftStep(nextDraft, "settings");
    const settingsOperations = isRecord(settingsStep?.operations) ? settingsStep.operations : {};
    setSettingsPatchMode(settingsStep?.patchMode === "full_override" ? "full_override" : "patch");
    setSettingsEditorMode(settingsStep?.editorMode === "raw" ? "raw" : "visual");
    const visualSettingsSource =
      settingsStep?.patchMode === "full_override"
        ? (isRecord(settingsStep?.raw)
            ? settingsStep.raw
            : isRecord(settingsOperations.config)
              ? settingsOperations.config
              : {})
        : isRecord(settingsOperations.set)
          ? settingsOperations.set
          : {};
    const visualSettings = buildSettingsVisualState(visualSettingsSource);
    setSettingsForm(visualSettings.settingsForm);
    setSettingPairs(visualSettings.settingPairs);
    setUnsetKeysText(
      Array.isArray(settingsOperations.unset) ? settingsOperations.unset.join("\n") : ""
    );
    setSettingsRawText(prettyJson(settingsStep?.raw ?? settingsOperations.config ?? {}));

    if (nextDraft.upstreamSourceId) {
      await loadSourceDetail(nextDraft.upstreamSourceId);
    } else {
      setSourceDetail(null);
    }
  };

  useEffect(() => {
    const load = async () => {
      setIsLoading(true);
      setErrorMessage(null);

      try {
        const nextDraft = await workspace.getGeneratedSubscriptionDraft(draftId);
        await hydrateFromDraft(nextDraft);
      } catch (error) {
        setErrorMessage(error instanceof Error ? error.message : "草稿载入失败。");
      } finally {
        setIsLoading(false);
      }
    };

    void load();
  }, [draftId]);

  const runAction = async (actionKey: string, action: () => Promise<void>) => {
    setBusyAction(actionKey);
    setErrorMessage(null);
    setFeedbackMessage(null);

    try {
      await action();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "操作失败。");
    } finally {
      setBusyAction(null);
    }
  };

  const proxyOperationMap = useMemo(() => {
    return new Map(
      proxyVisualItems
        .filter((item) => item.targetName)
        .map((item) => [item.targetName!, item] as const)
    );
  }, [proxyVisualItems]);

  const groupOperationMap = useMemo(() => {
    return new Map(
      groupVisualItems
        .filter((item) => item.targetName)
        .map((item) => [item.targetName!, item] as const)
    );
  }, [groupVisualItems]);

  const completedSteps = useMemo(() => {
    return new Set(draft?.steps.map((step) => step.stepKey) ?? []);
  }, [draft]);

  const draftStepIndex = stepItems.findIndex((step) => step.key === activeStep);
  const previousStep = draftStepIndex > 0 ? stepItems[draftStepIndex - 1]?.key ?? null : null;
  const nextStep =
    draftStepIndex < stepItems.length - 1 ? stepItems[draftStepIndex + 1]?.key ?? null : null;

  const buildRuleProviderAttachments = (): RuleProviderAttachment[] => {
    const targetPolicy = ruleTargetPolicy.trim() || "Proxies";

    return selectedRulesets.map((providerSlug) => ({
      type: "attach-rule-provider",
      providerSlug,
      targetPolicy,
      insert: {
        position: ruleInsertPosition
      }
    }));
  };

  const ensureTerminalMatchRule = (rules: string[]) => {
    if (!autoGroupOptions.enabled && selectedRulesets.length === 0) {
      return rules;
    }

    if (rules.some((rule) => /^MATCH\s*,/i.test(rule))) {
      return rules;
    }

    return [...rules, `MATCH,${ruleTargetPolicy.trim() || "Proxies"}`];
  };

  const buildProxiesRequest = () => {
    if (proxiesEditorMode === "raw") {
      return {
        patchMode: proxiesPatchMode,
        editorMode: "raw" as const,
        raw: parseArrayText(proxiesRawText, "节点 RAW"),
        summary: {
          editorMode: "raw"
        }
      };
    }

    if (proxiesPatchMode === "full_override") {
      return {
        patchMode: "full_override" as const,
        editorMode: "visual" as const,
        operations: {
          proxies: proxyFullOverrideItems.map((item) =>
            parseObjectText(item.rawText, "完整节点列表")
          )
        },
        summary: {
          mode: "full_override"
        }
      };
    }

    return {
      patchMode: "patch" as const,
      editorMode: "visual" as const,
      operations: {
        items: proxyVisualItems.map((item) => {
          if (item.type === "add") {
            return {
              type: "add" as const,
              proxy: parseObjectText(item.rawText, "新增节点")
            };
          }

          if (item.type === "replace") {
            return {
              type: "replace" as const,
              targetName: item.targetName,
              proxy: parseObjectText(item.rawText, "节点覆写")
            };
          }

          return {
            type: "remove" as const,
            targetName: item.targetName
          };
        })
      },
      summary: {
        changeCount: proxyVisualItems.length
      }
    };
  };

  const buildGroupsRulesRequest = () => {
    if (groupsEditorMode === "raw") {
      return {
        patchMode: groupsPatchMode,
        editorMode: "raw" as const,
        raw: parseObjectText(groupsRawText, "代理组与规则 RAW"),
        summary: {
          editorMode: "raw"
        }
      };
    }

    if (groupsPatchMode === "full_override") {
      return {
        patchMode: "full_override" as const,
        editorMode: "visual" as const,
        operations: {
          autoGroup: autoGroupOptions,
          ruleProviderRefs: selectedRulesets,
          ruleProviderAttachments: buildRuleProviderAttachments(),
          proxyGroups: groupFullOverrideItems.map((item) =>
            parseObjectText(item.rawText, "完整代理组列表")
          ),
          rules: ensureTerminalMatchRule(linesToArray(rulesFullOverrideText))
        },
        summary: {
          autoGroup: autoGroupOptions.enabled,
          ruleProviderCount: selectedRulesets.length
        }
      };
    }

    const prependRules = linesToArray(prependRulesText);
    const appendRules = ensureTerminalMatchRule(linesToArray(appendRulesText));
    const removeRules = linesToArray(removeRulesText);

    return {
      patchMode: "patch" as const,
      editorMode: "visual" as const,
      operations: {
        autoGroup: autoGroupOptions,
        ruleProviderRefs: selectedRulesets,
        ruleProviderAttachments: buildRuleProviderAttachments(),
        items: groupVisualItems.map((item) => {
          if (item.type === "add") {
            return {
              type: "add" as const,
              group: parseObjectText(item.rawText, "新增代理组")
            };
          }

          if (item.type === "replace") {
            return {
              type: "replace" as const,
              targetName: item.targetName,
              group: parseObjectText(item.rawText, "代理组覆写")
            };
          }

          return {
            type: "remove" as const,
            targetName: item.targetName
          };
        }),
        prependRules,
        appendRules,
        removeRules
      },
      summary: {
        autoGroup: autoGroupOptions.enabled,
        ruleProviderCount: selectedRulesets.length,
        groupChangeCount: groupVisualItems.length
      }
    };
  };

  const buildSettingsRequest = () => {
    if (settingsEditorMode === "raw") {
      return {
        patchMode: settingsPatchMode,
        editorMode: settingsEditorMode,
        raw: parseObjectText(settingsRawText, "其他设置 RAW"),
        summary: {
          editorMode: settingsEditorMode
        }
      };
    }

    const setBlock = buildSettingsConfigFromVisualState(settingsForm, settingPairs);

    if (settingsPatchMode === "full_override") {
      return {
        patchMode: "full_override" as const,
        editorMode: "visual" as const,
        operations: {
          config: setBlock
        },
        summary: {
          setCount: Object.keys(setBlock).length
        }
      };
    }

    return {
      patchMode: "patch" as const,
      editorMode: "visual" as const,
      operations: {
        set: setBlock,
        unset: linesToArray(unsetKeysText)
      },
      summary: {
        setCount: Object.keys(setBlock).length,
        unsetCount: linesToArray(unsetKeysText).length
      }
    };
  };

  const handleSaveSource = async (nextStepKey?: StepKey) => {
    if (!displayName.trim()) {
      setErrorMessage("请先填写扩展订阅名称。");
      return;
    }

    if (!upstreamSourceId && !sourceUrl.trim()) {
      setErrorMessage("请选择一个已有外部订阅，或粘贴一个新的订阅链接。");
      return;
    }

    await runAction("save-source", async () => {
      const importingFromUrl = sourceUrl.trim().length > 0;
      const updated = await workspace.updateGeneratedSubscriptionDraft(draftId, {
        displayName: displayName.trim(),
        upstreamSourceId: importingFromUrl ? null : upstreamSourceId || null,
        sourceUrl: importingFromUrl ? sourceUrl.trim() : undefined,
        sourceDisplayName: importingFromUrl
          ? sourceDisplayName.trim() || `${displayName.trim()} 外部订阅`
          : undefined,
        currentStep: nextStepKey ?? activeStep
      });
      const nextSourceId = updated.upstreamSourceId ?? "";
      const saved = await workspace.saveGeneratedSubscriptionDraftStep(draftId, {
        stepKey: "source",
        editorMode: "visual",
        operations: {
          upstreamSourceId: nextSourceId || null,
          sourceUrl: importingFromUrl ? sourceUrl.trim() : undefined,
          sourceDisplayName: importingFromUrl ? sourceDisplayName.trim() : undefined
        },
        summary: {
          displayName: displayName.trim(),
          upstreamSourceId: nextSourceId || null,
          sourceUrl: importingFromUrl ? sourceUrl.trim() : undefined,
          sourceDisplayName: importingFromUrl ? sourceDisplayName.trim() : undefined
        },
        currentStep: nextStepKey ?? activeStep
      });
      await hydrateFromDraft(saved);
      setActiveStep(nextStepKey ?? "source");
      setFeedbackMessage("已保存外部订阅来源。");
    });
  };

  const handleSaveProxies = async (nextStepKey?: StepKey) => {
    await runAction("save-proxies", async () => {
      const payload = buildProxiesRequest();
      const updated = await workspace.saveGeneratedSubscriptionDraftStep(draftId, {
        stepKey: "proxies",
        ...payload,
        currentStep: nextStepKey ?? activeStep
      });
      await hydrateFromDraft(updated);
      setActiveStep(nextStepKey ?? "proxies");
      setFeedbackMessage("节点编辑已保存。");
    });
  };

  const handleSaveGroupsRules = async (nextStepKey?: StepKey) => {
    await runAction("save-groups-rules", async () => {
      const payload = buildGroupsRulesRequest();
      const updated = await workspace.saveGeneratedSubscriptionDraftStep(draftId, {
        stepKey: "groups_rules",
        ...payload,
        currentStep: nextStepKey ?? activeStep
      });
      await hydrateFromDraft(updated);
      setActiveStep(nextStepKey ?? "groups_rules");
      setFeedbackMessage("代理组与规则已保存。");
    });
  };

  const handleSaveSettings = async (nextStepKey?: StepKey) => {
    await runAction("save-settings", async () => {
      const payload = buildSettingsRequest();
      const updated = await workspace.saveGeneratedSubscriptionDraftStep(draftId, {
        stepKey: "settings",
        ...payload,
        currentStep: nextStepKey ?? activeStep
      });
      await hydrateFromDraft(updated);
      setActiveStep(nextStepKey ?? "settings");
      setFeedbackMessage("其他设置已保存。");
    });
  };

  const handlePreview = async () => {
    await runAction("preview", async () => {
      const result = await workspace.previewGeneratedSubscriptionDraft(draftId);
      setPreview(result);
      setDraft(result.draft);
      setActiveStep("preview");
      setFeedbackMessage("预览已更新。");
    });
  };

  const handlePublish = async () => {
    await runAction("publish", async () => {
      const created = await workspace.publishGeneratedSubscriptionDraft(draftId, {
        displayName: displayName.trim(),
        visibility: publishVisibility,
        shareMode: publishShareMode,
        isEnabled: publishEnabled
      });
      setPublishedSubscription(created);
      setFeedbackMessage("扩展订阅已发布并完成首次生成。");
    });
  };

  const handleExtractTemplate = async (sanitized = false) => {
    await runAction("extract-template", async () => {
      const created = await workspace.extractTemplateFromDraft(draftId, {
        displayName: `${displayName.trim() || "未命名扩展订阅"} ${sanitized ? "脱敏模板" : "模板"}`,
        sanitized
      });
      setExtractedTemplateId(created.id);
      setFeedbackMessage(
        sanitized
          ? "已提炼脱敏模板，真实节点不会进入共享模板。"
          : "已从当前草稿提炼出一个模板副本。"
      );
    });
  };

  const handleCopyTempLink = async (expiresInSeconds = 24 * 60 * 60) => {
    if (!publishedSubscription) {
      return;
    }

    await runAction("copy-link", async () => {
      const link = await workspace.createTempLink(publishedSubscription.id, expiresInSeconds);
      await copyText(link);
      setFeedbackMessage("已复制临时拉取链接。");
    });
  };

  if (isLoading) {
    return (
      <Card className="rounded-lg p-10 text-center text-sm text-[#73726c]">
        正在载入扩展订阅向导...
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <Card className="rounded-lg p-6">
        <div className="flex flex-col gap-5 xl:flex-row xl:items-start xl:justify-between">
          <div>
            <div className="flex flex-wrap items-center gap-3">
              <Link
                to="/subscriptions"
                className="inline-flex items-center gap-2 rounded-lg border border-[#dedcd1] bg-[#fffdf8] px-4 py-2 text-sm font-medium text-[#5f5e58] transition hover:border-[#c9c6ba] hover:text-[#141413]"
              >
                <ArrowLeft className="size-4" />
                返回订阅
              </Link>
              <Badge className={shareabilityTone[draft?.shareabilityStatus ?? "unknown"]}>
                {shareabilityText[draft?.shareabilityStatus ?? "unknown"]}
              </Badge>
              {publishedSubscription ? (
                <Badge className="border-[#7ab948]/40 bg-[#e9f1dc] text-[#265b19]">
                  已发布
                </Badge>
              ) : null}
            </div>
            <h3 className="mt-4 text-2xl font-semibold text-[#141413]">
              扩展订阅向导
            </h3>
            <p className="mt-2 text-sm text-[#73726c]">
              把外部订阅、自动分组、规则源和你的操作模板组合成可长期分发的订阅。
            </p>
          </div>

          <div className="grid gap-3 text-sm text-[#73726c] sm:grid-cols-2">
            <div>
              <p className="text-xs text-[#9c9a92]">草稿名称</p>
              <p className="mt-2 font-medium text-[#141413]">{displayName || "未命名草稿"}</p>
            </div>
            <div>
              <p className="text-xs text-[#9c9a92]">最近更新</p>
              <p className="mt-2 font-medium text-[#141413]">{formatTime(draft?.updatedAt ?? null)}</p>
            </div>
          </div>
        </div>

        <div className="mt-6 flex gap-3 overflow-x-auto pb-1">
          {stepItems.map((step) => (
            <StepButton
              key={step.key}
              active={activeStep === step.key}
              completed={completedSteps.has(step.key as GeneratedSubscriptionDraftStep["stepKey"])}
              label={step.label}
              short={step.short}
              onClick={() => setActiveStep(step.key)}
            />
          ))}
        </div>
      </Card>

      {feedbackMessage ? (
        <div
          role="status"
          aria-live="polite"
          className="rounded-lg border border-[#7ab948]/40 border-l-[#437426] border-l-4 bg-[#e9f1dc] px-5 py-4 text-sm text-[#265b19]"
        >
          {feedbackMessage}
        </div>
      ) : null}

      {errorMessage ? (
        <div
          role="alert"
          className="rounded-lg border border-[#cd5c58]/50 border-l-[#a73d39] border-l-4 bg-[#f7ecec] px-5 py-4 text-sm text-[#7f2c28]"
        >
          {errorMessage}
        </div>
      ) : null}

      {activeStep === "source" ? (
        <Card className="rounded-lg p-6">
          <div className="flex flex-col gap-6 xl:flex-row xl:items-start xl:justify-between">
            <div className="max-w-2xl space-y-4">
              <div>
              <p className="text-sm font-medium text-[#73726c]">
                  第 1 步
                </p>
                <h4 className="mt-2 text-xl font-semibold text-[#141413]">
                  接入一个外部订阅作为底稿
                </h4>
              </div>

              <label className="block space-y-2">
                <span className="text-sm font-medium text-[#5f5e58]">扩展订阅名称</span>
                <Input
                  value={displayName}
                  onChange={(event) => setDisplayName(event.target.value)}
                  placeholder="例如：日常出行 / 影音专用"
                />
              </label>

              <div className="grid gap-4 2xl:grid-cols-2">
                <label className="block space-y-2">
                  <span className="text-sm font-medium text-[#5f5e58]">已有外部订阅</span>
                  <Select
                    value={upstreamSourceId}
                    onValueChange={(value) => {
                      setUpstreamSourceId(value);
                      setSourceUrl("");
                      setSourceDisplayName("");
                      void loadSourceDetail(value);
                    }}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="选择一个外部订阅" />
                    </SelectTrigger>
                    <SelectContent>
                      {sourceOptions.map((source) => (
                        <SelectItem key={source.id} value={source.id}>
                          {source.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </label>

                <label className="block space-y-2">
                  <span className="text-sm font-medium text-[#5f5e58]">粘贴新的订阅链接</span>
                  <Input
                    value={sourceUrl}
                    onChange={(event) => {
                      setSourceUrl(event.target.value);
                      if (event.target.value.trim()) {
                        setUpstreamSourceId("");
                        setSourceDetail(null);
                      }
                    }}
                    placeholder="https://example.com/subscription.yaml"
                  />
                </label>
              </div>

              {sourceUrl.trim() ? (
                <label className="block space-y-2">
                  <span className="text-sm font-medium text-[#5f5e58]">新来源名称</span>
                  <Input
                    value={sourceDisplayName}
                    onChange={(event) => setSourceDisplayName(event.target.value)}
                    placeholder={`${displayName || "扩展订阅"} 外部订阅`}
                  />
                </label>
              ) : null}
            </div>

            <div className="w-full max-w-xl rounded-lg border border-[#dedcd1] bg-[#f5f4ed]/80 p-5">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-semibold text-[#141413]">
                    {sourceDetail?.displayName ?? "尚未选择外部订阅"}
                  </p>
                  <p className="mt-1 text-sm text-[#73726c]">
                    {sourceLocator}
                  </p>
                </div>
                {sourceDetail?.sourceKind === "url" ? (
                  <Button
                    variant="secondary"
                    disabled={busyAction === "sync-source"}
                    onClick={() =>
                      void runAction("sync-source", async () => {
                        await workspace.syncSource(sourceDetail.id);
                        await loadSourceDetail(sourceDetail.id);
                        setFeedbackMessage("外部订阅已同步。");
                      })
                    }
                  >
                    <RefreshCw className="size-4" />
                    立即同步
                  </Button>
                ) : null}
              </div>

              <div className="mt-5 grid gap-3 text-sm text-[#73726c] sm:grid-cols-3">
                <p>节点数：{sourceDetail?.proxyCount ?? 0}</p>
                <p>代理组：{sourceDetail?.groupCount ?? 0}</p>
                <p>规则数：{sourceDetail?.ruleCount ?? 0}</p>
              </div>
            </div>
          </div>

          <div className="mt-6 flex justify-end">
            <Button
              disabled={
                busyAction === "save-source" ||
                (!upstreamSourceId && !sourceUrl.trim()) ||
                !displayName.trim()
              }
              onClick={() => void handleSaveSource("proxies")}
            >
              <Save className="size-4" />
              保存并继续
            </Button>
          </div>
        </Card>
      ) : null}

      {activeStep === "proxies" ? (
        <Card className="rounded-lg p-6">
          <div className="flex flex-col gap-6">
            <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
              <div>
                <p className="text-sm font-medium text-[#9c9a92]">第 2 步</p>
                <h4 className="mt-2 text-xl font-semibold text-[#141413]">
                  编辑当前外部订阅中的节点
                </h4>
                <p className="mt-2 text-sm text-[#73726c]">
                  默认以 Patch 模式工作。你可以删除源节点、覆盖源节点，或者新增自定义节点。
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-3">
                <Select
                  value={proxiesPatchMode}
                  onValueChange={(value) => setProxiesPatchMode(value as PatchMode)}
                >
                  <SelectTrigger className="w-[170px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="patch">Patch 模式</SelectItem>
                    <SelectItem value="full_override">Full Overrides</SelectItem>
                  </SelectContent>
                </Select>

                <Tabs
                  value={proxiesEditorMode}
                  onValueChange={(value) => setProxiesEditorMode(value as EditorMode)}
                >
                  <TabsList>
                    <TabsTrigger value="visual">可视化</TabsTrigger>
                    <TabsTrigger value="raw">RAW</TabsTrigger>
                  </TabsList>
                </Tabs>
              </div>
            </div>

            {proxiesEditorMode === "raw" ? (
              <Textarea
                value={proxiesRawText}
                onChange={(event) => setProxiesRawText(event.target.value)}
                className="min-h-[420px] font-mono text-xs"
              />
            ) : proxiesPatchMode === "full_override" ? (
              <div className="space-y-3">
                <p className="text-sm text-[#73726c]">
                  Full Overrides 下会完全替换节点列表，请直接维护最终节点集。
                </p>
                <div className="flex items-center justify-between">
                  <Badge>{proxyFullOverrideItems.length} 个节点</Badge>
                  <Button
                    variant="secondary"
                    onClick={() =>
                      setProxyFullOverrideItems((current) => [
                        ...current,
                        {
                          id: buildId("proxy-override"),
                          rawText: prettyJson(defaultProxyDraft())
                        }
                      ])
                    }
                  >
                    <Plus className="size-4" />
                    新增节点
                  </Button>
                </div>
                <div className="space-y-4">
                  {proxyFullOverrideItems.map((item) => (
                    <div
                      key={item.id}
                      className="rounded-lg border border-[#dedcd1] bg-[#fffdf8] p-5"
                    >
                      <div className="flex items-center justify-between">
                        <p className="text-sm font-semibold text-[#141413]">节点条目</p>
                        <Button
                          variant="ghost"
                          onClick={() =>
                            setProxyFullOverrideItems((current) =>
                              current.filter((candidate) => candidate.id !== item.id)
                            )
                          }
                        >
                          <Trash2 className="size-4" />
                          删除
                        </Button>
                      </div>
                      <div className="mt-4">
                        <ProxyOperationForm
                          rawText={item.rawText}
                          onChange={(nextRawText) =>
                            setProxyFullOverrideItems((current) =>
                              current.map((candidate) =>
                                candidate.id === item.id
                                  ? {
                                      ...candidate,
                                      rawText: nextRawText
                                    }
                                  : candidate
                              )
                            )
                          }
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div className="space-y-6">
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <h5 className="text-lg font-semibold text-[#141413]">源节点</h5>
                    <Badge>{currentSourceProxies.length} 个节点</Badge>
                  </div>

                  <div className="grid gap-4 xl:grid-cols-2">
                    {currentSourceProxies.map((proxy) => {
                      const operation = proxyOperationMap.get(proxy.name);
                      const previewProxy =
                        operation?.type === "replace"
                          ? tryParseObjectText(operation.rawText) ?? proxy
                          : proxy;
                      const isRawOpen = sourceProxyRawOpen[proxy.name] ?? false;

                      return (
                        <div
                          key={proxy.name}
                          className="rounded-lg border border-[#dedcd1] bg-[#f5f4ed]/80 p-5"
                        >
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="text-base font-semibold text-[#141413]">{proxy.name}</p>
                            <Badge>{String(previewProxy.type ?? "unknown")}</Badge>
                            {operation?.type === "remove" ? (
                              <Badge className="border-[#cd5c58]/50 bg-[#f7ecec] text-[#7f2c28]">
                                将删除
                              </Badge>
                            ) : null}
                            {operation?.type === "replace" ? (
                              <Badge className="border-[#80aadd]/45 bg-[#d6e4f6] text-[#3266ad]">
                                已覆写
                              </Badge>
                            ) : null}
                          </div>

                          <div className="mt-4 grid gap-2 text-sm text-[#73726c] sm:grid-cols-2">
                            {describeObjectEntries(previewProxy).map(([key, value]) => (
                              <p key={key} className="truncate">
                                <span className="font-medium text-[#3d3d3a]">{key}：</span>
                                {formatObjectEntryValue(key, value)}
                              </p>
                            ))}
                          </div>

                          <div className="mt-4 flex flex-wrap gap-2">
                            <Button
                              variant={operation?.type === "remove" ? "danger" : "secondary"}
                              onClick={() => {
                                setProxyVisualItems((current) => {
                                  if (operation?.type === "remove") {
                                    return current.filter((item) => item.id !== operation.id);
                                  }

                                  return [
                                    ...current.filter((item) => item.targetName !== proxy.name),
                                    {
                                      id: buildId("proxy"),
                                      type: "remove",
                                      targetName: proxy.name,
                                      rawText: ""
                                    }
                                  ];
                                });
                              }}
                            >
                              <Trash2 className="size-4" />
                              {operation?.type === "remove" ? "取消删除" : "删除节点"}
                            </Button>
                            <Button
                              variant="secondary"
                              onClick={() => {
                                setProxyVisualItems((current) => {
                                  const existing = current.find((item) => item.targetName === proxy.name);

                                  if (existing?.type === "replace") {
                                    return current.filter((item) => item.id !== existing.id);
                                  }

                                  return [
                                    ...current.filter((item) => item.targetName !== proxy.name),
                                    {
                                      id: buildId("proxy"),
                                      type: "replace",
                                      targetName: proxy.name,
                                      rawText: prettyJson(proxy)
                                    }
                                  ];
                                });
                              }}
                            >
                              <Sparkles className="size-4" />
                              {operation?.type === "replace" ? "取消覆写" : "覆写节点"}
                            </Button>
                            <RawToggle
                              enabled={isRawOpen}
                              onToggle={() =>
                                setSourceProxyRawOpen((current) => ({
                                  ...current,
                                  [proxy.name]: !isRawOpen
                                }))
                              }
                            />
                          </div>

                          {isRawOpen ? (
                            <Textarea
                              value={operation?.type === "replace" ? operation.rawText : prettyJson(proxy)}
                              readOnly={operation?.type !== "replace"}
                              onChange={(event) => {
                                if (operation?.type !== "replace") {
                                  return;
                                }

                                setProxyVisualItems((current) =>
                                  current.map((item) =>
                                    item.id === operation.id
                                      ? {
                                          ...item,
                                          rawText: event.target.value
                                        }
                                      : item
                                  )
                                );
                              }}
                              className="mt-4 min-h-52 font-mono text-xs"
                            />
                          ) : operation?.type === "replace" ? (
                            <div className="mt-4">
                              <ProxyOperationForm
                                rawText={operation.rawText}
                                onChange={(nextRawText) => {
                                  setProxyVisualItems((current) =>
                                    current.map((item) =>
                                      item.id === operation.id
                                        ? {
                                            ...item,
                                            rawText: nextRawText
                                          }
                                        : item
                                    )
                                  );
                                }}
                              />
                            </div>
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                </div>

                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <h5 className="text-lg font-semibold text-[#141413]">新增自定义节点</h5>
                    <Button
                      variant="secondary"
                      onClick={() =>
                        setProxyVisualItems((current) => [
                          ...current,
                          {
                            id: buildId("proxy"),
                            type: "add",
                            rawText: prettyJson(defaultProxyDraft())
                          }
                        ])
                      }
                    >
                      <Plus className="size-4" />
                      新增节点
                    </Button>
                  </div>

                  <div className="space-y-4">
                    {proxyVisualItems
                      .filter((item) => item.type === "add")
                      .map((item) => (
                        <div
                          key={item.id}
                          className="rounded-lg border border-[#dedcd1] bg-[#fffdf8] p-5"
                        >
                          <div className="flex items-center justify-between">
                            <p className="text-sm font-semibold text-[#141413]">自定义节点</p>
                            <Button
                              variant="ghost"
                              onClick={() =>
                                setProxyVisualItems((current) =>
                                  current.filter((candidate) => candidate.id !== item.id)
                                )
                              }
                            >
                              <Trash2 className="size-4" />
                              移除
                            </Button>
                          </div>
                          <div className="mt-4">
                            <ProxyOperationForm
                              rawText={item.rawText}
                              onChange={(nextRawText) =>
                                setProxyVisualItems((current) =>
                                  current.map((candidate) =>
                                    candidate.id === item.id
                                      ? {
                                          ...candidate,
                                          rawText: nextRawText
                                        }
                                      : candidate
                                  )
                                )
                              }
                            />
                          </div>
                        </div>
                      ))}
                  </div>
                </div>
              </div>
            )}

            <div className="flex items-center justify-between">
              <Button
                variant="ghost"
                disabled={!previousStep}
                onClick={() => previousStep && setActiveStep(previousStep)}
              >
                <ArrowLeft className="size-4" />
                返回上一步
              </Button>
              <div className="flex gap-3">
                <Button
                  variant="secondary"
                  disabled={busyAction === "save-proxies"}
                  onClick={() => void handleSaveProxies()}
                >
                  <Save className="size-4" />
                  仅保存
                </Button>
                <Button
                  disabled={busyAction === "save-proxies"}
                  onClick={() => void handleSaveProxies("groups_rules")}
                >
                  <ArrowRight className="size-4" />
                  保存并继续
                </Button>
              </div>
            </div>
          </div>
        </Card>
      ) : null}

      {activeStep === "groups_rules" ? (
        <Card className="rounded-lg p-6">
          <div className="space-y-6">
            <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
              <div>
                <p className="text-sm font-medium text-[#9c9a92]">第 3 步</p>
                <h4 className="mt-2 text-xl font-semibold text-[#141413]">
                  编辑代理组、规则源与规则链
                </h4>
                <p className="mt-2 text-sm text-[#73726c]">
                  内置规则源已经落库并定时更新，可以直接在这里勾选引用。
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-3">
                <Select
                  value={groupsPatchMode}
                  onValueChange={(value) => setGroupsPatchMode(value as PatchMode)}
                >
                  <SelectTrigger className="w-[170px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="patch">Patch 模式</SelectItem>
                    <SelectItem value="full_override">Full Overrides</SelectItem>
                  </SelectContent>
                </Select>

                <Tabs
                  value={groupsEditorMode}
                  onValueChange={(value) => setGroupsEditorMode(value as EditorMode)}
                >
                  <TabsList>
                    <TabsTrigger value="visual">可视化</TabsTrigger>
                    <TabsTrigger value="raw">RAW</TabsTrigger>
                  </TabsList>
                </Tabs>
              </div>
            </div>

            {groupsEditorMode === "raw" ? (
              <Textarea
                value={groupsRawText}
                onChange={(event) => setGroupsRawText(event.target.value)}
                className="min-h-[420px] font-mono text-xs"
              />
            ) : (
              <div className="space-y-6">
                <div className="grid gap-4 xl:grid-cols-[minmax(0,1.2fr)_minmax(280px,0.8fr)]">
                  <div className="rounded-lg border border-[#dedcd1] bg-[#f5f4ed]/80 p-5">
                    <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                      <div>
                        <h5 className="text-lg font-semibold text-[#141413]">自动节点分组</h5>
                        <p className="mt-2 text-sm text-[#73726c]">
                          系统会提取所有节点放入 Proxies，并按国家/地区生成 HK、JP、US、TW、SG、KR、Others。
                        </p>
                      </div>
                      <label className="flex shrink-0 items-center gap-3 rounded-lg border border-[#dedcd1] bg-[#fffdf8] px-4 py-3 text-sm font-medium text-[#3d3d3a]">
                        <input
                          type="checkbox"
                          checked={autoGroupOptions.enabled}
                          onChange={(event) =>
                            setAutoGroupOptions((current) => ({
                              ...current,
                              enabled: event.target.checked
                            }))
                          }
                          className="size-4 rounded border-[#c9c6ba] accent-[#c96442]"
                        />
                        启用
                      </label>
                    </div>

                    <div className="mt-5 grid gap-4 sm:grid-cols-2">
                      <label className="flex items-center gap-3 rounded-lg border border-[#dedcd1] bg-[#fffdf8] px-4 py-3 text-sm text-[#5f5e58]">
                        <input
                          type="checkbox"
                          checked={autoGroupOptions.includeAutoGroup}
                          disabled={!autoGroupOptions.enabled}
                          onChange={(event) =>
                            setAutoGroupOptions((current) => ({
                              ...current,
                              includeAutoGroup: event.target.checked
                            }))
                          }
                          className="size-4 rounded border-[#c9c6ba] accent-[#c96442]"
                        />
                        添加 Auto 延迟测试组
                      </label>

                      <label className="block space-y-2">
                        <span className="text-sm font-medium text-[#5f5e58]">未识别节点</span>
                        <Select
                          value={autoGroupOptions.unclassifiedPolicy}
                          disabled={!autoGroupOptions.enabled}
                          onValueChange={(value) =>
                            setAutoGroupOptions((current) => ({
                              ...current,
                              unclassifiedPolicy: value === "ignore" ? "ignore" : "others"
                            }))
                          }
                        >
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="others">放入 Others</SelectItem>
                            <SelectItem value="ignore">只保留在 Proxies</SelectItem>
                          </SelectContent>
                        </Select>
                      </label>
                    </div>
                  </div>

                  <div className="rounded-lg border border-[#dedcd1] bg-[#fffdf8] p-5">
                    <h5 className="text-lg font-semibold text-[#141413]">规则源落点</h5>
                    <p className="mt-2 text-sm text-[#73726c]">
                      勾选的 GitHub 规则源会写入 rule-providers，并自动插入 RULE-SET 规则。
                    </p>
                    <div className="mt-5 space-y-4">
                      <label className="block space-y-2">
                        <span className="text-sm font-medium text-[#5f5e58]">目标策略组</span>
                        <Input
                          value={ruleTargetPolicy}
                          onChange={(event) => setRuleTargetPolicy(event.target.value)}
                          placeholder="Proxies"
                        />
                      </label>
                      <label className="block space-y-2">
                        <span className="text-sm font-medium text-[#5f5e58]">插入位置</span>
                        <Select
                          value={ruleInsertPosition}
                          onValueChange={(value) =>
                            setRuleInsertPosition(
                              value === "top" || value === "bottom" ? value : "before-match"
                            )
                          }
                        >
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="before-match">MATCH 前</SelectItem>
                            <SelectItem value="top">规则顶部</SelectItem>
                            <SelectItem value="bottom">规则底部</SelectItem>
                          </SelectContent>
                        </Select>
                      </label>
                    </div>
                  </div>
                </div>

                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <h5 className="text-lg font-semibold text-[#141413]">内置规则源</h5>
                    <Badge>{workspace.marketplaceRulesets.length} 个可用</Badge>
                  </div>

                  <div className="flex flex-wrap gap-3">
                    {workspace.marketplaceRulesets.map((ruleset) => {
                      const selected = selectedRulesets.includes(ruleset.slug);
                      return (
                        <button
                          key={ruleset.id}
                          type="button"
                          onClick={() => {
                            setSelectedRulesets((current) =>
                              selected
                                ? current.filter((item) => item !== ruleset.slug)
                                : [...current, ruleset.slug]
                            );
                          }}
                            className={cn(
                            "rounded-lg border px-4 py-3 text-left transition",
                            selected
                              ? "border-[#141413] bg-[#141413] text-[#faf9f5]"
                              : "border-[#dedcd1] bg-[#fffdf8] text-[#5f5e58] hover:border-[#c9c6ba] hover:text-[#141413]"
                          )}
                        >
                          <p className="text-sm font-medium">{ruleset.name}</p>
                          <p
                            className={cn(
                              "mt-1 max-w-64 text-xs",
                              selected ? "text-[#faf9f5]/75" : "text-[#9c9a92]"
                            )}
                          >
                            {ruleset.description ?? "暂无描述"}
                          </p>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {groupsPatchMode === "full_override" ? (
                  <div className="space-y-4">
                    <div className="flex items-center justify-between">
                      <Badge>{groupFullOverrideItems.length} 个代理组</Badge>
                      <Button
                        variant="secondary"
                        onClick={() =>
                          setGroupFullOverrideItems((current) => [
                            ...current,
                            {
                              id: buildId("group-override"),
                              rawText: prettyJson(defaultGroupDraft())
                            }
                          ])
                        }
                      >
                        <Plus className="size-4" />
                        新增代理组
                      </Button>
                    </div>
                    <div className="space-y-4">
                      {groupFullOverrideItems.map((item) => (
                        <div
                          key={item.id}
                          className="rounded-lg border border-[#dedcd1] bg-[#fffdf8] p-5"
                        >
                          <div className="flex items-center justify-between">
                            <p className="text-sm font-semibold text-[#141413]">代理组条目</p>
                            <Button
                              variant="ghost"
                              onClick={() =>
                                setGroupFullOverrideItems((current) =>
                                  current.filter((candidate) => candidate.id !== item.id)
                                )
                              }
                            >
                              <Trash2 className="size-4" />
                              删除
                            </Button>
                          </div>
                          <div className="mt-4">
                            <ProxyGroupOperationForm
                              rawText={item.rawText}
                              onChange={(nextRawText) =>
                                setGroupFullOverrideItems((current) =>
                                  current.map((candidate) =>
                                    candidate.id === item.id
                                      ? {
                                          ...candidate,
                                          rawText: nextRawText
                                        }
                                      : candidate
                                  )
                                )
                              }
                            />
                          </div>
                        </div>
                      ))}
                    </div>
                    <div className="grid gap-4 xl:grid-cols-2">
                    <div className="space-y-2">
                        <p className="text-sm font-medium text-[#5f5e58]">完整规则列表</p>
                        <Textarea
                          value={rulesFullOverrideText}
                          onChange={(event) => setRulesFullOverrideText(event.target.value)}
                          className="min-h-[320px] font-mono text-xs"
                          placeholder="每行一条规则"
                        />
                      </div>
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="space-y-4">
                      <div className="flex items-center justify-between">
                        <h5 className="text-lg font-semibold text-[#141413]">源代理组</h5>
                        <Button
                          variant="secondary"
                          onClick={() =>
                            setGroupVisualItems((current) => [
                              ...current,
                              {
                                id: buildId("group"),
                                type: "add",
                                rawText: prettyJson(defaultGroupDraft())
                              }
                            ])
                          }
                        >
                          <Plus className="size-4" />
                          新增代理组
                        </Button>
                      </div>

                      <div className="grid gap-4 xl:grid-cols-2">
                        {currentSourceGroups.map((group) => {
                          const operation = groupOperationMap.get(group.name);
                          const previewGroup =
                            operation?.type === "replace"
                              ? tryParseObjectText(operation.rawText) ?? group
                              : group;
                          const isRawOpen = sourceGroupRawOpen[group.name] ?? false;

                          return (
                            <div
                              key={group.name}
                              className="rounded-lg border border-[#dedcd1] bg-[#f5f4ed]/80 p-5"
                            >
                              <div className="flex flex-wrap items-center gap-2">
                                <p className="text-base font-semibold text-[#141413]">{group.name}</p>
                                <Badge>{String(previewGroup.type ?? "select")}</Badge>
                                {operation?.type === "remove" ? (
                                  <Badge className="border-[#cd5c58]/50 bg-[#f7ecec] text-[#7f2c28]">
                                    将删除
                                  </Badge>
                                ) : null}
                              </div>

                              <div className="mt-4 grid gap-2 text-sm text-[#73726c]">
                                {describeObjectEntries(previewGroup).map(([key, value]) => (
                                  <p key={key} className="truncate">
                                    <span className="font-medium text-[#3d3d3a]">{key}：</span>
                                    {formatObjectEntryValue(key, value)}
                                  </p>
                                ))}
                              </div>

                              <div className="mt-4 flex flex-wrap gap-2">
                                <Button
                                  variant={operation?.type === "remove" ? "danger" : "secondary"}
                                  onClick={() => {
                                    setGroupVisualItems((current) => {
                                      if (operation?.type === "remove") {
                                        return current.filter((item) => item.id !== operation.id);
                                      }

                                      return [
                                        ...current.filter((item) => item.targetName !== group.name),
                                        {
                                          id: buildId("group"),
                                          type: "remove",
                                          targetName: group.name,
                                          rawText: ""
                                        }
                                      ];
                                    });
                                  }}
                                >
                                  <Trash2 className="size-4" />
                                  {operation?.type === "remove" ? "取消删除" : "删除代理组"}
                                </Button>
                                <Button
                                  variant="secondary"
                                  onClick={() => {
                                    setGroupVisualItems((current) => {
                                      const existing = current.find((item) => item.targetName === group.name);

                                      if (existing?.type === "replace") {
                                        return current.filter((item) => item.id !== existing.id);
                                      }

                                      return [
                                        ...current.filter((item) => item.targetName !== group.name),
                                        {
                                          id: buildId("group"),
                                          type: "replace",
                                          targetName: group.name,
                                          rawText: prettyJson(group)
                                        }
                                      ];
                                    });
                                  }}
                                >
                                  <Sparkles className="size-4" />
                                  {operation?.type === "replace" ? "取消覆写" : "覆写代理组"}
                                </Button>
                                <RawToggle
                                  enabled={isRawOpen}
                                  onToggle={() =>
                                    setSourceGroupRawOpen((current) => ({
                                      ...current,
                                      [group.name]: !isRawOpen
                                    }))
                                  }
                                />
                              </div>

                              {isRawOpen ? (
                                <Textarea
                                  value={operation?.type === "replace" ? operation.rawText : prettyJson(group)}
                                  readOnly={operation?.type !== "replace"}
                                  onChange={(event) =>
                                    setGroupVisualItems((current) =>
                                      current.map((item) =>
                                        item.id === operation?.id
                                          ? {
                                              ...item,
                                              rawText: event.target.value
                                            }
                                          : item
                                      )
                                    )
                                  }
                                  className="mt-4 min-h-52 font-mono text-xs"
                                />
                              ) : operation?.type === "replace" ? (
                                <div className="mt-4">
                                  <ProxyGroupOperationForm
                                    rawText={operation.rawText}
                                    onChange={(nextRawText) =>
                                      setGroupVisualItems((current) =>
                                        current.map((item) =>
                                          item.id === operation.id
                                            ? {
                                                ...item,
                                                rawText: nextRawText
                                              }
                                            : item
                                        )
                                      )
                                    }
                                  />
                                </div>
                              ) : null}
                            </div>
                          );
                        })}
                      </div>

                      {groupVisualItems
                        .filter((item) => item.type === "add")
                        .map((item) => (
                          <div
                            key={item.id}
                            className="rounded-lg border border-[#dedcd1] bg-[#fffdf8] p-5"
                          >
                            <div className="flex items-center justify-between">
                              <p className="text-sm font-semibold text-[#141413]">新增代理组</p>
                              <Button
                                variant="ghost"
                                onClick={() =>
                                  setGroupVisualItems((current) =>
                                    current.filter((candidate) => candidate.id !== item.id)
                                  )
                                }
                              >
                                <Trash2 className="size-4" />
                                移除
                              </Button>
                            </div>
                            <div className="mt-4">
                              <ProxyGroupOperationForm
                                rawText={item.rawText}
                                onChange={(nextRawText) =>
                                  setGroupVisualItems((current) =>
                                    current.map((candidate) =>
                                      candidate.id === item.id
                                        ? {
                                            ...candidate,
                                            rawText: nextRawText
                                          }
                                        : candidate
                                    )
                                  )
                                }
                              />
                            </div>
                          </div>
                        ))}
                    </div>

                    <div className="grid gap-4 xl:grid-cols-3">
                      <label className="block space-y-2">
                        <span className="text-sm font-medium text-[#5f5e58]">前置规则</span>
                        <Textarea
                          value={prependRulesText}
                          onChange={(event) => setPrependRulesText(event.target.value)}
                          className="min-h-52 font-mono text-xs"
                          placeholder="每行一条规则"
                        />
                      </label>
                      <label className="block space-y-2">
                        <span className="text-sm font-medium text-[#5f5e58]">后置规则</span>
                        <Textarea
                          value={appendRulesText}
                          onChange={(event) => setAppendRulesText(event.target.value)}
                          className="min-h-52 font-mono text-xs"
                          placeholder="每行一条规则"
                        />
                      </label>
                      <label className="block space-y-2">
                        <span className="text-sm font-medium text-[#5f5e58]">移除规则</span>
                        <Textarea
                          value={removeRulesText}
                          onChange={(event) => setRemoveRulesText(event.target.value)}
                          className="min-h-52 font-mono text-xs"
                          placeholder="每行一条需要移除的源规则"
                        />
                      </label>
                    </div>
                  </>
                )}
              </div>
            )}

            <div className="flex items-center justify-between">
              <Button variant="ghost" onClick={() => setActiveStep("proxies")}>
                <ArrowLeft className="size-4" />
                返回上一步
              </Button>
              <div className="flex gap-3">
                <Button
                  variant="secondary"
                  disabled={busyAction === "save-groups-rules"}
                  onClick={() => void handleSaveGroupsRules()}
                >
                  <Save className="size-4" />
                  仅保存
                </Button>
                <Button
                  disabled={busyAction === "save-groups-rules"}
                  onClick={() => void handleSaveGroupsRules("settings")}
                >
                  <ArrowRight className="size-4" />
                  保存并继续
                </Button>
              </div>
            </div>
          </div>
        </Card>
      ) : null}

      {activeStep === "settings" ? (
        <Card className="rounded-lg p-6">
          <div className="space-y-6">
            <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
              <div>
                <p className="text-sm font-medium text-[#9c9a92]">第 4 步</p>
                <h4 className="mt-2 text-xl font-semibold text-[#141413]">
                  编辑其他配置项
                </h4>
                <p className="mt-2 text-sm text-[#73726c]">
                  建议先处理常用顶层设置，复杂嵌套配置可以切换到 RAW 模式。
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-3">
                <Select
                  value={settingsPatchMode}
                  onValueChange={(value) => setSettingsPatchMode(value as PatchMode)}
                >
                  <SelectTrigger className="w-[170px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="patch">Patch 模式</SelectItem>
                    <SelectItem value="full_override">Full Overrides</SelectItem>
                  </SelectContent>
                </Select>

                <Tabs
                  value={settingsEditorMode}
                  onValueChange={(value) => setSettingsEditorMode(value as EditorMode)}
                >
                  <TabsList>
                    <TabsTrigger value="visual">可视化</TabsTrigger>
                    <TabsTrigger value="raw">RAW</TabsTrigger>
                  </TabsList>
                </Tabs>
              </div>
            </div>

            {settingsEditorMode === "raw" ? (
              <Textarea
                value={settingsRawText}
                onChange={(event) => setSettingsRawText(event.target.value)}
                className="min-h-[420px] font-mono text-xs"
              />
            ) : (
              <div className="space-y-6">
                <div className="grid gap-4 xl:grid-cols-4">
                  {Object.entries(settingsForm).map(([key, value]) => (
                    <label key={key} className="block space-y-2">
                      <span className="text-sm font-medium text-[#5f5e58]">{key}</span>
                      <Input
                        value={value}
                        onChange={(event) =>
                          setSettingsForm((current) => ({
                            ...current,
                            [key]: event.target.value
                          }))
                        }
                        placeholder={`设置 ${key}`}
                      />
                    </label>
                  ))}
                </div>

                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <h5 className="text-lg font-semibold text-[#141413]">额外配置项</h5>
                    <Button
                      variant="secondary"
                      onClick={() =>
                        setSettingPairs((current) => [
                          ...current,
                          {
                            id: buildId("setting"),
                            key: "",
                            valueText: ""
                          }
                        ])
                      }
                    >
                      <Plus className="size-4" />
                      新增配置项
                    </Button>
                  </div>

                  <div className="space-y-4">
                    {settingPairs.map((pair) => (
                      <div
                        key={pair.id}
                        className="grid gap-3 rounded-lg border border-[#dedcd1] bg-[#f5f4ed]/80 p-4 xl:grid-cols-[minmax(180px,0.6fr)_minmax(0,1fr)_auto]"
                      >
                        <Input
                          value={pair.key}
                          onChange={(event) =>
                            setSettingPairs((current) =>
                              current.map((item) =>
                                item.id === pair.id
                                  ? {
                                      ...item,
                                      key: event.target.value
                                    }
                                  : item
                              )
                            )
                          }
                          placeholder="配置项键名"
                        />
                        <Textarea
                          value={pair.valueText}
                          onChange={(event) =>
                            setSettingPairs((current) =>
                              current.map((item) =>
                                item.id === pair.id
                                  ? {
                                      ...item,
                                      valueText: event.target.value
                                    }
                                  : item
                              )
                            )
                          }
                          className="min-h-28 font-mono text-xs"
                          placeholder='支持直接写 JSON，例如 {"enable":true}'
                        />
                        <Button
                          variant="ghost"
                          onClick={() =>
                            setSettingPairs((current) =>
                              current.filter((item) => item.id !== pair.id)
                            )
                          }
                        >
                          <Trash2 className="size-4" />
                          删除
                        </Button>
                      </div>
                    ))}
                  </div>
                </div>

                {settingsPatchMode === "patch" ? (
                  <label className="block space-y-2">
                    <span className="text-sm font-medium text-[#5f5e58]">移除源配置项</span>
                    <Textarea
                      value={unsetKeysText}
                      onChange={(event) => setUnsetKeysText(event.target.value)}
                      className="min-h-32 font-mono text-xs"
                      placeholder="每行一个顶层配置键名"
                    />
                  </label>
                ) : (
                  <div className="rounded-lg border border-[#dedcd1] bg-[#f5f4ed]/80 px-4 py-3 text-sm text-[#73726c]">
                    Full Overrides 下会将这里填写的配置作为最终顶层设置，未填写的键不会保留。
                  </div>
                )}
              </div>
            )}

            <div className="flex items-center justify-between">
              <Button variant="ghost" onClick={() => setActiveStep("groups_rules")}>
                <ArrowLeft className="size-4" />
                返回上一步
              </Button>
              <div className="flex gap-3">
                <Button
                  variant="secondary"
                  disabled={busyAction === "save-settings"}
                  onClick={() => void handleSaveSettings()}
                >
                  <Save className="size-4" />
                  仅保存
                </Button>
                <Button
                  disabled={busyAction === "save-settings"}
                  onClick={() => void handleSaveSettings("preview")}
                >
                  <ArrowRight className="size-4" />
                  保存并继续
                </Button>
              </div>
            </div>
          </div>
        </Card>
      ) : null}

      {activeStep === "preview" ? (
        <div className="grid gap-6 xl:grid-cols-[minmax(0,1.3fr)_360px]">
          <Card className="rounded-lg p-6">
            <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
              <div>
                <p className="text-sm font-medium text-[#9c9a92]">第 5 步</p>
                <h4 className="mt-2 text-xl font-semibold text-[#141413]">
                  预览最终生成的 Mihomo 配置
                </h4>
              </div>
              <div className="flex gap-3">
                <Button
                  variant="secondary"
                  disabled={busyAction === "extract-template"}
                  onClick={() => void handleExtractTemplate(false)}
                >
                  <Sparkles className="size-4" />
                  沉淀为模板
                </Button>
                <Button
                  variant="secondary"
                  disabled={busyAction === "extract-template"}
                  onClick={() => void handleExtractTemplate(true)}
                >
                  <Sparkles className="size-4" />
                  提炼脱敏模板
                </Button>
                <Button
                  variant="secondary"
                  disabled={busyAction === "preview"}
                  onClick={() => void handlePreview()}
                >
                  <RefreshCw className="size-4" />
                  更新预览
                </Button>
                {preview?.yamlText ? (
                  <Button
                    variant="ghost"
                    onClick={() => {
                      void copyText(preview.yamlText);
                      setFeedbackMessage("预览 YAML 已复制。");
                    }}
                  >
                    <Copy className="size-4" />
                    复制 YAML
                  </Button>
                ) : null}
              </div>
            </div>

            <div className="mt-5 flex flex-wrap gap-3">
              <Badge className={shareabilityTone[preview?.shareabilityStatus ?? "unknown"]}>
                {shareabilityText[preview?.shareabilityStatus ?? draft?.shareabilityStatus ?? "unknown"]}
              </Badge>
              {preview ? <Badge>{preview.stats.proxyCount} 个节点</Badge> : null}
              {preview ? <Badge>{preview.stats.groupCount} 个代理组</Badge> : null}
              {preview ? <Badge>{preview.stats.ruleCount} 条规则</Badge> : null}
            </div>

            {preview?.lockedReasons?.length ? (
              <div className="mt-5 rounded-lg border border-[#d1a041]/40 bg-[#f6eedf] p-4 text-sm text-[#5a4815]">
                <p className="font-medium">当前草稿已锁定到这个外部订阅：</p>
                <div className="mt-2 space-y-1">
                  {preview.lockedReasons.map((reason) => (
                    <p key={reason}>- {reason}</p>
                  ))}
                </div>
              </div>
            ) : null}

            <Textarea
              value={preview?.yamlText ?? draft?.lastPreviewYaml ?? ""}
              readOnly
              className="mt-6 min-h-[620px] font-mono text-xs"
            />
          </Card>

          <div className="space-y-6">
            <Card className="rounded-lg p-6">
              <h4 className="text-xl font-semibold text-[#141413]">发布设置</h4>
                <p className="mt-2 text-sm text-[#73726c]">
                发布后会立即完成首次生成，并为该扩展订阅保留后续刷新能力。
              </p>

              <div className="mt-6 space-y-4">
                <label className="block space-y-2">
                  <span className="text-sm font-medium text-[#5f5e58]">可见性</span>
                  <Select
                    value={publishVisibility}
                    onValueChange={(value) => setPublishVisibility(value as Visibility)}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="private">私有</SelectItem>
                      <SelectItem value="unlisted">凭链接访问</SelectItem>
                      <SelectItem value="public">公开</SelectItem>
                    </SelectContent>
                  </Select>
                </label>

                <label className="block space-y-2">
                  <span className="text-sm font-medium text-[#5f5e58]">共享方式</span>
                  <Select
                    value={publishShareMode}
                    onValueChange={(value) => setPublishShareMode(value as ShareMode)}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="disabled">不共享</SelectItem>
                      <SelectItem value="view">仅查看</SelectItem>
                      <SelectItem value="fork">允许复用</SelectItem>
                    </SelectContent>
                  </Select>
                </label>

                <label className="flex items-center gap-3 rounded-lg border border-[#dedcd1] bg-[#f5f4ed]/80 px-4 py-3 text-sm text-[#5f5e58]">
                  <input
                    type="checkbox"
                    checked={publishEnabled}
                    onChange={(event) => setPublishEnabled(event.target.checked)}
                    className="size-4 rounded border-[#c9c6ba] accent-[#c96442]"
                  />
                  发布后立即启用
                </label>
              </div>

                <Button
                  className="mt-6 w-full"
                  disabled={busyAction === "publish"}
                  onClick={() => void handlePublish()}
                >
                <Sparkles className="size-4" />
                发布扩展订阅
              </Button>
            </Card>

            {publishedSubscription ? (
              <Card className="rounded-lg p-6">
                <h4 className="text-xl font-semibold text-[#141413]">
                  已发布的扩展订阅
                </h4>
                <div className="mt-4 space-y-2 text-sm text-[#73726c]">
                  <p>名称：{publishedSubscription.displayName}</p>
                  <p>可见性：{visibilityText[publishedSubscription.visibility]}</p>
                  <p>共享方式：{shareModeText[publishedSubscription.shareMode]}</p>
                  <p>最近生成：{formatTime(publishedSubscription.lastRenderAt)}</p>
                </div>

                <div className="mt-6 grid gap-3">
                  <Button variant="secondary" onClick={() => void handleCopyTempLink()}>
                    <Copy className="size-4" />
                    复制临时拉取链接
                  </Button>
                  <Button
                    variant="ghost"
                    onClick={() => {
                      const hours = Number(window.prompt("短期 Key 有效小时数", "24"));
                      const normalizedHours = Number.isFinite(hours) && hours > 0 ? hours : 24;
                      void handleCopyTempLink(Math.round(normalizedHours * 60 * 60));
                    }}
                  >
                    <Copy className="size-4" />
                    自定义短期 Key
                  </Button>
                  <Button
                    variant="ghost"
                    onClick={() => {
                      void navigate({
                        to: "/subscriptions"
                      });
                    }}
                  >
                    返回订阅列表
                  </Button>
                </div>
              </Card>
            ) : null}

            {extractedTemplateId ? (
              <Card className="rounded-lg p-6">
                <h4 className="text-xl font-semibold text-[#141413]">已提炼模板</h4>
                <p className="mt-2 text-sm text-[#73726c]">
                  当前草稿已经生成一个可继续编辑的模板副本。
                </p>
                <div className="mt-4">
                  <Button
                    variant="secondary"
                    onClick={() => {
                      void navigate({
                        to: "/templates"
                      });
                    }}
                  >
                    打开模板中心
                  </Button>
                </div>
              </Card>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
};
