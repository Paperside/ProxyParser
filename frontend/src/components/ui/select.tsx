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
        "inline-flex h-12 w-full items-center justify-between rounded-lg border border-[#dedcd1] bg-[#fffdf8] px-4 text-sm text-[#141413] outline-none transition-[border-color,box-shadow,background-color] focus:border-[#c96442] focus:bg-white focus:shadow-[0_0_0_3px_rgba(201,100,66,0.12)]",
        className
      )}
      {...props}
    >
      {children}
      <SelectPrimitive.Icon>
        <ChevronDown className="size-4 text-[#73726c]" />
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
          "z-50 overflow-hidden rounded-lg border border-[#dedcd1] bg-[#fffdf8] p-1 shadow-[0_12px_28px_rgba(20,20,19,0.12)]",
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
        "relative flex cursor-default select-none items-center rounded-md py-2 pl-9 pr-3 text-sm text-[#3d3d3a] outline-none data-[highlighted]:bg-[#f1eee6] data-[highlighted]:text-[#141413]",
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
