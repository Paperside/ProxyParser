import { useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";

import { cn } from "../../lib/cn";

// 轻量折叠区：纯 state 实现，不引入新依赖。用于「高级配置」等默认收起的表单分区。
export const Collapsible = ({
  title,
  hint,
  defaultOpen = false,
  children
}: {
  title: string;
  hint?: string;
  defaultOpen?: boolean;
  children: ReactNode;
}) => {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="rounded-md border border-line">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-xs font-medium text-muted hover:text-ink"
      >
        <span className="flex items-center gap-1.5">
          {title}
          {hint ? <span className="text-[11px] font-normal text-faint">{hint}</span> : null}
        </span>
        <ChevronDown className={cn("size-3.5 text-faint transition-transform", open ? "rotate-180" : "")} />
      </button>
      {open ? <div className="flex flex-col gap-3 border-t border-line px-3 py-3">{children}</div> : null}
    </div>
  );
};
