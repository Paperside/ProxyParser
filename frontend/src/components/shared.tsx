import { useState, type ReactNode } from "react";
import { Check, Copy } from "lucide-react";
import { toast } from "sonner";

import { cn } from "../lib/cn";
import type { DiffSummary, EvaluateIssueDto, Health } from "../lib/types";
import { healthLabel } from "../lib/format";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";

export const HealthDot = ({ health, withLabel }: { health: Health; withLabel?: boolean }) => (
  <span className="inline-flex items-center gap-1.5">
    <span className="health-dot" data-health={health} />
    {withLabel ? <span className="text-xs text-muted">{healthLabel[health]}</span> : null}
  </span>
);

export const CopyButton = ({ text, label = "复制链接" }: { text: string; label?: string }) => {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      size="sm"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          toast.success("已复制到剪贴板");
          setTimeout(() => setCopied(false), 1500);
        } catch {
          toast.error("复制失败，请手动复制");
        }
      }}
    >
      {copied ? <Check className="size-3.5 text-ok" /> : <Copy className="size-3.5" />}
      {label}
    </Button>
  );
};

// diff 摘要 chips（统一 diff 视觉语言）
export const DiffChips = ({ diff }: { diff: DiffSummary | Record<string, never> | null }) => {
  if (!diff || !("nodes" in diff)) {
    return <span className="text-xs text-faint">—</span>;
  }
  if (diff.identical) {
    return <span className="text-xs text-faint">与上一版本内容一致</span>;
  }
  const chip = (content: ReactNode, key: string) => (
    <span
      key={key}
      className="rounded border border-line bg-surface2 px-2 py-px font-mono text-[11.5px] text-muted"
    >
      {content}
    </span>
  );
  const chips: ReactNode[] = [];
  const { nodes, groups } = diff;
  if (nodes.added.length || nodes.removed.length) {
    chips.push(
      chip(
        <>
          节点 {nodes.added.length > 0 && <span className="text-ok">+{nodes.added.length}</span>}
          {nodes.removed.length > 0 && <span className="text-err"> -{nodes.removed.length}</span>}
        </>,
        "nodes"
      )
    );
  }
  if (nodes.renamed.length) chips.push(chip(`改名 ${nodes.renamed.length}`, "renamed"));
  if (nodes.updated.length) chips.push(chip(`凭据/字段更新 ${nodes.updated.length}`, "updated"));
  if (groups.added.length) chips.push(chip(`新组 ${groups.added.join("、")}`, "gadd"));
  if (groups.removed.length) chips.push(chip(`删组 ${groups.removed.join("、")}`, "gdel"));
  if (groups.membersChanged.length)
    chips.push(chip(`组成员变化 ${groups.membersChanged.length}`, "gchg"));
  if (diff.ruleCountDelta !== 0)
    chips.push(
      chip(
        <span className={diff.ruleCountDelta > 0 ? "text-ok" : "text-err"}>
          规则 {diff.ruleCountDelta > 0 ? "+" : ""}
          {diff.ruleCountDelta}
        </span>,
        "rules"
      )
    );
  if (diff.configKeysChanged.length)
    chips.push(chip(`配置 ${diff.configKeysChanged.join("、")}`, "cfg"));
  return <div className="flex flex-wrap gap-1.5">{chips.length > 0 ? chips : chip("无结构变化", "none")}</div>;
};

export const IssueList = ({ issues }: { issues: EvaluateIssueDto[] }) => {
  if (issues.length === 0) {
    return <p className="text-xs text-faint">没有需要处理的问题。</p>;
  }
  return (
    <div className="flex flex-col">
      {issues.map((issue, index) => (
        <div key={index} className="flex gap-2 border-b border-line py-2.5 text-xs last:border-b-0">
          <span className="health-dot mt-1" data-health={issue.severity === "error" ? "error" : "warn"} />
          <div className="min-w-0">
            <p>{issue.message}</p>
            <p className="mt-0.5 font-mono text-[10.5px] text-faint">{issue.kind}</p>
          </div>
        </div>
      ))}
    </div>
  );
};

export const EmptyState = ({
  title,
  description,
  action,
  className
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
}) => (
  <div
    className={cn(
      "flex flex-col items-center gap-2 rounded-[10px] border border-dashed border-line-strong py-12 text-center",
      className
    )}
  >
    <p className="text-sm font-medium text-muted">{title}</p>
    {description ? <p className="max-w-md text-xs text-faint">{description}</p> : null}
    {action ? <div className="mt-2">{action}</div> : null}
  </div>
);

export const StatusBadge = ({ ok, okText, failText }: { ok: boolean; okText: string; failText: string }) =>
  ok ? <Badge variant="ok">{okText}</Badge> : <Badge variant="warn">{failText}</Badge>;

export const SectionTitle = ({ title, desc, actions }: { title: string; desc?: string; actions?: ReactNode }) => (
  <div className="mb-3 flex items-start gap-4">
    <div>
      <h2 className="text-[15px] font-semibold">{title}</h2>
      {desc ? <p className="mt-0.5 text-xs text-muted">{desc}</p> : null}
    </div>
    {actions ? <div className="ml-auto flex items-center gap-2">{actions}</div> : null}
  </div>
);
