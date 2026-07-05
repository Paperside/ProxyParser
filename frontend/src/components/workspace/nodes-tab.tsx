import { useState } from "react";
import { X } from "lucide-react";
import { toast } from "sonner";

import type { NodeTransform } from "../../lib/build-config-types";
import { useSecretMutations } from "../../lib/hooks";
import type { NodeIndexEntry } from "../../lib/types";
import { SectionTitle } from "../shared";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Card } from "../ui/card";
import { Dialog, DialogContent, DialogFooter } from "../ui/dialog";
import { Field, Input } from "../ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui/select";
import { Textarea } from "../ui/textarea";
import { useWorkspace } from "./context";

const TRANSFORM_LABEL: Record<string, string> = {
  "strip-emoji": "去 emoji",
  "strip-multiplier": "去倍率标签",
  "trim-whitespace": "整理空白"
};

const REGIONS = ["HK", "TW", "JP", "US", "SG", "KR"];

const AddCustomNodeDialog = ({ onClose }: { onClose: () => void }) => {
  const { update } = useWorkspace();
  const secrets = useSecretMutations();
  const [form, setForm] = useState({ name: "", type: "trojan", server: "", port: "443" });
  const [secretJson, setSecretJson] = useState('{\n  "password": ""\n}');
  const [extraJson, setExtraJson] = useState('{\n  "skip-cert-verify": false\n}');

  const submit = async () => {
    let secretFields: Record<string, unknown> | null = null;
    let extra: Record<string, unknown> = {};
    try {
      const parsed = JSON.parse(secretJson) as Record<string, unknown>;
      if (Object.keys(parsed).length > 0 && Object.values(parsed).some((v) => v !== "")) {
        secretFields = parsed;
      }
    } catch {
      toast.error("敏感字段不是合法 JSON");
      return;
    }
    try {
      extra = JSON.parse(extraJson) as Record<string, unknown>;
    } catch {
      toast.error("其他字段不是合法 JSON");
      return;
    }
    const port = Number(form.port);
    if (!form.name || !form.server || !Number.isInteger(port)) {
      toast.error("请填写名称、服务器与端口");
      return;
    }
    let secretRef: string | null = null;
    if (secretFields) {
      const created = await secrets.create.mutateAsync(secretFields);
      secretRef = created.secretRef;
    }
    update((draft) => {
      draft.nodes.custom.push({
        id: `cn_${crypto.randomUUID().replaceAll("-", "").slice(0, 16)}`,
        name: form.name,
        type: form.type,
        server: form.server,
        port,
        secretRef,
        extra
      });
    });
    toast.success("自建节点已加入草稿");
    onClose();
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent title="新增自建节点" description="敏感字段（密码 / UUID / 私钥）单独加密存储，不会出现在模板与分享中。">
        <div className="grid grid-cols-2 gap-3.5">
          <Field label="名称">
            <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Home VPS" />
          </Field>
          <Field label="协议">
            <Select value={form.type} onValueChange={(type) => setForm({ ...form, type })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {["trojan", "ss", "vmess", "vless", "hysteria2", "tuic"].map((type) => (
                  <SelectItem key={type} value={type}>{type}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="服务器">
            <Input value={form.server} onChange={(e) => setForm({ ...form, server: e.target.value })} placeholder="example.com" />
          </Field>
          <Field label="端口">
            <Input value={form.port} onChange={(e) => setForm({ ...form, port: e.target.value })} />
          </Field>
        </div>
        <div className="mt-3.5 flex flex-col gap-3.5">
          <Field label="敏感字段（JSON）" hint="如 password / uuid / private-key，加密存储">
            <Textarea value={secretJson} onChange={(e) => setSecretJson(e.target.value)} className="min-h-20" />
          </Field>
          <Field label="其他字段（JSON）" hint="如 sni / skip-cert-verify / network 等非敏感参数">
            <Textarea value={extraJson} onChange={(e) => setExtraJson(e.target.value)} className="min-h-20" />
          </Field>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>取消</Button>
          <Button variant="primary" onClick={() => void submit()}>加入草稿</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

const RenameDialog = ({ node, onClose }: { node: NodeIndexEntry; onClose: () => void }) => {
  const { update } = useWorkspace();
  const [name, setName] = useState(node.renderedName);
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent title={`改名：${node.renderedName}`} description="节点以稳定 ID 追踪，改名不影响组内引用；上游改名/换凭据也不会丢失此设置。">
        <Field label="显示名称">
          <Input autoFocus value={name} onChange={(event) => setName(event.target.value)} />
        </Field>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>取消</Button>
          <Button
            variant="primary"
            onClick={() => {
              update((draft) => {
                const existing = draft.nodes.overrides.find((o) => o.nodeId === node.id);
                if (existing) existing.rename = name;
                else draft.nodes.overrides.push({ nodeId: node.id, rename: name });
              });
              onClose();
            }}
          >
            保存
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export const NodesTab = () => {
  const { config, update, preview, detail } = useWorkspace();
  const [showAdd, setShowAdd] = useState(false);
  const [renaming, setRenaming] = useState<NodeIndexEntry | null>(null);

  const nodes = preview?.nodeIndex ?? [];

  const toggleTransform = (kind: NodeTransform["kind"]) => {
    update((draft) => {
      const index = draft.nodes.transforms.findIndex((transform) => transform.kind === kind);
      if (index >= 0) draft.nodes.transforms.splice(index, 1);
      else draft.nodes.transforms.push({ kind } as NodeTransform);
    });
  };

  const setDisabled = (node: NodeIndexEntry, disabled: boolean) => {
    update((draft) => {
      const existing = draft.nodes.overrides.find((o) => o.nodeId === node.id);
      if (existing) existing.disabled = disabled;
      else draft.nodes.overrides.push({ nodeId: node.id, disabled });
    });
  };

  const confirmRegion = (node: NodeIndexEntry) => {
    if (!node.region) return;
    update((draft) => {
      const existing = draft.nodes.overrides.find((o) => o.nodeId === node.id);
      const tags = [...new Set([...(existing?.tags ?? []), node.region!])];
      if (existing) existing.tags = tags;
      else draft.nodes.overrides.push({ nodeId: node.id, tags });
    });
  };

  const removeCustom = (nodeId: string) => {
    update((draft) => {
      draft.nodes.custom = draft.nodes.custom.filter((node) => node.id !== nodeId);
    });
  };

  return (
    <div>
      <SectionTitle
        title="节点"
        desc={`${nodes.filter((n) => n.sourceId !== null).length} 个原生节点（${detail.sourceNames.join("、")}）+ ${config.nodes.custom.length} 个自建。默认原样展示，只有你主动添加的转换会生效。`}
        actions={<Button size="sm" onClick={() => setShowAdd(true)}>新增自建节点</Button>}
      />

      <div className="mb-3 flex flex-wrap items-center gap-2 rounded-[10px] border border-line bg-surface px-3.5 py-2.5">
        <span className="text-xs text-faint">持续转换（自动作用于未来新节点）：</span>
        {(["strip-emoji", "strip-multiplier", "trim-whitespace"] as const).map((kind) => {
          const active = config.nodes.transforms.some((transform) => transform.kind === kind);
          return (
            <button
              key={kind}
              className={`inline-flex items-center gap-1.5 rounded border px-2 py-0.5 text-xs ${
                active
                  ? "border-accent-strong bg-accent-bg text-accent"
                  : "border-line-strong bg-surface2 text-muted"
              }`}
              onClick={() => toggleTransform(kind)}
            >
              {TRANSFORM_LABEL[kind]}
              {active ? <X className="size-3" /> : "+"}
            </button>
          );
        })}
      </div>

      <Card className="p-0">
        <table className="w-full border-collapse text-[12.5px]">
          <thead>
            <tr className="text-left text-[11.5px] text-faint">
              <th className="border-b border-line px-3 py-2 font-medium">显示名称</th>
              <th className="border-b border-line px-3 py-2 font-medium">来源</th>
              <th className="border-b border-line px-3 py-2 font-medium">协议</th>
              <th className="border-b border-line px-3 py-2 font-medium">地区</th>
              <th className="w-40 border-b border-line px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {nodes.map((node) => {
              const override = config.nodes.overrides.find((o) => o.nodeId === node.id);
              const isCustom = node.sourceId === null;
              return (
                <tr key={node.id} className={`hover:bg-surface2/45 ${node.disabled ? "opacity-50" : ""}`}>
                  <td className="border-b border-line px-3 py-1.5">
                    <span className={`font-mono text-xs ${node.disabled ? "line-through" : ""}`}>
                      {node.renderedName}
                    </span>
                    {override?.rename ? <Badge className="ml-1.5 text-[10px]">已改名</Badge> : null}
                    {isCustom ? <Badge variant="accent" className="ml-1.5 text-[10px]">自建</Badge> : null}
                  </td>
                  <td className="border-b border-line px-3 py-1.5 text-muted">
                    {isCustom ? "我" : detail.sourceNames[0] ?? "源"}
                  </td>
                  <td className="border-b border-line px-3 py-1.5">
                    <Badge variant="mono">{node.protocol}</Badge>
                  </td>
                  <td className="border-b border-line px-3 py-1.5">
                    {node.region ? (
                      <Badge className={node.regionInferred ? "badge-inferred" : ""}>
                        {node.region}
                        {node.regionInferred ? " · 推断" : " · 已确认"}
                      </Badge>
                    ) : (
                      <span className="text-faint">—</span>
                    )}
                  </td>
                  <td className="border-b border-line px-3 py-1.5">
                    <div className="flex justify-end gap-1">
                      {node.region && node.regionInferred && !isCustom ? (
                        <Button size="sm" variant="ghost" title="确认地区标签" onClick={() => confirmRegion(node)}>
                          确认
                        </Button>
                      ) : null}
                      {!isCustom ? (
                        <>
                          <Button size="sm" variant="ghost" onClick={() => setRenaming(node)}>
                            改名
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => setDisabled(node, !node.disabled)}>
                            {node.disabled ? "启用" : "禁用"}
                          </Button>
                        </>
                      ) : (
                        <Button size="sm" variant="ghost" onClick={() => removeCustom(node.id)}>
                          移除
                        </Button>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
            {nodes.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-3 py-6 text-center text-xs text-faint">
                  {preview ? "没有可用节点——检查订阅源是否同步成功。" : "等待预览渲染…"}
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </Card>
      <p className="mt-2.5 text-[11.5px] text-faint">
        虚线徽章为系统推断（仅用于生成地区组），不会修改你的数据；「确认」后转为你的标签。
      </p>

      {showAdd ? <AddCustomNodeDialog onClose={() => setShowAdd(false)} /> : null}
      {renaming ? <RenameDialog node={renaming} onClose={() => setRenaming(null)} /> : null}
    </div>
  );
};
