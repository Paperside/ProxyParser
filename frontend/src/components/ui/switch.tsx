import * as SwitchPrimitive from "@radix-ui/react-switch";

import { cn } from "../../lib/cn";

export const Switch = ({ className, ...props }: SwitchPrimitive.SwitchProps) => (
  <SwitchPrimitive.Root
    className={cn(
      "relative h-5 w-9 shrink-0 cursor-pointer rounded-full border border-line-strong bg-surface2 outline-none transition-colors data-[state=checked]:border-accent-strong data-[state=checked]:bg-accent-strong",
      className
    )}
    {...props}
  >
    <SwitchPrimitive.Thumb className="block size-3.5 translate-x-0.5 rounded-full bg-ink/80 transition-transform data-[state=checked]:translate-x-4 data-[state=checked]:bg-on-accent" />
  </SwitchPrimitive.Root>
);
