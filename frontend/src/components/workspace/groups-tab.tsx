import { useState, type ReactNode } from "react";
import { ChevronDown, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { cn } from "../../lib/cn";

import type { CustomGroup, GroupMember } from "../../lib/build-config-types";
import { COMMON_REGION_CODES, REGION_CODES, regionLabel } from "../../lib/regions";
import { SectionTitle } from "../shared";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Card } from "../ui/card";
import { Dialog, DialogContent, DialogFooter } from "../ui/dialog";
import { Field, Input } from "../ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui/select";
import { DragHandle, SortableList } from "../ui/sortable-list";
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
          return `${regionLabel(member.selector.region)} 地区节点`;
        case "tag":
          return `标签 ${member.selector.tag}`;
        case "protocol":
          return `协议 ${member.selector.protocol}`;
      }
  }
};

// 统一的「可展开代理组条」：Proxies/地区组（生成器产物，只读）与自定义组（Apple/BiliBili 等）
// 用同一套视觉与交互——头部一行 bar，点击展开查看渲染后的完整成员列表。
const ExpandableGroupBar = ({
  name,
  typeLabel,
  countLabel,
  badge,
  proxies,
  actions,
  emptyHint,
  dragHandle
}: {
  name: string;
  typeLabel: string;
  countLabel?: string;
  badge?: string;
  proxies: string[];
  actions?: ReactNode;
  emptyHint?: string;
  dragHandle?: ReactNode;
}) => {
  const [open, setOpen] = useState(false);
  return (
    <Card className="py-3" role="group" aria-label={`代理组 ${name}`}>
      <div className="flex items-center gap-2.5">
        {dragHandle}
        <button
          type="button"
          className="flex min-w-0 items-center gap-1.5 text-left"
          onClick={() => setOpen((o) => !o)}
        >
          <ChevronDown className={cn("size-3.5 shrink-0 text-faint transition-transform", open ? "rotate-180" : "-rotate-90")} />
          <span className="truncate text-[13px] font-semibold">{name}</span>
        </button>
        <Badge variant="mono">{typeLabel}</Badge>
        {badge ? <Badge variant="accent">{badge}</Badge> : null}
        <span className="text-[11px] text-faint">{countLabel ?? `${proxies.length} 项`}</span>
        {actions ? <span className="ml-auto flex gap-1.5">{actions}</span> : null}
      </div>
      {open ? (
        <div className="mt-2 flex flex-wrap gap-1.5 border-t border-line pt-2">
          {proxies.length > 0 ? (
            proxies.map((proxy, index) => (
              <span
                key={`${proxy}-${index}`}
                className="rounded border border-line-strong bg-bg px-1.5 py-0.5 font-mono text-[11px] text-muted"
              >
                {proxy}
              </span>
            ))
          ) : (
            <p className="text-xs text-faint">{emptyHint ?? "暂无成员。"}</p>
          )}
        </div>
      ) : null}
    </Card>
  );
};

// 组成员选择器：节点 / 组 / 抽象集合 / 内置目标 四类（v0.2 §7.3 标准成员配置）
const MemberPicker = ({ onAdd }: { onAdd: (member: GroupMember) => void }) => {
  const { workspaceIndex, knownGroupNames } = useWorkspace();
  const [kind, setKind] = useState("selector");
  const [value, setValue] = useState("all-enabled");

  const options = (() => {
    switch (kind) {
      case "selector":
        return [
          { value: "all-enabled", label: "所有启用节点" },
          { value: "custom-only", label: "全部自建节点" },
          ...REGION_CODES.map((region) => ({
            value: `region:${region}`,
            label: `${regionLabel(region)} 地区节点`
          }))
        ];
      case "group":
        return knownGroupNames
          .filter(
            (name) =>
              !REGION_GROUP_NAME_SET.has(name) ||
              workspaceIndex === null ||
              workspaceIndex.groupIndex.some((group) => group.name === name)
          )
          .map((name) => ({ value: name, label: name }));
      case "builtin":
        return BUILTIN_POLICY_OPTIONS.map((option) => ({ value: option.value, label: option.label }));
      case "node":
        return (workspaceIndex?.nodeIndex ?? [])
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

interface MemberRow {
  id: string;
  member: GroupMember;
}

const toMemberRows = (members: GroupMember[]): MemberRow[] =>
  members.map((member) => ({ id: crypto.randomUUID(), member }));

const REGION_CODE_SET = new Set(REGION_CODES);
const COMMON_REGION_CODE_SET = new Set<string>(COMMON_REGION_CODES);
const REGION_GROUP_NAME_SET = new Set([...REGION_CODES, "Others"]);

const hiddenRegionGroupNames = (
  commonScope: boolean,
  currentGroupNames: ReadonlySet<string> | null
): Set<string> =>
  new Set(
    [...REGION_GROUP_NAME_SET].filter(
      (name) =>
        (commonScope && REGION_CODE_SET.has(name) && !COMMON_REGION_CODE_SET.has(name)) ||
        (currentGroupNames !== null && !currentGroupNames.has(name))
    )
  );

// 常用地区只是当前的渲染视图；切换范围不应破坏原有完整地区配置。
// 编辑时将未展示的地区成员留在原始槽位，可见成员仍可自由删除/排序/新增。
const restoreHiddenMembers = (
  visibleMembers: GroupMember[],
  originalMembers: GroupMember[],
  isHidden: (member: GroupMember) => boolean
): GroupMember[] => {
  let visibleCursor = 0;
  const restored: GroupMember[] = [];
  for (const original of originalMembers) {
    if (isHidden(original)) {
      restored.push(original);
      continue;
    }
    const replacement = visibleMembers[visibleCursor++];
    if (replacement) restored.push(replacement);
  }
  restored.push(...visibleMembers.slice(visibleCursor));
  return restored;
};

const GroupEditorDialog = ({
  initial,
  onClose
}: {
  initial: CustomGroup | null;
  onClose: () => void;
}) => {
  const { config, update, workspaceIndex, editingLocked } = useWorkspace();
  const regionGenerator = config.groups.generators.find((generator) => generator.kind === "region-groups");
  const commonRegionScope = regionGenerator?.kind === "region-groups" && regionGenerator.scope === "common";
  const originalMembers = initial?.members ?? [];
  // 弹窗打开时固定当前生效集合，避免保存期间 workspace index 刷新导致成员被错位合并。
  const [hiddenRegionNames] = useState(() =>
    hiddenRegionGroupNames(
      commonRegionScope,
      workspaceIndex === null
        ? null
        : new Set(workspaceIndex.groupIndex.map((group) => group.name))
    )
  );
  const isHiddenRegionMember = (member: GroupMember) =>
    member.kind === "group" && hiddenRegionNames.has(member.name);
  const hiddenRegionMemberCount = originalMembers.filter(isHiddenRegionMember).length;
  const [name, setName] = useState(initial?.name ?? "");
  const [type, setType] = useState<CustomGroup["type"]>(initial?.type ?? "select");
  const [rows, setRows] = useState<MemberRow[]>(() =>
    toMemberRows(
      originalMembers.filter((member) => !isHiddenRegionMember(member))
    )
  );
  const isFinalTarget = initial !== null && config.rules.final.target === initial.name;

  const nodeName = (id: string) =>
    workspaceIndex?.nodeIndex.find((node) => node.id === id)?.renderedName ?? id.slice(0, 10);

  const save = () => {
    if (!name.trim()) {
      toast.error("请填写组名");
      return;
    }
    if (rows.length === 0) {
      toast.error("代理组至少需要一个成员");
      return;
    }
    const visibleMembers = rows.map((row) => row.member);
    const members = restoreHiddenMembers(
      visibleMembers,
      originalMembers,
      isHiddenRegionMember
    );
    const accepted = update((draft) => {
      const existingIndex = draft.groups.custom.findIndex((group) => group.name === (initial?.name ?? name));
      const nextGroup: CustomGroup = { name: name.trim(), type, members };
      if (existingIndex >= 0) {
        draft.groups.custom[existingIndex] = nextGroup;
        if (initial && initial.name !== nextGroup.name) {
          const previousName = initial.name;
          draft.groups.order = draft.groups.order.map((entry) =>
            entry === previousName ? nextGroup.name : entry
          );
          draft.rules.order = draft.rules.order.map((entry) =>
            entry === previousName ? nextGroup.name : entry
          );
          for (const block of draft.rules.targets) {
            if (block.target === previousName) block.target = nextGroup.name;
          }
          if (draft.rules.final.target === previousName) {
            draft.rules.final.target = nextGroup.name;
          }
          for (const group of draft.groups.custom) {
            for (const member of group.members) {
              if (member.kind === "group" && member.name === previousName) {
                member.name = nextGroup.name;
              }
            }
          }
        }
      } else {
        draft.groups.custom.push(nextGroup);
        draft.groups.order.push(nextGroup.name);
      }
    });
    if (accepted) {
      onClose();
    } else {
      toast.error("草稿已锁定，请先重新载入最新草稿。");
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        wide
        title={initial ? `编辑代理组：${initial.name}` : "新增代理组"}
        description={
          isFinalTarget
            ? "这是 MATCH 的兜底选择组；select 组的第一项是默认出口，可拖拽调整 Proxies / DIRECT 顺序。"
            : undefined
        }
      >
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
        <p className="mb-1.5 text-xs font-medium text-muted">
          成员（拖拽调整输出顺序）
          {type === "select" ? <span className="ml-1 font-normal text-faint">第一项为默认选择</span> : null}
        </p>
        {hiddenRegionMemberCount > 0 ? (
          <p className="mb-2 rounded border border-line bg-bg px-2.5 py-1.5 text-[11px] leading-5 text-faint">
            已隐藏 {hiddenRegionMemberCount} 个当前不生效的地区组引用，配置仍保留；当对应地区产生节点或切换范围后会自动恢复。
          </p>
        ) : null}
        <div className="mb-3">
          <SortableList
            items={rows}
            onReorder={setRows}
            className="flex flex-col gap-1"
            renderItem={(row, handle) => (
              <div className="flex items-center gap-2 rounded-md border border-line bg-bg px-2.5 py-1 text-[12.5px]">
                <DragHandle {...handle} />
                {memberLabel(row.member, nodeName)}
                {row.member.kind === "node" && row.member.nodeId.startsWith("n_") ? (
                  <Badge variant="warn" className="text-[10px]">原生节点引用不进模板</Badge>
                ) : null}
                <span className="ml-auto flex gap-0.5">
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setRows((current) => current.filter((item) => item.id !== row.id))}
                  >
                    <Trash2 className="size-3" />
                  </Button>
                </span>
              </div>
            )}
          />
          {rows.length === 0 ? <p className="text-xs text-faint">还没有成员。</p> : null}
        </div>
        <MemberPicker onAdd={(member) => setRows((current) => [...current, { id: crypto.randomUUID(), member }])} />
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>取消</Button>
          <Button variant="primary" disabled={editingLocked} onClick={save}>保存</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export const GroupsTab = () => {
  const { config, update, workspaceIndex } = useWorkspace();
  const [editing, setEditing] = useState<CustomGroup | null | "new">(null);

  const proxiesRoot = config.groups.generators.find((g) => g.kind === "proxies-root");
  const regionGen = config.groups.generators.find((g) => g.kind === "region-groups");

  const nodeName = (id: string) =>
    workspaceIndex?.nodeIndex.find((node) => node.id === id)?.renderedName ?? id.slice(0, 10);

  const customNames = new Set(config.groups.custom.map((group) => group.name));
  // 生成器产物（Proxies / Auto / 各地区组 / Others）：来自渲染后的真实结果，只读展示
  const generatedGroups = (workspaceIndex?.groupIndex ?? []).filter(
    (entry) => !customNames.has(entry.name)
  );

  const removeGroup = (name: string) => {
    if (config.rules.final.target === name) {
      toast.error(`「${name}」是当前 MATCH 兜底目标。请先在规则页更换兜底目标。`);
      return;
    }
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

  // 拖拽调整自定义组相对顺序：只重排 order 里属于自定义组的那些槽位，生成器产物的位置不受影响
  const reorderCustomGroups = (nextCustom: CustomGroup[]) => {
    update((draft) => {
      draft.groups.custom = nextCustom;
      const nextNames = nextCustom.map((group) => group.name);
      let cursor = 0;
      const customNameSet = new Set(nextNames);
      draft.groups.order = draft.groups.order.map((entry) =>
        customNameSet.has(entry) ? nextNames[cursor++]! : entry
      );
      for (const name of nextNames) {
        if (!draft.groups.order.includes(name)) draft.groups.order.push(name);
      }
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
                    draft.groups.generators.push({
                      kind: "region-groups",
                      groupType: "select",
                      unclassified: "others",
                      scope: "common"
                    });
                  } else {
                    draft.groups.generators = draft.groups.generators.filter((g) => g.kind !== "region-groups");
                  }
                })
              }
            />
            <span><strong>地区代理组</strong> — 按推断/确认的地区自动分组，节点页可手动纠正</span>
            {regionGen?.kind === "region-groups" ? (
              <span className="ml-auto flex flex-wrap items-center justify-end gap-2 text-muted">
                <label className="flex items-center gap-1.5">
                  范围
                  <Select
                    value={regionGen.scope ?? "full"}
                    onValueChange={(value) =>
                      update((draft) => {
                        const generator = draft.groups.generators.find((g) => g.kind === "region-groups");
                        if (generator?.kind === "region-groups")
                          generator.scope = value as "common" | "full";
                      })
                    }
                  >
                    <SelectTrigger aria-label="地区分组范围" className="h-6 w-52 text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem
                        value="common"
                        description="港/台/日/新/美/韩/英/德，其余进入 Others"
                      >
                        常用地区
                      </SelectItem>
                      <SelectItem value="full" description="覆盖约 50 个可识别国家和地区">
                        完整地区
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </label>
                <label className="flex items-center gap-1.5">
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
                  <SelectTrigger aria-label="未分类节点处理" className="h-6 w-28 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="others">归入 Others</SelectItem>
                    <SelectItem value="ignore">忽略</SelectItem>
                  </SelectContent>
                </Select>
                </label>
              </span>
            ) : null}
          </label>
        </div>
      </Card>

      {generatedGroups.length > 0 ? (
        <div className="mb-3 flex flex-col gap-2.5">
          <p className="text-xs font-medium text-muted">生成器产物（只读，随节点自动重算）</p>
          {generatedGroups.map((entry) => (
            <ExpandableGroupBar
              key={entry.name}
              name={entry.name}
              typeLabel={entry.type}
              badge="生成器"
              proxies={entry.proxies}
            />
          ))}
        </div>
      ) : null}

      {config.groups.custom.length > 0 ? (
        <SortableList
          items={config.groups.custom.map((group) => ({ ...group, id: group.name }))}
          onReorder={(next) => reorderCustomGroups(next.map(({ id: _id, ...group }) => group))}
          className="flex flex-col gap-2.5"
          renderItem={(group, handle) => {
            const rendered = workspaceIndex?.groupIndex.find((entry) => entry.name === group.name);
            return (
              <ExpandableGroupBar
                name={group.name}
                typeLabel={group.type}
                badge={config.rules.final.target === group.name ? "MATCH 兜底" : undefined}
                countLabel={rendered ? `${rendered.proxies.length} 项` : `${group.members.length} 条成员配置`}
                proxies={
                  rendered ? rendered.proxies : group.members.map((member) => memberLabel(member, nodeName))
                }
                emptyHint="代理组至少需要一个成员，点击「编辑」添加。"
                dragHandle={<DragHandle {...handle} />}
                actions={
                  <>
                    <Button size="sm" variant="ghost" onClick={() => setEditing(group)}>编辑</Button>
                    <Button size="sm" variant="ghost" onClick={() => removeGroup(group.name)}>删除</Button>
                  </>
                }
              />
            );
          }}
        />
      ) : (
        <p className="text-xs text-faint">还没有自定义代理组。AI、流媒体等服务分流组在这里创建。</p>
      )}

      {editing !== null ? (
        <GroupEditorDialog initial={editing === "new" ? null : editing} onClose={() => setEditing(null)} />
      ) : null}
    </div>
  );
};
