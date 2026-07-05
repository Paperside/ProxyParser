import type { HTMLAttributes } from "react";

import { cn } from "../../lib/cn";

export const Card = ({ className, ...props }: HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn("rounded-[10px] border border-line bg-surface p-4", className)}
    {...props}
  />
);

export const CardTitle = ({ className, ...props }: HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn("mb-2.5 flex items-center gap-2 text-[13px] font-semibold", className)}
    {...props}
  />
);
