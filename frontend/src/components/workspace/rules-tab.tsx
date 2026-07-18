import { useState } from "react";
import { Plus, RefreshCw, Trash2 } from "lucide-react";
import { toast } from "sonner";

import type { RuleEntry, RuleItem } from "../../lib/build-config-types";
import { useRulesetMutations, useRulesets } from "../../lib/hooks";
import type { PasteParseReportDto, RulesetDirectoryEntry } from "../../lib/types";
import { RulesetDirectoryBrowser } from "../ruleset-directory-browser";
import { SectionTitle } from "../shared";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Dialog, DialogContent, DialogFooter } from "../ui/dialog";
import { Field, Input } from "../ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui/select";
import { DragHandle, SortableList } from "../ui/sortable-list";
import { Switch } from "../ui/switch";
import { Textarea } from "../ui/textarea";
import { BUILTIN_POLICY_OPTIONS, useWorkspace } from "./context";

const RULE_TYPES = [
  "DOMAIN",
  "DOMAIN-SUFFIX",
  "DOMAIN-KEYWORD",
  "IP-CIDR",
  "IP-CIDR6",
  "GEOSITE",
  "GEOIP",
  "PROCESS-NAME"
] as const;

// 导入规则源：ensure-snapshot 钉版本后写入块
const ImportRulesetDialog = ({ target, onClose }: { target: string; onClose: () => void }) => {
  const rulesets = useRulesets();
  const mutations = useRulesetMutations();
  const { update, editingLocked } = useWorkspace();
  const [busy, setBusy] = useState<string | null>(null);

  const pushToBlock = (catalogId: string, slug: string, hash: string, emit: "inline" | "provider") =>
    update((draft) => {
      let block = draft.rules.targets.find((candidate) => candidate.target === target);
      if (!block) {
        block = { target, items: [] };
        draft.rules.targets.push(block);
        draft.rules.order.push(target);
      }
      block.items.push({ kind: "snapshot", catalogId, slug, hash, emit });
    });

  const importOne = async (catalogId: string, slug: string) => {
    if (editingLocked) {
      toast.error("草稿已锁定，请先重新载入最新草稿。");
      return;
    }
    setBusy(catalogId);
    try {
      const snapshot = await mutations.ensureSnapshot.mutateAsync(catalogId);
      if (!pushToBlock(catalogId, slug, snapshot.hash, "provider")) {
        throw new Error("草稿在导入期间被锁定。请重新载入后再试。");
      }
      toast.success(`已导入 ${slug}（钉住 @${snapshot.hash.slice(0, 8)}）`);
      onClose();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "导入失败");
    } finally {
      setBusy(null);
    }
  };

  // 从扩展目录导入：先落库为自定义规则源，再直接钉版本写入当前块（一步到位）。
  // 目录条目大小未知，统一走 provider 引用，不做内联。
  const importFromDirectory = async (entry: RulesetDirectoryEntry) => {
    if (editingLocked) {
      toast.error("草稿已锁定，请先重新载入最新草稿。");
      return;
    }
    setBusy(entry.slug);
    try {
      const created = await mutations.importFromUrl.mutateAsync({
        name: entry.name,
        sourceUrl: entry.sourceUrl,
        behavior: entry.behavior
      });
      if (!created.latestSnapshotHash) {
        throw new Error("导入后没有可用快照。");
      }
      if (!pushToBlock(created.id, created.slug, created.latestSnapshotHash, "provider")) {
        throw new Error("草稿在导入期间被锁定。请重新载入后再试。");
      }
      toast.success(`已导入「${entry.name}」并加入「${target}」`);
      onClose();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "导入失败");
    } finally {
      setBusy(null);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent wide title={`导入规则源 → ${target}`} description="内容以钉版本快照进入配置；远端更新需要你在规则库中显式确认。">
        <div className="flex max-h-64 flex-col gap-1 overflow-y-auto">
          {(rulesets.data ?? []).map((entry) => (
            <div key={entry.id} className="flex items-center gap-2.5 rounded-md px-2 py-1.5 hover:bg-surface2">
              <span className="font-mono text-xs">{entry.slug}</span>
              <span className="text-xs text-faint">{entry.name}</span>
              {entry.recommendedTarget ? (
                <Badge variant="mono" className="text-[10px]">建议 → {entry.recommendedTarget}</Badge>
              ) : null}
              <Button
                size="sm"
                className="ml-auto"
                disabled={busy !== null || editingLocked}
                onClick={() => void importOne(entry.id, entry.slug)}
              >
                {busy === entry.id ? "钉版本中…" : "导入"}
              </Button>
            </div>
          ))}
        </div>
        <div className="mt-3 border-t border-line pt-3">
          <p className="mb-2 text-[11px] font-medium text-muted">从扩展目录发现更多规则组</p>
          <RulesetDirectoryBrowser
            onImport={(entry) => void importFromDirectory(entry)}
            busySlug={editingLocked ? "__locked__" : busy}
          />
        </div>
      </DialogContent>
    </Dialog>
  );
};

// 粘贴规则：解析 → 规范化报告确认 → 保存（v0.2 §8.5）
const PasteDialog = ({ target, onClose }: { target: string; onClose: () => void }) => {
  const mutations = useRulesetMutations();
  const { update, editingLocked } = useWorkspace();
  const [text, setText] = useState("");
  const [report, setReport] = useState<PasteParseReportDto | null>(null);

  const parse = () => {
    mutations.parsePaste
      .mutateAsync(text)
      .then(setReport)
      .catch((error: unknown) => toast.error(error instanceof Error ? error.message : "解析失败"));
  };

  const confirm = () => {
    if (!report) return;
    const accepted = update((draft) => {
      let block = draft.rules.targets.find((candidate) => candidate.target === target);
      if (!block) {
        block = { target, items: [] };
        draft.rules.targets.push(block);
        draft.rules.order.push(target);
      }
      block.items.push({ kind: "manual", entries: report.entries as RuleEntry[] });
    });
    if (!accepted) {
      toast.error("草稿已锁定，请先重新载入最新草稿。");
      return;
    }
    toast.success(`${report.entries.length} 条规则已加入「${target}」`);
    onClose();
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent wide title={`粘贴规则 → ${target}`} description="支持 Clash 规则行；目标由所在块决定，粘贴内容中的目标会被剥离。">
        {!report ? (
          <>
            <Textarea
              autoFocus
              value={text}
              onChange={(event) => setText(event.target.value)}
              placeholder={"DOMAIN-SUFFIX,example.com\nIP-CIDR,10.0.0.0/8,no-resolve"}
              className="min-h-40"
            />
            <DialogFooter>
              <Button variant="ghost" onClick={onClose}>取消</Button>
              <Button variant="primary" disabled={text.trim().length === 0} onClick={parse}>
                解析
              </Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <div className="rounded-md border border-line bg-bg p-3 text-xs">
              <p className="mb-1.5 font-medium">你粘贴了 {report.totalLines} 行。系统将：</p>
              <ul className="flex flex-col gap-0.5 text-muted">
                <li>· 保存 {report.entries.length} 条有效规则</li>
                {report.duplicatesRemoved > 0 ? <li>· 移除 {report.duplicatesRemoved} 条重复规则</li> : null}
                {report.strippedTargets > 0 ? <li>· 剥离 {report.strippedTargets} 条自带的目标（以本块目标为准）</li> : null}
                {report.normalizedCount > 0 ? <li>· 修正 {report.normalizedCount} 条的大小写/空格</li> : null}
                {report.skippedMatch > 0 ? <li>· 跳过 {report.skippedMatch} 条 MATCH（兜底由「最终落点」统一管理）</li> : null}
                {report.invalid.length > 0 ? (
                  <li className="text-warn">
                    · {report.invalid.length} 行无法解析：
                    {report.invalid.slice(0, 3).map((item) => ` ${item.line}（${item.reason}）`)}
                  </li>
                ) : null}
              </ul>
            </div>
            <DialogFooter>
              <Button variant="ghost" onClick={() => setReport(null)}>返回修改</Button>
              <Button
                variant="primary"
                disabled={report.entries.length === 0 || editingLocked}
                onClick={confirm}
              >
                确认保存规范化结果
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
};

const AddBlockDialog = ({ onClose }: { onClose: () => void }) => {
  const { config, update, knownGroupNames, editingLocked } = useWorkspace();
  const existing = new Set(config.rules.targets.map((block) => block.target));
  const candidates = [
    ...knownGroupNames.filter((name) => !existing.has(name)),
    ...BUILTIN_POLICY_OPTIONS.map((option) => option.value).filter((policy) => !existing.has(policy))
  ];
  const [target, setTarget] = useState(candidates[0] ?? "");

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent title="新增规则块" description="规则面向目标组织：这个块里的所有规则都指向同一个目标。">
        <Field label="目标（代理组或内置策略）">
          <Select value={target} onValueChange={setTarget}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {candidates.map((name) => (
                <SelectItem key={name} value={name}>{name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>取消</Button>
          <Button
            variant="primary"
            disabled={!target || editingLocked}
            onClick={() => {
              const accepted = update((draft) => {
                draft.rules.targets.push({ target, items: [] });
                draft.rules.order.push(target);
              });
              if (accepted) onClose();
            }}
          >
            创建
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

const itemSummary = (item: RuleItem) =>
  item.kind === "snapshot"
    ? `${item.slug} @${item.hash.slice(0, 8)} · ${item.emit === "provider" ? "provider" : "内联"}`
    : `${item.entries.length} 条手动规则`;

const SYNC_SKIP_REASON: Record<string, string> = {
  "catalog-not-visible": "规则集不存在或不可见",
  "latest-snapshot-unavailable": "规则库尚无最新快照",
  "latest-snapshot-missing": "最新快照内容缺失"
};

export const RulesTab = () => {
  const {
    config,
    update,
    knownGroupNames,
    saving,
    editingLocked,
    syncingRulesets,
    syncLatestRulesets
  } = useWorkspace();
  const [importFor, setImportFor] = useState<string | null>(null);
  const [pasteFor, setPasteFor] = useState<string | null>(null);
  const [showAddBlock, setShowAddBlock] = useState(false);
  const [manualFor, setManualFor] = useState<string | null>(null);
  const [manualType, setManualType] = useState<string>("DOMAIN-SUFFIX");
  const [manualValue, setManualValue] = useState("");
  const referencedCatalogCount = new Set(
    config.rules.targets.flatMap((block) =>
      block.items
        .filter((item) => item.kind === "snapshot")
        .map((item) => item.catalogId)
    )
  ).size;
  const legacySnapshotItems = config.rules.targets.flatMap((block) =>
    block.items.filter((item) => item.kind === "snapshot")
  );
  const legacyInlineCount = legacySnapshotItems.filter((item) => item.emit === "inline").length;
  const legacyProviderCount = legacySnapshotItems.length - legacyInlineCount;
  const inlineDeliveryChecked =
    config.rules.deliveryMode === "inline" ||
    (config.rules.deliveryMode === undefined &&
      legacyInlineCount > 0 &&
      legacyProviderCount === 0);

  const orderedTargets = [
    ...config.rules.order.filter((target) => config.rules.targets.some((block) => block.target === target)),
    ...config.rules.targets.map((block) => block.target).filter((target) => !config.rules.order.includes(target))
  ];

  const reorderBlocks = (nextTargets: string[]) => {
    update((draft) => {
      draft.rules.order = nextTargets;
    });
  };

  const removeItem = (target: string, itemIndex: number) => {
    update((draft) => {
      const block = draft.rules.targets.find((candidate) => candidate.target === target);
      block?.items.splice(itemIndex, 1);
    });
  };

  const reorderItems = (target: string, nextItems: RuleItem[]) => {
    update((draft) => {
      const block = draft.rules.targets.find((candidate) => candidate.target === target);
      if (block) block.items = nextItems;
    });
  };

  const removeBlock = (target: string) => {
    update((draft) => {
      draft.rules.targets = draft.rules.targets.filter((block) => block.target !== target);
      draft.rules.order = draft.rules.order.filter((entry) => entry !== target);
    });
  };

  const addManual = () => {
    if (!manualFor || !manualValue.trim()) return;
    update((draft) => {
      const block = draft.rules.targets.find((candidate) => candidate.target === manualFor);
      if (!block) return;
      const lastItem = block.items[block.items.length - 1];
      const entry = { type: manualType, value: manualValue.trim() } as RuleEntry;
      if (lastItem?.kind === "manual") lastItem.entries.push(entry);
      else block.items.push({ kind: "manual", entries: [entry] });
    });
    setManualValue("");
    setManualFor(null);
  };

  const handleSyncLatestRulesets = async () => {
    if (saving || syncingRulesets) return;
    try {
      const result = await syncLatestRulesets();
      if (result.changes.length > 0) {
        toast.success(`已同步 ${result.changes.length} 个规则集到最新快照`, {
          description: `变更已写入草稿；${result.unchangedCount} 个无需更新。请预览后发布。`
        });
      } else if (result.skipped.length === 0) {
        toast.info("当前引用的规则集已是最新快照", {
          description: `${result.unchangedCount} 个规则集无需更新。`
        });
      }
      if (result.skipped.length > 0) {
        const sample = result.skipped
          .slice(0, 2)
          .map((item) => `${item.slug}：${SYNC_SKIP_REASON[item.reason] ?? item.reason}`)
          .join("；");
        toast.warning(`${result.skipped.length} 个规则集未能同步`, {
          description: `${sample}${result.skipped.length > 2 ? "；其余请稍后重试" : ""}`
        });
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "同步规则快照失败");
    }
  };

  return (
    <div className="max-w-3xl">
      <SectionTitle
        title="规则"
        desc="按目标组织，块顺序决定匹配优先级。同步规则库当前最新快照只写入草稿，不自动发布；发布后客户端才生效。"
        actions={
          <>
            <span
              title={
                referencedCatalogCount === 0
                  ? "当前订阅尚未引用规则库快照"
                  : saving
                    ? "请先等待本地修改保存完成"
                    : "同步规则库当前 latest；只写草稿，不自动发布"
              }
            >
              <Button
                size="sm"
                variant="ghost"
                disabled={saving || syncingRulesets || referencedCatalogCount === 0}
                onClick={() => void handleSyncLatestRulesets()}
              >
                <RefreshCw
                  className={`size-3 ${syncingRulesets ? "animate-spin" : ""}`}
                />
                {syncingRulesets ? "同步中…" : "同步规则库最新快照"}
              </Button>
            </span>
            <Button size="sm" onClick={() => setShowAddBlock(true)}>新增规则块</Button>
          </>
        }
      />

      <div className="mb-3 flex items-start justify-between gap-6 rounded-[10px] border border-line bg-surface px-3.5 py-3">
        <div>
          <p className="text-[12.5px] font-semibold">
            将规则直接写入订阅文件
            {config.rules.deliveryMode === undefined ? (
              <Badge className="ml-2 text-[10px]">兼容旧配置</Badge>
            ) : null}
          </p>
          <p className="mt-0.5 max-w-xl text-[11.5px] leading-5 text-muted">
            {config.rules.deliveryMode === undefined
              ? `当前沿用各规则项原有设置：${legacyInlineCount} 个内联、${legacyProviderCount} 个远程；切换后会改为统一交付方式。`
              : "默认使用远程规则文件以减小订阅体积。开启后所有可内联规则会合并进主 YAML；文件会明显变大，且规则库更新仍需先同步草稿并重新发布，客户端才会拿到新规则。"}
          </p>
        </div>
        <Switch
          aria-label="将规则直接写入订阅文件"
          checked={inlineDeliveryChecked}
          disabled={editingLocked}
          onCheckedChange={(checked) => update((draft) => {
            draft.rules.deliveryMode = checked ? "inline" : "provider";
          })}
        />
      </div>

      <SortableList
        items={orderedTargets.map((target) => ({ id: target }))}
        onReorder={(next) => reorderBlocks(next.map((entry) => entry.id))}
        renderItem={({ id: target }, blockHandle) => {
          const block = config.rules.targets.find((candidate) => candidate.target === target)!;
          return (
            <div className="mb-2.5 rounded-[10px] border border-line bg-surface">
              <div className="flex items-center gap-2.5 border-b border-line px-3.5 py-2.5">
                <DragHandle {...blockHandle} />
                <span className="text-[13px] font-semibold">{target}</span>
                <span className="text-[11.5px] text-faint">{block.items.length} 项</span>
                <span className="ml-auto flex gap-0.5">
                  <Button size="sm" variant="ghost" title="导入规则源" onClick={() => setImportFor(target)}>
                    导入规则源
                  </Button>
                  <Button size="sm" variant="ghost" title="粘贴规则" onClick={() => setPasteFor(target)}>
                    粘贴
                  </Button>
                  <Button size="sm" variant="ghost" title="手动加一条" onClick={() => setManualFor(target)}>
                    <Plus className="size-3" />
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => removeBlock(target)}>
                    <Trash2 className="size-3" />
                  </Button>
                </span>
              </div>
              <div className="flex flex-col gap-1.5 px-3.5 py-2.5">
                <SortableList
                  items={block.items.map((item, itemIndex) => ({ id: String(itemIndex), item }))}
                  onReorder={(next) => reorderItems(target, next.map((entry) => entry.item))}
                  className="flex flex-col gap-1.5"
                  renderItem={({ item }, itemHandle) => (
                    <div className="flex items-center gap-2 text-[12.5px]">
                      <DragHandle {...itemHandle} />
                      <span className="rounded border border-line-strong px-1.5 font-mono text-[10.5px] text-muted">
                        {item.kind === "snapshot" ? "快照" : "手动"}
                      </span>
                      <span className="font-mono text-xs">{itemSummary(item)}</span>
                      {item.kind === "manual" && item.entries.length <= 4 ? (
                        <span className="text-[11px] text-faint">
                          {item.entries.map((entry) => `${entry.type},${entry.value}`).join("；")}
                        </span>
                      ) : null}
                      <Button
                        size="sm"
                        variant="ghost"
                        className="ml-auto"
                        onClick={() => removeItem(target, block.items.indexOf(item))}
                      >
                        <Trash2 className="size-3" />
                      </Button>
                    </div>
                  )}
                />
                {block.items.length === 0 ? <p className="text-xs text-faint">空块——导入规则源或粘贴规则。</p> : null}
                {manualFor === target ? (
                  <div className="mt-1 flex items-center gap-2">
                    <Select value={manualType} onValueChange={setManualType}>
                      <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {RULE_TYPES.map((type) => (
                          <SelectItem key={type} value={type}>{type}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Input
                      autoFocus
                      className="flex-1"
                      value={manualValue}
                      onChange={(event) => setManualValue(event.target.value)}
                      placeholder="example.com"
                      onKeyDown={(event) => event.key === "Enter" && addManual()}
                    />
                    <Button size="sm" variant="primary" onClick={addManual}>添加</Button>
                  </div>
                ) : null}
              </div>
            </div>
          );
        }}
      />

      <div className="rounded-[10px] border border-dashed border-line-strong bg-surface/60 px-3.5 py-2.5">
        <div className="flex items-center gap-3 text-[12.5px]">
          <span className="text-faint">兜底</span>
          <span className="rounded border border-dashed border-line-strong px-1.5 text-[10.5px] text-faint">恒在最后</span>
          <span className="font-mono text-xs">MATCH →</span>
          <Select
            value={config.rules.final.target}
            disabled={editingLocked}
            onValueChange={(target) => update((draft) => { draft.rules.final.target = target; })}
          >
            <SelectTrigger className="h-6 w-40 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              {[...knownGroupNames, ...BUILTIN_POLICY_OPTIONS.map((option) => option.value)].map((name) => (
                <SelectItem key={name} value={name}>{name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {importFor ? <ImportRulesetDialog target={importFor} onClose={() => setImportFor(null)} /> : null}
      {pasteFor ? <PasteDialog target={pasteFor} onClose={() => setPasteFor(null)} /> : null}
      {showAddBlock ? <AddBlockDialog onClose={() => setShowAddBlock(false)} /> : null}
    </div>
  );
};
