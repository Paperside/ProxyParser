import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type FocusEvent,
  type ReactNode
} from "react";
import { Check, Copy, QrCode as QrCodeIcon } from "lucide-react";
import { toast } from "sonner";

import { cn } from "../lib/cn";
import { useSubscriptionMutations } from "../lib/hooks";
import type { DiffSummary, EvaluateIssueDto, Health } from "../lib/types";
import { healthLabel } from "../lib/format";
import { Badge } from "./ui/badge";
import { Button, type ButtonProps } from "./ui/button";
import { Dialog, DialogContent } from "./ui/dialog";

// 二维码：toDataURL + <img>，不依赖 canvas ref 的挂载时机，失败时会显式提示而不是静默留白。
export const QrCode = ({ url, size = 168 }: { url: string; size?: number }) => {
  const [src, setSrc] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let cancelled = false;
    setSrc(null);
    setFailed(false);
    import("qrcode")
      .then(({ default: QRCode }) =>
        QRCode.toDataURL(url, {
          width: size,
          margin: 4,
          errorCorrectionLevel: "M",
          color: { dark: "#111827", light: "#ffffff" }
        })
      )
      .then((dataUrl) => {
        if (!cancelled) setSrc(dataUrl);
      })
      .catch(() => {
        if (!cancelled) {
          setFailed(true);
          toast.error("二维码生成失败，可直接复制链接");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [url, size]);
  return failed ? (
    <div
      style={{ width: size, height: size }}
      role="status"
      className="flex items-center justify-center rounded-md border border-err/30 bg-white px-4 text-center text-[11px] text-err"
    >
      二维码生成失败，请复制链接导入
    </div>
  ) : src ? (
    <img
      src={src}
      alt="订阅二维码"
      style={{ width: size, height: size }}
      className="rounded-md border border-line bg-white p-1"
    />
  ) : (
    <div
      style={{ width: size, height: size }}
      aria-live="polite"
      className="flex items-center justify-center rounded-md border border-line bg-white text-[11px] text-slate-500"
    >
      生成中…
    </div>
  );
};

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

type QrPopoverPlacement = "down" | "up";

interface QrPopoverPosition {
  left: number;
  top: number;
  arrowLeft: number;
}

const QR_POPOVER_GAP_PX = 8;

const clamp = (value: number, minimum: number, maximum: number) =>
  Math.min(Math.max(value, minimum), maximum);

const chooseQrPopoverPlacement = (
  spaceAbove: number,
  spaceBelow: number,
  requiredSpace: number
): QrPopoverPlacement => {
  if (spaceBelow >= requiredSpace) return "down";
  if (spaceAbove >= requiredSpace) return "up";
  return spaceBelow >= spaceAbove ? "down" : "up";
};

// 订阅链接按需获取：复制、悬停二维码或弹窗首次需要时读取，气泡关闭后清理前端状态。
export const AsyncCopyButton = ({
  onReveal,
  label = "复制链接",
  size = "sm",
  variant,
  showQrButton = false,
  qrButtonLabel = "二维码",
  qrTitle = "订阅二维码"
}: {
  onReveal: () => Promise<string>;
  label?: string;
  size?: ButtonProps["size"];
  variant?: ButtonProps["variant"];
  showQrButton?: boolean;
  qrButtonLabel?: string;
  qrTitle?: string;
}) => {
  const [copyState, setCopyState] = useState<"idle" | "loading" | "copied">("idle");
  const [revealState, setRevealState] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [url, setUrl] = useState<string | null>(null);
  const [hoverOpen, setHoverOpen] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [popoverPlacement, setPopoverPlacement] = useState<QrPopoverPlacement>("down");
  const [popoverPosition, setPopoverPosition] = useState<QrPopoverPosition>({
    left: 0,
    top: 0,
    arrowLeft: 24
  });
  const [popoverPositionReady, setPopoverPositionReady] = useState(false);
  const hoverAnchorRef = useRef<HTMLSpanElement | null>(null);
  const hoverPopoverRef = useRef<HTMLSpanElement | null>(null);
  const urlRef = useRef<string | null>(null);
  const hoverOpenRef = useRef(false);
  const dialogOpenRef = useRef(false);
  const pendingReveal = useRef<Promise<string> | null>(null);
  const revealGeneration = useRef(0);
  const focusWithin = useRef(false);
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const copyResetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const placementFrame = useRef<number | null>(null);

  const clearHoverTimer = () => {
    if (hoverTimer.current !== null) {
      clearTimeout(hoverTimer.current);
      hoverTimer.current = null;
    }
  };

  const clearSensitiveUrl = useCallback(() => {
    revealGeneration.current += 1;
    pendingReveal.current = null;
    urlRef.current = null;
    setUrl(null);
    setRevealState("idle");
  }, []);

  const reveal = useCallback(async () => {
    if (urlRef.current) return urlRef.current;
    if (pendingReveal.current) return pendingReveal.current;

    const generation = revealGeneration.current;
    setRevealState("loading");
    const request = onReveal()
      .then((nextUrl) => {
        if (generation === revealGeneration.current) {
          urlRef.current = nextUrl;
          setUrl(nextUrl);
          setRevealState("ready");
        }
        return nextUrl;
      })
      .catch((error: unknown) => {
        if (generation === revealGeneration.current) setRevealState("error");
        throw error;
      })
      .finally(() => {
        if (pendingReveal.current === request) pendingReveal.current = null;
      });
    pendingReveal.current = request;
    return request;
  }, [onReveal]);

  const measurePopoverPlacement = useCallback(() => {
    if (!hoverOpenRef.current) return;
    const anchor = hoverAnchorRef.current;
    const popover = hoverPopoverRef.current;
    if (!anchor || !popover) return;

    const anchorRect = anchor.getBoundingClientRect();
    const popoverRect = popover.getBoundingClientRect();
    const visualViewport = window.visualViewport;
    const viewportLeft = visualViewport?.offsetLeft ?? 0;
    const viewportTop = visualViewport?.offsetTop ?? 0;
    const viewportWidth = visualViewport?.width ?? document.documentElement.clientWidth;
    const viewportHeight = visualViewport?.height ?? document.documentElement.clientHeight;
    const viewportRight = viewportLeft + viewportWidth;
    const viewportBottom = viewportTop + viewportHeight;
    const requiredSpace = popoverRect.height + QR_POPOVER_GAP_PX;
    const nextPlacement = chooseQrPopoverPlacement(
      anchorRect.top - viewportTop,
      viewportBottom - anchorRect.bottom,
      requiredSpace
    );

    const horizontalInset =
      viewportWidth >= popoverRect.width + QR_POPOVER_GAP_PX * 2
        ? QR_POPOVER_GAP_PX
        : 0;
    const verticalInset =
      viewportHeight >= popoverRect.height + QR_POPOVER_GAP_PX * 2
        ? QR_POPOVER_GAP_PX
        : 0;
    const minLeft = viewportLeft + horizontalInset;
    const maxLeft = Math.max(
      minLeft,
      viewportRight - popoverRect.width - horizontalInset
    );
    const minTop = viewportTop + verticalInset;
    const maxTop = Math.max(
      minTop,
      viewportBottom - popoverRect.height - verticalInset
    );
    const preferredTop =
      nextPlacement === "down"
        ? anchorRect.bottom + QR_POPOVER_GAP_PX
        : anchorRect.top - popoverRect.height - QR_POPOVER_GAP_PX;
    const left = clamp(anchorRect.right - popoverRect.width, minLeft, maxLeft);
    const top = clamp(preferredTop, minTop, maxTop);
    const arrowLeft = clamp(
      anchorRect.left + anchorRect.width / 2 - left,
      14,
      popoverRect.width - 14
    );

    setPopoverPlacement((current) =>
      current === nextPlacement ? current : nextPlacement
    );
    setPopoverPosition((current) =>
      current.left === left && current.top === top && current.arrowLeft === arrowLeft
        ? current
        : { left, top, arrowLeft }
    );
    setPopoverPositionReady(true);
  }, []);

  const schedulePopoverMeasurement = useCallback(() => {
    if (!hoverOpenRef.current || placementFrame.current !== null) return;
    placementFrame.current = window.requestAnimationFrame(() => {
      placementFrame.current = null;
      measurePopoverPlacement();
    });
  }, [measurePopoverPlacement]);

  useLayoutEffect(() => {
    if (!hoverOpen) return;

    measurePopoverPlacement();
    const resizeObserver =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(schedulePopoverMeasurement);
    if (hoverAnchorRef.current) resizeObserver?.observe(hoverAnchorRef.current);
    if (hoverPopoverRef.current) resizeObserver?.observe(hoverPopoverRef.current);

    window.addEventListener("resize", schedulePopoverMeasurement);
    window.addEventListener("scroll", schedulePopoverMeasurement, true);
    window.visualViewport?.addEventListener("resize", schedulePopoverMeasurement);
    window.visualViewport?.addEventListener("scroll", schedulePopoverMeasurement);

    return () => {
      window.removeEventListener("resize", schedulePopoverMeasurement);
      window.removeEventListener("scroll", schedulePopoverMeasurement, true);
      window.visualViewport?.removeEventListener("resize", schedulePopoverMeasurement);
      window.visualViewport?.removeEventListener("scroll", schedulePopoverMeasurement);
      resizeObserver?.disconnect();
      if (placementFrame.current !== null) {
        window.cancelAnimationFrame(placementFrame.current);
        placementFrame.current = null;
      }
    };
  }, [hoverOpen, measurePopoverPlacement, schedulePopoverMeasurement]);

  const startHoverPreview = (immediate = false) => {
    clearHoverTimer();
    hoverTimer.current = setTimeout(() => {
      setPopoverPlacement("down");
      setPopoverPositionReady(false);
      hoverOpenRef.current = true;
      setHoverOpen(true);
      void reveal().catch(() => undefined);
    }, immediate ? 0 : 180);
  };

  const stopHoverPreview = () => {
    clearHoverTimer();
    hoverOpenRef.current = false;
    setHoverOpen(false);
    setPopoverPositionReady(false);
    if (!dialogOpenRef.current) clearSensitiveUrl();
  };

  const handleBlur = (event: FocusEvent<HTMLSpanElement>) => {
    if (!event.currentTarget.contains(event.relatedTarget)) {
      focusWithin.current = false;
      stopHoverPreview();
    }
  };

  const copyUrl = async () => {
    setCopyState("loading");
    try {
      const nextUrl = await reveal();
      await navigator.clipboard.writeText(nextUrl);
      setCopyState("copied");
      toast.success("已复制到剪贴板");
      if (copyResetTimer.current !== null) clearTimeout(copyResetTimer.current);
      copyResetTimer.current = setTimeout(() => {
        setCopyState("idle");
        if (!hoverOpenRef.current && !dialogOpenRef.current) clearSensitiveUrl();
      }, 1500);
    } catch (error) {
      setCopyState("idle");
      toast.error(error instanceof Error ? error.message : "复制失败，请重试");
    }
  };

  useEffect(
    () => () => {
      clearHoverTimer();
      if (copyResetTimer.current !== null) clearTimeout(copyResetTimer.current);
      if (placementFrame.current !== null) window.cancelAnimationFrame(placementFrame.current);
      revealGeneration.current += 1;
    },
    []
  );

  return (
    <>
      <span className="inline-flex items-center gap-1.5">
        <span
          ref={hoverAnchorRef}
          className="relative inline-flex"
          onMouseEnter={() => startHoverPreview(false)}
          onMouseLeave={() => {
            if (!focusWithin.current) stopHoverPreview();
          }}
          onFocusCapture={() => {
            focusWithin.current = true;
            startHoverPreview(true);
          }}
          onBlur={handleBlur}
        >
          <Button
            size={size}
            variant={variant}
            disabled={copyState === "loading"}
            onClick={() => void copyUrl()}
          >
            {copyState === "copied" ? (
              <Check className="size-3.5 text-ok" />
            ) : (
              <Copy className="size-3.5" />
            )}
            {label}
          </Button>
          {hoverOpen ? (
            <span
              ref={hoverPopoverRef}
              role="tooltip"
              data-testid="subscription-qr-popover"
              data-placement={popoverPlacement}
              style={{ left: popoverPosition.left, top: popoverPosition.top }}
              className={cn(
                "pointer-events-none fixed z-50 flex w-[206px] max-w-[calc(100dvw-16px)] flex-col items-center gap-2 rounded-lg border border-line-strong bg-surface p-3 shadow-2xl shadow-black/60",
                !popoverPositionReady && "invisible"
              )}
            >
              <span className="self-start text-[11px] font-semibold text-muted">扫码导入当前订阅</span>
              {url ? (
                <QrCode url={url} size={176} />
              ) : revealState === "error" ? (
                <span className="grid h-44 w-44 place-items-center rounded-md border border-err/30 bg-err-bg px-4 text-center text-[11px] text-err">
                  二维码暂不可用，请点击复制重试
                </span>
              ) : (
                <span aria-live="polite" className="grid h-44 w-44 place-items-center rounded-md bg-white text-[11px] text-slate-500">
                  正在安全读取链接…
                </span>
              )}
              <span
                style={{ left: popoverPosition.arrowLeft - 6 }}
                className={cn(
                  "absolute size-3 rotate-45 bg-surface",
                  popoverPlacement === "down"
                    ? "-top-1.5 border-l border-t border-line-strong"
                    : "-bottom-1.5 border-b border-r border-line-strong"
                )}
              />
            </span>
          ) : null}
        </span>
        {showQrButton ? (
          <Button
            size={size}
            variant={variant}
            aria-label={`显示${qrTitle}`}
            title={`显示${qrTitle}`}
            onClick={() => {
              dialogOpenRef.current = true;
              setDialogOpen(true);
              void reveal().catch((error: unknown) =>
                toast.error(error instanceof Error ? error.message : "二维码生成失败，请重试")
              );
            }}
          >
            <QrCodeIcon className="size-3.5" />
            {qrButtonLabel}
          </Button>
        ) : null}
      </span>
      <Dialog
        open={dialogOpen}
        onOpenChange={(open) => {
          dialogOpenRef.current = open;
          setDialogOpen(open);
          if (!open && !hoverOpenRef.current) clearSensitiveUrl();
        }}
      >
        <DialogContent
          title={qrTitle}
          description="用 Clash / Mihomo 客户端扫描导入；二维码只在当前弹窗中本地生成。"
        >
          <div className="flex flex-col items-center gap-3">
            {url ? (
              <QrCode url={url} size={192} />
            ) : revealState === "error" ? (
              <p className="rounded-md border border-err/30 bg-err-bg px-3 py-2 text-xs text-err">
                链接读取失败，请关闭后重试。
              </p>
            ) : (
              <div aria-live="polite" className="grid size-48 place-items-center rounded-md bg-white text-xs text-slate-500">
                正在安全读取链接…
              </div>
            )}
            <Button size="sm" onClick={() => void copyUrl()} disabled={copyState === "loading" || !url}>
              {copyState === "copied" ? <Check className="size-3.5 text-ok" /> : <Copy className="size-3.5" />}
              {copyState === "copied" ? "已复制" : "复制链接"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
};

// 工作台卡片 / 订阅列表通用的「复制链接」快捷按钮：一步读取已有长期链接。
export const CopyLinkButton = ({
  subscriptionId,
  size,
  variant,
  label
}: {
  subscriptionId: string;
  size?: ButtonProps["size"];
  variant?: ButtonProps["variant"];
  label?: string;
}) => {
  const mutations = useSubscriptionMutations(subscriptionId);
  return (
    <AsyncCopyButton
      size={size}
      variant={variant}
      label={label}
      showQrButton
      onReveal={async () => (await mutations.copyPrimaryLink.mutateAsync()).url}
    />
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
