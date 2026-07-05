import * as SelectPrimitive from "@radix-ui/react-select";
import { Check, ChevronDown } from "lucide-react";

import { cn } from "../../lib/cn";

export const Select = SelectPrimitive.Root;
export const SelectValue = SelectPrimitive.Value;

export const SelectTrigger = ({ className, children, ...props }: SelectPrimitive.SelectTriggerProps) => (
  <SelectPrimitive.Trigger
    className={cn(
      "inline-flex h-8 w-full items-center justify-between gap-2 rounded-md border border-line-strong bg-bg px-2.5 text-[13px] text-ink outline-none focus:border-accent data-[placeholder]:text-faint",
      className
    )}
    {...props}
  >
    {children}
    <SelectPrimitive.Icon>
      <ChevronDown className="size-3.5 text-faint" />
    </SelectPrimitive.Icon>
  </SelectPrimitive.Trigger>
);

export const SelectContent = ({ className, children, ...props }: SelectPrimitive.SelectContentProps) => (
  <SelectPrimitive.Portal>
    <SelectPrimitive.Content
      className={cn(
        "z-50 max-h-72 overflow-hidden rounded-md border border-line-strong bg-surface2 shadow-xl shadow-black/40",
        className
      )}
      position="popper"
      sideOffset={4}
      {...props}
    >
      <SelectPrimitive.Viewport className="p-1">{children}</SelectPrimitive.Viewport>
    </SelectPrimitive.Content>
  </SelectPrimitive.Portal>
);

// 选项支持标题 + 描述（技术方案 §14 / v0.2 §11.2）
export const SelectItem = ({
  className,
  children,
  description,
  ...props
}: SelectPrimitive.SelectItemProps & { description?: string }) => (
  <SelectPrimitive.Item
    className={cn(
      "relative flex cursor-default select-none flex-col rounded py-1.5 pl-7 pr-3 text-[13px] text-ink outline-none data-[highlighted]:bg-accent-bg",
      className
    )}
    {...props}
  >
    <SelectPrimitive.ItemIndicator className="absolute left-2 top-2 inline-flex items-center">
      <Check className="size-3.5 text-accent" />
    </SelectPrimitive.ItemIndicator>
    <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
    {description ? <span className="text-[11.5px] text-muted">{description}</span> : null}
  </SelectPrimitive.Item>
);
