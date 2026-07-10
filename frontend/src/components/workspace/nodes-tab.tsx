import { useState } from "react";
import { X } from "lucide-react";

import type { CustomNode, NodeTransform } from "../../lib/build-config-types";
import { REGION_CODES, regionLabel } from "../../lib/regions";
import type { NodeIndexEntry } from "../../lib/types";
import { SectionTitle } from "../shared";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Card } from "../ui/card";
import { Dialog, DialogContent, DialogFooter } from "../ui/dialog";
import { Field, Input } from "../ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui/select";
import { CustomNodeDialog } from "./custom-node-dialog";
import { useWorkspace } from "./context";

const TRANSFORM_LABEL: Record<string, string> = {
  "strip-emoji": "去 emoji",
  "strip-multiplier": "去倍率标签",
  "trim-whitespace": "整理空白"
};

const CLEAR_REGION_SENTINEL = "__auto__";

const RenameDialog = ({ node, onClose }: { node: NodeIndexEntry; onClose: () => void }) => {
  const { update, editingLocked } = useWorkspace();
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
            disabled={editingLocked}
            onClick={() => {
              const accepted = update((draft) => {
                const existing = draft.nodes.overrides.find((o) => o.nodeId === node.id);
                if (existing) existing.rename = name;
                else draft.nodes.overrides.push({ nodeId: node.id, rename: name });
              });
              if (accepted) onClose();
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
  // "new"：新增弹窗；CustomNode：编辑该节点；null：不显示
  const [customDialog, setCustomDialog] = useState<"new" | CustomNode | null>(null);
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

  // 手动设置/清除节点地区标签：原生节点写 overrides.tags，自建节点写 custom.tags。
  // 标签优先于名称推断（见 evaluate.ts collectNodes），设置后不再被自动识别覆盖。
  const setRegion = (node: NodeIndexEntry, region: string | null) => {
    update((draft) => {
      if (node.sourceId === null) {
        const custom = draft.nodes.custom.find((n) => n.id === node.id);
        if (!custom) return;
        const others = (custom.tags ?? []).filter((tag) => !REGION_CODES.includes(tag));
        custom.tags = region ? [...others, region] : others;
        return;
      }
      const existing = draft.nodes.overrides.find((o) => o.nodeId === node.id);
      const others = (existing?.tags ?? []).filter((tag) => !REGION_CODES.includes(tag));
      const tags = region ? [...others, region] : others;
      if (existing) existing.tags = tags;
      else if (tags.length > 0) draft.nodes.overrides.push({ nodeId: node.id, tags });
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
        actions={<Button size="sm" onClick={() => setCustomDialog("new")}>新增自建节点</Button>}
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
                    <Select
                      value={node.regionInferred ? CLEAR_REGION_SENTINEL : node.region ?? CLEAR_REGION_SENTINEL}
                      onValueChange={(value) =>
                        setRegion(node, value === CLEAR_REGION_SENTINEL ? null : value)
                      }
                    >
                      <SelectTrigger className="h-6.5 w-auto min-w-24 gap-1.5 border-none bg-transparent px-1 text-[12.5px]" title="设置地区">
                        <SelectValue>
                          {node.region ? (
                            <Badge className={node.regionInferred ? "badge-inferred" : ""}>
                              {node.region}
                              {node.regionInferred ? " · 推断" : " · 已设置"}
                            </Badge>
                          ) : (
                            <span className="text-faint">未识别</span>
                          )}
                        </SelectValue>
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={CLEAR_REGION_SENTINEL}>
                          自动识别{node.regionInferred && node.region ? `（当前 ${node.region}）` : ""}
                        </SelectItem>
                        {REGION_CODES.map((code) => (
                          <SelectItem key={code} value={code}>
                            {regionLabel(code)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </td>
                  <td className="border-b border-line px-3 py-1.5">
                    <div className="flex justify-end gap-1">
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
                        <>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => {
                              const custom = config.nodes.custom.find((n) => n.id === node.id);
                              if (custom) setCustomDialog(custom);
                            }}
                          >
                            编辑
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => removeCustom(node.id)}>
                            移除
                          </Button>
                        </>
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
        虚线徽章为系统推断（仅用于生成地区组），不会修改你的数据；点击地区徽章可手动设置或清除标签，原生节点与自建节点均支持，设置后不再被自动识别覆盖。
      </p>

      {customDialog ? (
        <CustomNodeDialog
          node={customDialog === "new" ? undefined : customDialog}
          onClose={() => setCustomDialog(null)}
        />
      ) : null}
      {renaming ? <RenameDialog node={renaming} onClose={() => setRenaming(null)} /> : null}
    </div>
  );
};
