import { useState } from "react";
import { RefreshCw } from "lucide-react";
import { toast } from "sonner";

import { RulesetDirectoryBrowser } from "../components/ruleset-directory-browser";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Card } from "../components/ui/card";
import { Dialog, DialogContent, DialogFooter } from "../components/ui/dialog";
import { Field, Input } from "../components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select";
import { formatRelative } from "../lib/format";
import {
  useReferencingSubscriptions,
  useRulesetDiff,
  useRulesetMutations,
  useRulesets
} from "../lib/hooks";
import type { RulesetCatalogEntry, RulesetDirectoryEntry } from "../lib/types";

const behaviorLabel: Record<string, string> = {
  domain: "域名",
  ipcidr: "IP 段",
  classical: "经典规则"
};

// 更新流：查看差异 → 选择订阅 → 应用为草稿（发布仍需显式确认）
const UpdateDialog = ({
  entry,
  onClose
}: {
  entry: RulesetCatalogEntry;
  onClose: () => void;
}) => {
  const diff = useRulesetDiff(entry.id, null, entry.latestSnapshotHash);
  const referencing = useReferencingSubscriptions(entry.id);
  const mutations = useRulesetMutations();
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const apply = async () => {
    if (!entry.latestSnapshotHash) return;
    try {
      const results = await mutations.applyUpdate.mutateAsync({
        catalogId: entry.id,
        toHash: entry.latestSnapshotHash,
        subscriptionIds: [...selected]
      });
      const changed = results.filter((result) => result.changed).length;
      toast.success(`已更新 ${changed} 个订阅的草稿。到各订阅工作台预览并发布即可生效。`);
      onClose();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "应用失败");
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent wide title={`更新 ${entry.name}`} description="钉版本快照替换为新内容。只改草稿，发布仍需你确认。">
        {diff.data ? (
          <div className="mb-4 rounded-md border border-line bg-bg p-3">
            <div className="mb-2 flex gap-2 font-mono text-xs">
              <span className="rounded bg-ok-bg px-2 text-ok">+{diff.data.addedCount}</span>
              <span className="rounded bg-err-bg px-2 text-err">-{diff.data.removedCount}</span>
              <span className="text-faint">共 {diff.data.toEntryCount} 条</span>
            </div>
            <div className="grid max-h-44 grid-cols-2 gap-3 overflow-y-auto font-mono text-[11px]">
              <div>
                {diff.data.addedSample.map((item) => (
                  <p key={item} className="text-ok">+ {item}</p>
                ))}
              </div>
              <div>
                {diff.data.removedSample.map((item) => (
                  <p key={item} className="text-err">- {item}</p>
                ))}
              </div>
            </div>
          </div>
        ) : (
          <p className="mb-4 text-xs text-faint">正在计算差异…</p>
        )}
        <p className="mb-2 text-xs font-medium text-muted">应用到哪些订阅？</p>
        <div className="flex flex-col gap-1">
          {(referencing.data ?? []).map((sub) => (
            <label key={sub.id} className="flex items-center gap-2 rounded px-1 py-1 text-[13px] hover:bg-surface2">
              <input
                type="checkbox"
                checked={selected.has(sub.id)}
                onChange={(event) => {
                  const next = new Set(selected);
                  if (event.target.checked) next.add(sub.id);
                  else next.delete(sub.id);
                  setSelected(next);
                }}
              />
              {sub.displayName}
            </label>
          ))}
          {referencing.data && referencing.data.length === 0 ? (
            <p className="text-xs text-faint">没有订阅引用此规则源。</p>
          ) : null}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>取消</Button>
          <Button variant="primary" disabled={selected.size === 0 || mutations.applyUpdate.isPending} onClick={() => void apply()}>
            更新所选订阅的草稿
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

const ImportDialog = ({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) => {
  const mutations = useRulesetMutations();
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [behavior, setBehavior] = useState("domain");
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title="导入规则源" description="从 URL 抓取规则列表（payload YAML 或纯文本行）。">
        <div className="flex flex-col gap-3.5">
          <Field label="名称">
            <Input value={name} onChange={(event) => setName(event.target.value)} />
          </Field>
          <Field label="URL">
            <Input value={url} onChange={(event) => setUrl(event.target.value)} placeholder="https://…" />
          </Field>
          <Field label="内容类型">
            <Select value={behavior} onValueChange={setBehavior}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="domain" description="如 +.example.com 域名列表">域名（domain）</SelectItem>
                <SelectItem value="ipcidr" description="如 1.0.0.0/8 CIDR 列表">IP 段（ipcidr）</SelectItem>
                <SelectItem value="classical" description="如 DOMAIN-SUFFIX,x.com 完整规则">经典规则（classical）</SelectItem>
              </SelectContent>
            </Select>
          </Field>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>取消</Button>
          <Button
            variant="primary"
            disabled={mutations.importFromUrl.isPending || !name || !/^https?:\/\//.test(url)}
            onClick={() =>
              mutations.importFromUrl
                .mutateAsync({ name, sourceUrl: url, behavior })
                .then(() => {
                  toast.success("规则源已导入");
                  onOpenChange(false);
                })
                .catch((error: unknown) => toast.error(error instanceof Error ? error.message : "导入失败"))
            }
          >
            {mutations.importFromUrl.isPending ? "抓取中…" : "导入"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export const RulesetsPage = () => {
  const rulesets = useRulesets();
  const mutations = useRulesetMutations();
  const [updating, setUpdating] = useState<RulesetCatalogEntry | null>(null);
  const [showImport, setShowImport] = useState(false);
  const [busySlug, setBusySlug] = useState<string | null>(null);

  const importFromDirectory = (entry: RulesetDirectoryEntry) => {
    setBusySlug(entry.slug);
    mutations.importFromUrl
      .mutateAsync({ name: entry.name, sourceUrl: entry.sourceUrl, behavior: entry.behavior })
      .then(() => toast.success(`已导入「${entry.name}」到规则库`))
      .catch((error: unknown) => toast.error(error instanceof Error ? error.message : "导入失败"))
      .finally(() => setBusySlug(null));
  };

  return (
    <div className="mx-auto max-w-[1180px] px-5 pb-16 pt-6">
      <div className="mb-5 flex items-start gap-4">
        <div>
          <h1 className="text-lg font-semibold">规则库</h1>
          <p className="text-xs text-muted">
            规则以钉版本快照进入订阅。远端更新只点亮徽章，永远不会悄悄改变你已发布的配置。
          </p>
        </div>
        <div className="ml-auto">
          <Button variant="primary" onClick={() => setShowImport(true)}>导入规则源</Button>
        </div>
      </div>

      <Card className="p-0">
        <table className="w-full border-collapse text-[12.5px]">
          <thead>
            <tr className="text-left text-[11.5px] text-faint">
              <th className="border-b border-line px-3 py-2 font-medium">规则源</th>
              <th className="border-b border-line px-3 py-2 font-medium">类型</th>
              <th className="border-b border-line px-3 py-2 font-medium">建议目标</th>
              <th className="border-b border-line px-3 py-2 font-medium">当前快照</th>
              <th className="border-b border-line px-3 py-2 font-medium">最近检查</th>
              <th className="border-b border-line px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {(rulesets.data ?? []).map((entry) => (
              <tr key={entry.id} className="hover:bg-surface2/45">
                <td className="border-b border-line px-3 py-2">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-xs">{entry.slug}</span>
                    {entry.isOfficial ? <Badge>内置</Badge> : <Badge variant="accent">自定义</Badge>}
                    {entry.updateAvailable ? <Badge variant="accent">有更新</Badge> : null}
                  </div>
                  <p className="text-[11px] text-faint">{entry.name}</p>
                </td>
                <td className="border-b border-line px-3 py-2 text-muted">{behaviorLabel[entry.behavior]}</td>
                <td className="border-b border-line px-3 py-2">
                  {entry.recommendedTarget ? <Badge variant="mono">{entry.recommendedTarget}</Badge> : "—"}
                </td>
                <td className="border-b border-line px-3 py-2 font-mono text-[11px] text-faint">
                  {entry.latestSnapshotHash ? `@${entry.latestSnapshotHash.slice(0, 8)}` : "—"}
                </td>
                <td className="border-b border-line px-3 py-2 text-muted">
                  {formatRelative(entry.lastCheckedAt)}
                  {entry.lastCheckError ? <span className="text-warn">（失败）</span> : null}
                </td>
                <td className="border-b border-line px-3 py-2 text-right">
                  <div className="flex justify-end gap-1.5">
                    <Button
                      size="sm"
                      variant="ghost"
                      title="检查更新"
                      disabled={mutations.refresh.isPending}
                      onClick={() =>
                        mutations.refresh
                          .mutateAsync(entry.id)
                          .then((result) =>
                            toast.info(result.updated ? "发现新内容，已点亮更新徽章" : "已是最新")
                          )
                          .catch((error: unknown) =>
                            toast.error(error instanceof Error ? error.message : "检查失败")
                          )
                      }
                    >
                      <RefreshCw className="size-3.5" />
                    </Button>
                    {entry.updateAvailable ? (
                      <Button size="sm" onClick={() => setUpdating(entry)}>
                        查看差异并更新
                      </Button>
                    ) : null}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <Card className="mt-5 p-4">
        <h2 className="mb-0.5 text-[13px] font-semibold">发现更多规则</h2>
        <p className="mb-3 text-xs text-muted">
          来自 blackmatrix7/ios_rule_script 的完整规则组索引，常用的已经内置在上面的列表里；这里可以按需搜索并一键导入其余规则组。
        </p>
        <RulesetDirectoryBrowser onImport={importFromDirectory} busySlug={busySlug} />
      </Card>

      {updating ? <UpdateDialog entry={updating} onClose={() => setUpdating(null)} /> : null}
      <ImportDialog open={showImport} onOpenChange={setShowImport} />
    </div>
  );
};
