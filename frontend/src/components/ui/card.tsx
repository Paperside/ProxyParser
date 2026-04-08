import type { HTMLAttributes } from "react";

import { cn } from "../../lib/cn";

export const Card = ({ className, ...props }: HTMLAttributes<HTMLDivElement>) => {
  return (
    <div
      className={cn(
        "rounded-[28px] border border-white/70 bg-white/75 p-6 shadow-[0_24px_60px_rgba(15,23,42,0.08)] backdrop-blur-xl",
        className
      )}
      {...props}
    />
  );
};
