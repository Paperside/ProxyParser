import type { HTMLAttributes } from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "../../lib/cn";

const badgeVariants = cva(
  "inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-px text-[11.5px]",
  {
    variants: {
      variant: {
        default: "border-line-strong text-muted",
        ok: "border-transparent bg-ok-bg text-ok",
        warn: "border-transparent bg-warn-bg text-warn",
        err: "border-transparent bg-err-bg text-err",
        accent: "border-transparent bg-accent-bg text-accent",
        mono: "border-line-strong font-mono text-xs text-muted"
      }
    },
    defaultVariants: { variant: "default" }
  }
);

export interface BadgeProps
  extends HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

export const Badge = ({ className, variant, ...props }: BadgeProps) => (
  <span className={cn(badgeVariants({ variant }), className)} {...props} />
);
