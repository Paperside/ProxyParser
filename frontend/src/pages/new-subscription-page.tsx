import { useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { CopyButton, QrCode } from "../components/shared";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Card } from "../components/ui/card";
import { Field, Input } from "../components/ui/input";
import { Textarea } from "../components/ui/textarea";
import { cn } from "../lib/cn";
import { usageSummary } from "../lib/format";
import {
  useSourceMutations,
  useSources,
  usePreparePublishCandidate,
  useSubscriptionMutations,
  useTemplates,
  useValidatePublishCandidate
} from "../lib/hooks";
import type { IssuedToken, SourceSummary } from "../lib/types";

type StartKind = "recommended" | "template" | "patch" | "blank";

const START_CHOICES: Array<{ kind: StartKind; title: string; desc: string; badge?: string }> = [
  {
    kind: "recommended",
    title: "推荐方案",
    badge: "默认",
    desc: "官方维护的起手配置：自动地区分组 + Auto 测速组，AI / 流媒体 / 广告拦截 / 国内直连分流，合理的 DNS 与嗅探设置。之后可随意精修。"
  },
  {
    kind: "template",
    title: "套用模板",
    desc: "使用你提炼过的模板或公开模板。换机场时选这个，你的分组和规则一次套用。"
  },
  {
    kind: "patch",
    title: "保留机场原版配置，仅做小修",
    desc: "机场配置本来不错？保留它的分组和规则，只加自建节点、小改配置。此模式与该机场绑定，不能提炼为通用模板。"
  },
  {
    kind: "blank",
    title: "空白自建",
    desc: "只取节点，分组、规则、配置全部自己搭。适合清楚自己要什么的老手。"
  }
];

const StepHeader = ({ step }: { step: 1 | 2 | 3 }) => {
  const items = ["选择订阅源", "选择起点", "命名并发布"];
  return (
    <div className="my-6 flex items-center justify-center">
      {items.map((label, index) => {
        const n = (index + 1) as 1 | 2 | 3;
        const state = n < step ? "done" : n === step ? "active" : "todo";
        return (
          <div key={label} className="flex items-center">
            {index > 0 ? <span className="mx-3.5 h-px w-12 bg-line-strong" /> : null}
            <span
              className={cn(
                "flex items-center gap-2 text-[13px]",
                state === "active" && "font-semibold text-ink",
                state === "done" && "text-muted",
                state === "todo" && "text-faint"
              )}
            >
              <span
                className={cn(
                  "grid size-[22px] place-items-center rounded-full border border-line-strong font-mono text-[11px]",
                  state === "done" && "border-transparent bg-ok-bg text-ok",
                  state === "active" && "border-transparent bg-accent-strong text-on-accent"
                )}
              >
                {state === "done" ? "✓" : n}
              </span>
              {label}
            </span>
          </div>
        );
      })}
    </div>
  );
};

const SourceSummaryBar = ({
  sources,
  onChange
}: {
  sources: SourceSummary[];
  onChange: () => void;
}) => {
  const usage = sources.length === 1 ? usageSummary(sources[0]!.usage) : null;
  const totals = sources.reduce(
    (sum, source) => ({
      proxies: sum.proxies + source.proxyCount,
      groups: sum.groups + source.groupCount,
      rules: sum.rules + source.ruleCount
    }),
    { proxies: 0, groups: 0, rules: 0 }
  );
  return (
    <div className="mb-6 flex items-center gap-5 rounded-[10px] border border-ok/25 bg-ok-bg px-4 py-3 text-[12.5px]">
      <span className="health-dot" data-health="ok" />
      <span className="min-w-0">
        <strong>{sources.length === 1 ? sources[0]!.displayName : `已选择 ${sources.length} 个订阅源`}</strong>
        {sources.length > 1 ? (
          <span className="mt-1 flex max-w-64 flex-wrap gap-1">
            {sources.map((source) => (
              <Badge key={source.id}>{source.displayName}</Badge>
            ))}
          </span>
        ) : null}
      </span>
      {(sources.length > 1
        ? ([[totals.proxies, "合并节点"]] as const)
        : ([
            [totals.proxies, "节点"],
            [totals.groups, "源代理组"],
            [totals.rules, "源规则"]
          ] as const)
      ).map(([count, label]) => (
        <span key={label} className="flex flex-col leading-tight">
          <b className="font-mono text-sm">{count}</b>
          <span className="text-[11px] text-faint">{label}</span>
        </span>
      ))}
      {usage ? (
        <span className="flex flex-col leading-tight">
          <b className="font-mono text-sm">{usage.percent}%</b>
          <span className="text-[11px] text-faint">流量已用</span>
        </span>
      ) : null}
      <Button size="sm" variant="ghost" className="ml-auto" onClick={onChange}>
        调整
      </Button>
    </div>
  );
};

export const NewSubscriptionPage = () => {
  const navigate = useNavigate();
  const sources = useSources();
  const templates = useTemplates();
  const sourceMutations = useSourceMutations();
  const subscriptionMutations = useSubscriptionMutations();

  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [sourceIds, setSourceIds] = useState<string[]>([]);
  const [sourceUrl, setSourceUrl] = useState("");
  const [sourceName, setSourceName] = useState("");
  const [startKind, setStartKind] = useState<StartKind>("recommended");
  const [templateId, setTemplateId] = useState<string | null>(null);
  const [confirmedTemplateSensitive, setConfirmedTemplateSensitive] = useState(false);
  const [displayName, setDisplayName] = useState("");
  const [result, setResult] = useState<IssuedToken | null>(null);
  const [subscriptionId, setSubscriptionId] = useState<string | null>(null);
  const [draftRevision, setDraftRevision] = useState<number | null>(null);
  const [publishError, setPublishError] = useState<string | null>(null);

  const selectedSources = useMemo(
    () =>
      sourceIds.flatMap((sourceId) => {
        const source = sources.data?.find((candidate) => candidate.id === sourceId);
        return source ? [source] : [];
      }),
    [sources.data, sourceIds]
  );
  const isMultiSource = sourceIds.length > 1;

  useEffect(() => {
    if (isMultiSource && startKind === "patch") setStartKind("recommended");
  }, [isMultiSource, startKind]);

  const toggleSource = (sourceId: string) => {
    setSourceIds((current) =>
      current.includes(sourceId)
        ? current.filter((id) => id !== sourceId)
        : [...current, sourceId]
    );
  };

  const submitSourceUrl = async () => {
    try {
      const created = await sourceMutations.create.mutateAsync({
        displayName: sourceName || "我的机场",
        sourceUrl: sourceUrl.trim()
      });
      setSourceIds((current) =>
        current.includes(created.id) ? current : [...current, created.id]
      );
      setSourceUrl("");
      setSourceName("");
      toast.success("订阅源已同步并选中，可继续添加或进入下一步");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "订阅源添加失败");
    }
  };

  const createAndPublish = async () => {
    if (sourceIds.length === 0) return;
    setPublishError(null);
    try {
      const created = await subscriptionMutations.create.mutateAsync({
        displayName: displayName || "我的订阅",
        sourceIds,
        start: {
          kind: startKind,
          ...(startKind === "template" && templateId
            ? { templateId, confirmSensitive: confirmedTemplateSensitive }
            : {})
        }
      });
      setSubscriptionId(created.subscription.id);
      setDraftRevision(created.subscription.draftRevision);
      setResult(created.token);
      // 直接发布首个版本（黄金路径：拿到链接即可导入）
      try {
        const response = await fetch(created.token.url.replace(/\/s\/.*$/, "/api/health"));
        void response;
      } catch {
        /* ignore */
      }
    } catch (error) {
      setPublishError(error instanceof Error ? error.message : "创建失败");
    }
  };

  return (
    <div className="mx-auto max-w-[720px] px-5 pb-16 pt-4">
      <h1 className="text-center text-lg font-semibold">新建订阅</h1>
      <StepHeader step={step} />

      {step === 1 ? (
        <div className="flex flex-col gap-4">
          <Card className="flex flex-col gap-4">
            <Field label="订阅链接" hint="机场给你的 Clash / Mihomo 订阅 URL">
              <Input
                autoFocus
                placeholder="https://…"
                value={sourceUrl}
                onChange={(event) => setSourceUrl(event.target.value)}
              />
            </Field>
            <Field label="名称" hint="可选，例如机场名">
              <Input value={sourceName} onChange={(event) => setSourceName(event.target.value)} />
            </Field>
            <Button
              variant="primary"
              disabled={!/^https?:\/\/.+/.test(sourceUrl.trim()) || sourceMutations.create.isPending}
              onClick={() => void submitSourceUrl()}
            >
              {sourceMutations.create.isPending ? "正在同步订阅源…" : "添加、同步并选中"}
            </Button>
          </Card>
          {sources.data && sources.data.length > 0 ? (
            <Card>
              <div className="mb-2 flex items-center gap-2">
                <p className="text-xs font-medium text-muted">选择已有订阅源（可多选）</p>
                {sourceIds.length > 0 ? (
                  <Badge variant="accent" className="ml-auto">已选 {sourceIds.length}</Badge>
                ) : null}
              </div>
              <div className="flex flex-col gap-1.5">
                {sources.data.map((source) => (
                  <label
                    key={source.id}
                    className={cn(
                      "flex cursor-pointer items-center gap-2.5 rounded-md border px-2.5 py-2 text-left text-[13px] transition-colors",
                      sourceIds.includes(source.id)
                        ? "border-accent-strong bg-accent-bg"
                        : "border-transparent hover:border-line hover:bg-surface2"
                    )}
                  >
                    <input
                      type="checkbox"
                      aria-label={`选择订阅源 ${source.displayName}`}
                      checked={sourceIds.includes(source.id)}
                      onChange={() => toggleSource(source.id)}
                    />
                    <span
                      className="health-dot"
                      data-health={source.lastSyncStatus === "success" ? "ok" : "warn"}
                    />
                    <span className="min-w-0 flex-1 truncate">{source.displayName}</span>
                    <span className="font-mono text-[11px] text-faint">{source.proxyCount} 节点</span>
                  </label>
                ))}
              </div>
            </Card>
          ) : null}
          <div className="flex items-center justify-between gap-3 rounded-[10px] border border-line bg-surface px-4 py-3">
            <p className="text-xs text-muted">
              {sourceIds.length === 0
                ? "至少选择一个订阅源。"
                : sourceIds.length === 1
                  ? "将使用这个订阅源创建订阅。"
                  : `将合并 ${sourceIds.length} 个来源的节点；下一步不会混入各机场自己的分组和规则。`}
            </p>
            <Button
              variant="primary"
              disabled={sourceIds.length === 0 || selectedSources.length !== sourceIds.length}
              onClick={() => setStep(2)}
            >
              继续{sourceIds.length > 0 ? `（${sourceIds.length} 个源）` : ""}
            </Button>
          </div>
        </div>
      ) : null}

      {step === 2 && selectedSources.length > 0 ? (
        <div>
          <SourceSummaryBar sources={selectedSources} onChange={() => setStep(1)} />
          {isMultiSource ? (
            <div className="mb-4 rounded-[10px] border border-accent/25 bg-accent-bg px-3.5 py-3 text-[12.5px] leading-5 text-muted">
              <p className="font-semibold text-ink">多来源只合并节点</p>
              <p>
                不会叠加各机场原有的代理组、规则与 DNS；每个节点名都会追加来源，例如「香港 01 · 机场 A」，便于区分同名节点。
              </p>
            </div>
          ) : null}
          <div className="flex flex-col gap-3">
            {START_CHOICES.map((choice) => {
              const unavailable = choice.kind === "patch" && isMultiSource;
              return (
                <button
                  key={choice.kind}
                  disabled={unavailable}
                  className={cn(
                    "relative rounded-[10px] border border-line bg-surface px-4 py-3.5 text-left transition-colors hover:border-line-strong",
                    startKind === choice.kind && "border-accent-strong bg-accent-bg",
                    unavailable && "cursor-not-allowed border-dashed opacity-55 hover:border-line"
                  )}
                  onClick={() => setStartKind(choice.kind)}
                >
                  <span
                    className={cn(
                      "absolute right-3.5 top-3.5 size-3.5 rounded-full border-[1.5px] border-line-strong",
                      startKind === choice.kind &&
                        "border-accent bg-[radial-gradient(circle_at_center,var(--pp-accent)_0_4px,transparent_5px)]"
                    )}
                  />
                  <span className="flex items-center gap-2 pr-6 text-[13.5px] font-semibold">
                    {choice.title}
                    {choice.badge ? <Badge variant="accent">{choice.badge}</Badge> : null}
                    {unavailable ? <Badge>仅支持单一来源</Badge> : null}
                  </span>
                  <span className="mt-1 block text-[12.5px] text-muted">
                    {unavailable
                      ? "原版配置只能来自一个机场；多来源请使用推荐方案、模板或空白自建。"
                      : choice.desc}
                  </span>
                  {choice.kind === "template" && startKind === "template" ? (
                    <span className="mt-2 flex flex-wrap gap-1.5">
                      {(templates.data ?? [])
                        .filter((template) => template.latestVersion > 0)
                        .map((template) => (
                          <span
                            key={template.id}
                            role="button"
                            className={cn(
                              "rounded-full border border-line-strong px-2.5 py-0.5 text-xs",
                              templateId === template.id && "border-accent bg-accent-bg text-accent"
                            )}
                            onClick={(event) => {
                              event.stopPropagation();
                              setTemplateId(template.id);
                              setConfirmedTemplateSensitive(false);
                            }}
                          >
                            {template.displayName}
                            {template.isOfficial ? " · 官方" : ""}
                            {template.embeddedSecrets ? " · 含凭据" : ""}
                          </span>
                        ))}
                    </span>
                  ) : null}
                </button>
              );
            })}
          </div>
          {startKind === "template" &&
          (templates.data ?? []).find((template) => template.id === templateId)?.embeddedSecrets ? (
            <label className="mt-3 flex items-start gap-2 rounded-md bg-warn-bg px-2.5 py-2 text-xs text-warn">
              <input
                type="checkbox"
                checked={confirmedTemplateSensitive}
                onChange={(event) => setConfirmedTemplateSensitive(event.target.checked)}
              />
              我确认该模板会复制可用的节点凭据到新订阅。
            </label>
          ) : null}
          <div className="mt-6 flex justify-between">
            <Button variant="ghost" onClick={() => setStep(1)}>
              上一步
            </Button>
            <Button
              variant="primary"
              disabled={startKind === "template" && (
                !templateId ||
                ((templates.data ?? []).find((template) => template.id === templateId)?.embeddedSecrets === true &&
                  !confirmedTemplateSensitive)
              )}
              onClick={() => setStep(3)}
            >
              继续
            </Button>
          </div>
        </div>
      ) : null}

      {step === 3 && selectedSources.length > 0 ? (
        result && subscriptionId && draftRevision !== null ? (
          <PublishAndFinish
            subscriptionId={subscriptionId}
            token={result}
            onDone={() =>
              void navigate({
                to: "/subscriptions/$subscriptionId",
                params: { subscriptionId }
              })
            }
          />
        ) : (
          <Card className="flex flex-col gap-4">
            <Field label="订阅名称" hint="例如：日常主力、家庭路由器">
              <Input
                autoFocus
                value={displayName}
                onChange={(event) => setDisplayName(event.target.value)}
              />
            </Field>
            {publishError ? (
              <p className="rounded-md bg-err-bg px-3 py-2 text-xs text-err">{publishError}</p>
            ) : null}
            <div className="flex justify-between">
              <Button variant="ghost" onClick={() => setStep(2)}>
                上一步
              </Button>
              <Button
                variant="primary"
                disabled={subscriptionMutations.create.isPending}
                onClick={() => void createAndPublish()}
              >
                {subscriptionMutations.create.isPending ? "创建中…" : "创建订阅"}
              </Button>
            </div>
          </Card>
        )
      ) : null}

      <p className="mt-6 text-center text-xs text-faint">
        完成后你会得到一条稳定的订阅链接和二维码。目标：3 分钟内导入客户端。
      </p>
    </div>
  );
};

// 第 3 步后半：发布首个版本 + 展示链接/二维码/导入指引
const PublishAndFinish = ({
  subscriptionId,
  token,
  onDone
}: {
  subscriptionId: string;
  token: IssuedToken;
  onDone: () => void;
}) => {
  const mutations = useSubscriptionMutations(subscriptionId);
  const prepareCandidate = usePreparePublishCandidate(subscriptionId);
  const candidateForValidation =
    prepareCandidate.data?.phase === "rendered"
      ? prepareCandidate.data.candidateId
      : null;
  const validateCandidate = useValidatePublishCandidate(
    subscriptionId,
    candidateForValidation
  );
  const [published, setPublished] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const publishAttempted = useRef(false);

  useEffect(() => {
    const candidate = prepareCandidate.data;
    if (!candidate) return;
    if (candidate.phase === "structural_failed") {
      setError("首次发布的结构校验未通过，请进入工作台处理提示后重试。");
    }
  }, [prepareCandidate.data]);

  useEffect(() => {
    const candidate = validateCandidate.data;
    if (!candidate || publishAttempted.current) return;
    if (candidate.phase === "validation_failed" || candidate.mihomo?.passed !== true) {
      setError(candidate.mihomo?.output ?? "Mihomo 内核校验未通过。");
      return;
    }
    if (candidate.phase !== "validated") return;
    publishAttempted.current = true;
    setError(null);
    mutations.publish
      .mutateAsync({
        subscriptionId,
        candidateId: candidate.candidateId,
        expectedDraftRevision: candidate.draftRevision,
        expectedRenderedHash: candidate.renderedHash
      })
      .then(() => {
        setError(null);
        setPublished(true);
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : "发布失败"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mutations.publish, subscriptionId, validateCandidate.data]);

  useEffect(() => {
    const failure = prepareCandidate.error ?? validateCandidate.error;
    if (failure && !publishAttempted.current) {
      setError(failure instanceof Error ? failure.message : "首次发布准备失败");
    }
  }, [prepareCandidate.error, validateCandidate.error]);

  if (error) {
    return (
      <Card className="flex flex-col gap-3">
        <p className="text-sm font-semibold text-warn">首次发布未通过</p>
        <Textarea readOnly value={error} className="min-h-16" />
        <p className="text-xs text-muted">
          订阅已创建为草稿。进入工作台处理问题后再发布即可。
        </p>
        <Button variant="primary" onClick={onDone}>
          进入订阅工作台
        </Button>
      </Card>
    );
  }

  if (!published) {
    const candidate = validateCandidate.data ?? prepareCandidate.data;
    const status = !candidate
      ? "正在生成首个不可变候选版本…"
      : candidate.phase === "rendered" || candidate.phase === "validating"
        ? "候选版本已生成，正在运行 Mihomo 内核校验…"
        : "Mihomo 校验已通过，正在原子发布…";
    return (
      <Card>
        <p className="text-sm text-muted">{status}</p>
      </Card>
    );
  }

  return (
    <Card className="flex flex-col items-center gap-4 py-6 text-center">
      <span className="health-dot" data-health="ok" />
      <div>
        <p className="text-sm font-semibold">v1 已发布，你的订阅链接已就绪</p>
        <p className="mt-1 text-xs text-muted">
          在 Clash Verge / Mihomo Party 等客户端中「新建配置 → 订阅链接」粘贴即可。
        </p>
      </div>
      <QrCode url={token.url} />
      <code className="max-w-full overflow-x-auto whitespace-nowrap rounded-md border border-line bg-bg px-3 py-1.5 font-mono text-[11px] text-muted">
        {token.url}
      </code>
      <div className="flex gap-2">
        <CopyButton text={token.url} />
        <Button variant="primary" onClick={onDone}>
          进入订阅工作台
        </Button>
      </div>
    </Card>
  );
};
