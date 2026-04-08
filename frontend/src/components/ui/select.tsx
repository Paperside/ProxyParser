import * as SelectPrimitive from "@radix-ui/react-select";
import { Check, ChevronDown } from "lucide-react";

import { cn } from "../../lib/cn";

export const Select = SelectPrimitive.Root;
export const SelectValue = SelectPrimitive.Value;

export const SelectTrigger = ({
  className,
  children,
  ...props
}: SelectPrimitive.SelectTriggerProps) => {
  return (
    <SelectPrimitive.Trigger
      className={cn(
        "inline-flex h-12 w-full items-center justify-between rounded-2xl border border-slate-200 bg-white/90 px-4 text-sm text-slate-900 outline-none focus:border-slate-950",
        className
      )}
      {...props}
    >
      {children}
      <SelectPrimitive.Icon>
        <ChevronDown className="size-4 text-slate-400" />
      </SelectPrimitive.Icon>
    </SelectPrimitive.Trigger>
  );
};

export const SelectContent = ({
  className,
  children,
  ...props
}: SelectPrimitive.SelectContentProps) => {
  return (
    <SelectPrimitive.Portal>
      <SelectPrimitive.Content
        className={cn(
          "z-50 overflow-hidden rounded-2xl border border-slate-200 bg-white p-1 shadow-[0_22px_50px_rgba(15,23,42,0.16)]",
          className
        )}
        position="popper"
        {...props}
      >
        <SelectPrimitive.Viewport className="p-1">{children}</SelectPrimitive.Viewport>
      </SelectPrimitive.Content>
    </SelectPrimitive.Portal>
  );
};

export const SelectItem = ({
  className,
  children,
  ...props
}: SelectPrimitive.SelectItemProps) => {
  return (
    <SelectPrimitive.Item
      className={cn(
        "relative flex cursor-default select-none items-center rounded-xl py-2 pl-9 pr-3 text-sm text-slate-700 outline-none data-[highlighted]:bg-slate-100 data-[highlighted]:text-slate-950",
        className
      )}
      {...props}
    >
      <SelectPrimitive.ItemIndicator className="absolute left-3 inline-flex items-center">
        <Check className="size-4" />
      </SelectPrimitive.ItemIndicator>
      <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
    </SelectPrimitive.Item>
  );
};
