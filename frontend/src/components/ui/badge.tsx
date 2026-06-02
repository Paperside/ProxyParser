import type { HTMLAttributes } from "react";

import { cn } from "../../lib/cn";

export const Badge = ({
  className,
  ...props
}: HTMLAttributes<HTMLSpanElement>) => {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-md border border-[#dedcd1] bg-[#f5f4ed] px-2 py-0.5 text-xs font-medium text-[#73726c]",
        className
      )}
      {...props}
    />
  );
};
