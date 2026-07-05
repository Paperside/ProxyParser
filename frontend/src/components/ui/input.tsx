import * as React from "react";

import { cn } from "../../lib/cn";

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => (
    <input
      ref={ref}
      className={cn(
        "h-8 w-full rounded-md border border-line-strong bg-bg px-2.5 text-[13px] text-ink placeholder:text-faint focus:border-accent focus:outline-none",
        className
      )}
      {...props}
    />
  )
);

Input.displayName = "Input";

export const Field = ({
  label,
  hint,
  children
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) => (
  <label className="flex flex-col gap-1.5">
    <span className="text-xs font-medium text-muted">{label}</span>
    {children}
    {hint ? <span className="text-[11px] text-faint">{hint}</span> : null}
  </label>
);
