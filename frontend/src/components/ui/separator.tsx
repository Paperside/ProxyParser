import * as SeparatorPrimitive from "@radix-ui/react-separator";

import { cn } from "../../lib/cn";

export const Separator = ({
  className,
  ...props
}: SeparatorPrimitive.SeparatorProps) => {
  return (
    <SeparatorPrimitive.Root
      className={cn("h-px w-full bg-[#dedcd1]", className)}
      {...props}
    />
  );
};
