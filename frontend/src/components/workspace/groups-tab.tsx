import { useState } from "react";
import { ArrowDown, ArrowUp, Trash2 } from "lucide-react";
import { toast } from "sonner";

import type { CustomGroup, GroupMember } from "../../lib/build-config-types";
import { SectionTitle } from "../shared";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Card } from "../ui/card";
import { Dialog, DialogContent, DialogFooter } from "../ui/dialog";
import { Field, Input } from "../ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui/select";
import { BUILTIN_POLICY_OPTIONS, useWorkspace } from "./context";

const memberLabel = (member: GroupMember, nodeName: (id: string) => string): string => {
  switch (member.kind) {
    case "node":
      return nodeName(member.nodeId);
    case "group":
      return `组 ${member.name}`;
    case "builtin":
      return member.policy;
    case "selector":
      switch (member.selector.kind) {
        case "all-enabled":
          return "所有启用节点";
        case "custom-only":
          return "全部自建节点";
        case "region":
          return `${member.selector.region} 地区节点`;
        case "tag":
          return `标签 ${member.selector.tag}`;
        case "protocol":
          return `协议 ${member.selector.protocol}`;
      }
  }
};

// 组成员选择器：节点 / 组 / 抽象集合 / 内置目标 四类（v0.2 §7.3 标准成员配置）
const MemberPicker = ({ onAdd }: { onAdd: (member: GroupMember) => void }) => {
  const { preview, knownGroupNames } = useWorkspace();
  const [kind, setKind] = useState("selector");
  const [value, setValue] = useState("all-enabled");

  const options = (() => {
    switch (kind) {
      case "selector":
        return [
          { value: "all-enabled", label: "所有启用节点" },
          { value: "custom-only", label: "全部自建节点" },
          ...["HK", "TW", "JP", "US", "SG", "KR"].map((region) => ({
            value: `region:${region}`,
            label: `${region} 地区节点`
          }))
        ];
      case "group":
        return knownGroupNames.map((name) => ({ value: name, label: name }));
      case "builtin":
        return BUILTIN_POLICY_OPTIONS.map((option) => ({ value: option.value, label: option.label }));
      case "node":
        return (preview?.nodeIndex ?? [])
          .filter((node) => !node.disabled)
          .map((node) => ({ value: node.id, label: node.renderedName }));
      default:
        return [];
    }
  })();

  const buildMember = (): GroupMember | null => {
    switch (kind) {
      case "selector":
        if (value === "all-enabled") return { kind: "selector", selector: { kind: "all-enabled" } };
        if (value === "custom-only") return { kind: "selector", selector: { kind: "custom-only" } };
        if (value.startsWith("region:"))
          return { kind: "selector", selector: { kind: "region", region: value.slice(7) } };
        return null;
      case "group":
        return { kind: "group", name: value };
      case "builtin":
        return { kind: "builtin", policy: value as GroupMember extends never ? never : "DIRECT" } as GroupMember;
      case "node":
        return { kind: "node", nodeId: value };
      default:
        return null;
    }
  };

  return (
    <div className="flex items-end gap-2">
      <Field label="成员类型">
        <Select
          value={kind}
          onValueChange={(next) => {
            setKind(next);
            setValue(
              next === "selector" ? "all-enabled" : next === "builtin" ? "DIRECT" : ""
            );
          }}
        >
          <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="selector" description="随节点变化自动更新，可进模板">抽象集合</SelectItem>
            <SelectItem value="group" description="引用另一个代理组">代理组</SelectItem>
            <SelectItem value="builtin" description="DIRECT / REJECT 等">内置目标</SelectItem>
            <SelectItem value="node" description="固定节点；原生节点引用不进模板">具体节点</SelectItem>
          </SelectContent>
        </Select>
      </Field>
      <Field label="选择">
        <Select value={value} onValueChange={setValue}>
          <SelectTrigger className="w-52"><SelectValue placeholder="选择…" /></SelectTrigger>
          <SelectContent>
            {options.map((option) => (
              <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
      <Button
        size="sm"
        onClick={() => {
          const member = buildMember();
          if (member) onAdd(member);
        }}
      >
        添加
      </Button>
    </div>
  );
};

const GroupEditorDialog = ({
  initial,
  onClose
}: {
  initial: CustomGroup | null;
  onClose: () => void;
}) => {
  const { update, preview } = useWorkspace();
  const [name, setName] = useState(initial?.name ?? "");
  const [type, setType] = useState<CustomGroup["type"]>(initial?.type ?? "select");
  const [members, setMembers] = useState<GroupMember[]>(initial?.members ?? []);

  const nodeName = (id: string) =>
    preview?.nodeIndex.find((node) => node.id === id)?.renderedName ?? id.slice(0, 10);

  const save = () => {
    if (!name.trim()) {
      toast.error("请填写组名");
      return;
    }
    if (members.length === 0) {
      toast.error("代理组至少需要一个成员");
      return;
    }
    update((draft) => {
      const existingIndex = draft.groups.custom.findIndex((group) => group.name === (initial?.name ?? name));
      const nextGroup: CustomGroup = { name: name.trim(), type, members };
      if (existingIndex >= 0) {
        draft.groups.custom[existingIndex] = nextGroup;
        if (initial && initial.name !== nextGroup.name) {
          draft.groups.order = draft.groups.order.map((entry) =>
            entry === initial.name ? nextGroup.name : entry
          );
        }
      } else {
        draft.groups.custom.push(nextGroup);
        draft.groups.order.push(nextGroup.name);
      }
    });
    onClose();
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent wide title={initial ? `编辑代理组：${initial.name}` : "新增代理组"}>
        <div className="mb-4 grid grid-cols-2 gap-3.5">
          <Field label="组名">
            <Input value={name} onChange={(event) => setName(event.target.value)} placeholder="AI" />
          </Field>
          <Field label="类型">
            <Select value={type} onValueChange={(next) => setType(next as CustomGroup["type"])}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="select" description="手动选择出口">select</SelectItem>
                <SelectItem value="url-test" description="自动选延迟最低">url-test</SelectItem>
                <SelectItem value="fallback" description="按顺序故障转移">fallback</SelectItem>
                <SelectItem value="load-balance" description="负载均衡">load-balance</SelectItem>
              </SelectContent>
            </Select>
          </Field>
        </div>
        <p className="mb-1.5 text-xs font-medium text-muted">成员（按顺序输出）</p>
        <div className="mb-3 flex flex-col gap-1">
          {members.map((member, index) => (
            <div key={index} className="flex items-center gap-2 rounded-md border border-line bg-bg px-2.5 py-1 text-[12.5px]">
              <span className="font-mono text-[11px] text-faint">{index + 1}.</span>
              {memberLabel(member, nodeName)}
              {member.kind === "node" && member.nodeId.startsWith("n_") ? (
                <Badge variant="warn" className="text-[10px]">原生节点引用不进模板</Badge>
              ) : null}
              <span className="ml-auto flex gap-0.5">
                <Button size="sm" variant="ghost" disabled={index === 0} onClick={() => setMembers((current) => { const next = [...current]; [next[index - 1], next[index]] = [next[index]!, next[index - 1]!]; return next; })}>
                  <ArrowUp className="size-3" />
                </Button>
                <Button size="sm" variant="ghost" disabled={index === members.length - 1} onClick={() => setMembers((current) => { const next = [...current]; [next[index], next[index + 1]] = [next[index + 1]!, next[index]!]; return next; })}>
                  <ArrowDown className="size-3" />
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setMembers((current) => current.filter((_, i) => i !== index))}>
                  <Trash2 className="size-3" />
                </Button>
              </span>
            </div>
          ))}
          {members.length === 0 ? <p className="text-xs text-faint">还没有成员。</p> : null}
        </div>
        <MemberPicker onAdd={(member) => setMembers((current) => [...current, member])} />
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>取消</Button>
          <Button variant="primary" onClick={save}>保存</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export const GroupsTab = () => {
  const { config, update, preview } = useWorkspace();
  const [editing, setEditing] = useState<CustomGroup | null | "new">(null);

  const proxiesRoot = config.groups.generators.find((g) => g.kind === "proxies-root");
  const regionGen = config.groups.generators.find((g) => g.kind === "region-groups");

  const nodeName = (id: string) =>
    preview?.nodeIndex.find((node) => node.id === id)?.renderedName ?? id.slice(0, 10);

  const removeGroup = (name: string) => {
    const referenced = config.rules.targets.some((block) => block.target === name);
    if (referenced) {
      toast.error(`规则中存在指向「${name}」的块。请先在规则页处理它们，系统不会静默生成非法配置。`);
      return;
    }
    update((draft) => {
      draft.groups.custom = draft.groups.custom.filter((group) => group.name !== name);
      draft.groups.order = draft.groups.order.filter((entry) => entry !== name);
    });
  };

  return (
    <div className="max-w-3xl">
      <SectionTitle
        title="代理组"
        desc="生成器每次渲染重新求值，自动吸收上游节点增删；自定义组的成员在此编辑。"
        actions={<Button size="sm" onClick={() => setEditing("new")}>新增代理组</Button>}
      />

      <Card className="mb-3">
        <p className="mb-2 text-xs font-medium text-muted">生成器</p>
        <div className="flex flex-col gap-2 text-[12.5px]">
          <label className="flex items-center gap-2.5">
            <input
              type="checkbox"
              checked={Boolean(proxiesRoot)}
              onChange={(event) =>
                update((draft) => {
                  if (event.target.checked) {
                    draft.groups.generators.unshift({ kind: "proxies-root", name: "Proxies", includeAuto: true, extraMembers: [] });
                    if (!draft.groups.order.includes("Proxies")) draft.groups.order.unshift("Proxies");
                  } else {
                    draft.groups.generators = draft.groups.generators.filter((g) => g.kind !== "proxies-root");
                  }
                })
              }
            />
            <span><strong>Proxies 总组</strong> — 汇聚地区组、Auto 与全部节点的根选择组</span>
            {proxiesRoot?.kind === "proxies-root" ? (
              <label className="ml-4 flex items-center gap-1.5 text-muted">
                <input
                  type="checkbox"
                  checked={proxiesRoot.includeAuto}
                  onChange={(event) =>
                    update((draft) => {
                      const generator = draft.groups.generators.find((g) => g.kind === "proxies-root");
                      if (generator?.kind === "proxies-root") generator.includeAuto = event.target.checked;
                    })
                  }
                />
                含 Auto 测速组
              </label>
            ) : null}
          </label>
          <label className="flex items-center gap-2.5">
            <input
              type="checkbox"
              checked={Boolean(regionGen)}
              onChange={(event) =>
                update((draft) => {
                  if (event.target.checked) {
                    draft.groups.generators.push({ kind: "region-groups", groupType: "select", unclassified: "others" });
                  } else {
                    draft.groups.generators = draft.groups.generators.filter((g) => g.kind !== "region-groups");
                  }
                })
              }
            />
            <span><strong>地区代理组</strong> — 按推断/确认的地区自动分组（HK / TW / JP / US / SG / KR）</span>
            {regionGen?.kind === "region-groups" ? (
              <label className="ml-4 flex items-center gap-1.5 text-muted">
                未分类节点
                <Select
                  value={regionGen.unclassified}
                  onValueChange={(value) =>
                    update((draft) => {
                      const generator = draft.groups.generators.find((g) => g.kind === "region-groups");
                      if (generator?.kind === "region-groups")
                        generator.unclassified = value as "others" | "ignore";
                    })
                  }
                >
                  <SelectTrigger className="h-6 w-28 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="others">归入 Others</SelectItem>
                    <SelectItem value="ignore">忽略</SelectItem>
                  </SelectContent>
                </Select>
              </label>
            ) : null}
          </label>
        </div>
      </Card>

      <div className="flex flex-col gap-2.5">
        {config.groups.custom.map((group) => (
          <Card key={group.name} className="py-3">
            <div className="flex items-center gap-2.5">
              <span className="text-[13px] font-semibold">{group.name}</span>
              <Badge variant="mono">{group.type}</Badge>
              <span className="ml-auto flex gap-1.5">
                <Button size="sm" variant="ghost" onClick={() => setEditing(group)}>编辑</Button>
                <Button size="sm" variant="ghost" onClick={() => removeGroup(group.name)}>删除</Button>
              </span>
            </div>
            <p className="mt-1.5 text-xs text-muted">
              {group.members.map((member) => memberLabel(member, nodeName)).join(" · ")}
            </p>
          </Card>
        ))}
        {config.groups.custom.length === 0 ? (
          <p className="text-xs text-faint">还没有自定义代理组。AI、流媒体等服务分流组在这里创建。</p>
        ) : null}
      </div>

      {editing !== null ? (
        <GroupEditorDialog initial={editing === "new" ? null : editing} onClose={() => setEditing(null)} />
      ) : null}
    </div>
  );
};
