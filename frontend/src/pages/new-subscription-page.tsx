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
  useSubscriptionMutations,
  useTemplates
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
  const items = ["粘贴订阅源", "选择起点", "命名并发布"];
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

const SourceSummaryBar = ({ source, onChange }: { source: SourceSummary; onChange: () => void }) => {
  const usage = usageSummary(source.usage);
  return (
    <div className="mb-6 flex items-center gap-5 rounded-[10px] border border-ok/25 bg-ok-bg px-4 py-3 text-[12.5px]">
      <span className="health-dot" data-health="ok" />
      <strong>{source.displayName}</strong>
      {(
        [
          [source.proxyCount, "节点"],
          [source.groupCount, "源代理组"],
          [source.ruleCount, "源规则"]
        ] as const
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
        更换
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
  const [sourceId, setSourceId] = useState<string | null>(null);
  const [sourceUrl, setSourceUrl] = useState("");
  const [sourceName, setSourceName] = useState("");
  const [startKind, setStartKind] = useState<StartKind>("recommended");
  const [templateId, setTemplateId] = useState<string | null>(null);
  const [displayName, setDisplayName] = useState("");
  const [result, setResult] = useState<IssuedToken | null>(null);
  const [subscriptionId, setSubscriptionId] = useState<string | null>(null);
  const [publishError, setPublishError] = useState<string | null>(null);

  const selectedSource = useMemo(
    () => sources.data?.find((source) => source.id === sourceId) ?? null,
    [sources.data, sourceId]
  );

  const submitSourceUrl = async () => {
    try {
      const created = await sourceMutations.create.mutateAsync({
        displayName: sourceName || "我的机场",
        sourceUrl: sourceUrl.trim()
      });
      setSourceId(created.id);
      setStep(2);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "订阅源添加失败");
    }
  };

  const createAndPublish = async () => {
    if (!sourceId) return;
    setPublishError(null);
    try {
      const created = await subscriptionMutations.create.mutateAsync({
        displayName: displayName || "我的订阅",
        sourceIds: [sourceId],
        start: {
          kind: startKind,
          ...(startKind === "template" && templateId ? { templateId } : {})
        }
      });
      setSubscriptionId(created.subscription.id);
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
              {sourceMutations.create.isPending ? "正在同步订阅源…" : "添加并同步"}
            </Button>
          </Card>
          {sources.data && sources.data.length > 0 ? (
            <Card>
              <p className="mb-2 text-xs font-medium text-muted">或选择已有订阅源</p>
              <div className="flex flex-col gap-1">
                {sources.data.map((source) => (
                  <button
                    key={source.id}
                    className="flex items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-[13px] hover:bg-surface2"
                    onClick={() => {
                      setSourceId(source.id);
                      setStep(2);
                    }}
                  >
                    <span
                      className="health-dot"
                      data-health={source.lastSyncStatus === "success" ? "ok" : "warn"}
                    />
                    {source.displayName}
                    <span className="text-[11px] text-faint">{source.proxyCount} 节点</span>
                  </button>
                ))}
              </div>
            </Card>
          ) : null}
        </div>
      ) : null}

      {step === 2 && selectedSource ? (
        <div>
          <SourceSummaryBar source={selectedSource} onChange={() => setStep(1)} />
          <div className="flex flex-col gap-3">
            {START_CHOICES.map((choice) => (
              <button
                key={choice.kind}
                className={cn(
                  "relative rounded-[10px] border border-line bg-surface px-4 py-3.5 text-left transition-colors hover:border-line-strong",
                  startKind === choice.kind && "border-accent-strong bg-accent-bg"
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
                <span className="flex items-center gap-2 text-[13.5px] font-semibold">
                  {choice.title}
                  {choice.badge ? <Badge variant="accent">{choice.badge}</Badge> : null}
                </span>
                <span className="mt-1 block text-[12.5px] text-muted">{choice.desc}</span>
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
                          }}
                        >
                          {template.displayName}
                          {template.isOfficial ? " · 官方" : ""}
                        </span>
                      ))}
                  </span>
                ) : null}
              </button>
            ))}
          </div>
          <div className="mt-6 flex justify-between">
            <Button variant="ghost" onClick={() => setStep(1)}>
              上一步
            </Button>
            <Button
              variant="primary"
              disabled={startKind === "template" && !templateId}
              onClick={() => setStep(3)}
            >
              继续
            </Button>
          </div>
        </div>
      ) : null}

      {step === 3 && selectedSource ? (
        result && subscriptionId ? (
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
  const [published, setPublished] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const publishAttempted = useRef(false);

  useEffect(() => {
    if (publishAttempted.current) return;
    publishAttempted.current = true;
    mutations.publish
      .mutateAsync()
      .then(() => setPublished(true))
      .catch((err: unknown) => setError(err instanceof Error ? err.message : "发布失败"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
    return (
      <Card>
        <p className="text-sm text-muted">正在渲染并校验首个版本…（含 mihomo 内核校验）</p>
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
