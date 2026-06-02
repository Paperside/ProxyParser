import type { HTMLAttributes } from "react";

import { cn } from "../../lib/cn";

export const Card = ({ className, ...props }: HTMLAttributes<HTMLDivElement>) => {
  return (
    <div
      className={cn(
        "rounded-lg border border-[#dedcd1] bg-[#fffdf8] p-5 shadow-[0_1px_2px_rgba(20,20,19,0.04)]",
        className
      )}
      {...props}
    />
  );
};
