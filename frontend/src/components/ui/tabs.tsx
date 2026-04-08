import * as TabsPrimitive from "@radix-ui/react-tabs";

import { cn } from "../../lib/cn";

export const Tabs = TabsPrimitive.Root;

export const TabsList = ({
  className,
  ...props
}: TabsPrimitive.TabsListProps) => {
  return (
    <TabsPrimitive.List
      className={cn(
        "inline-flex rounded-2xl border border-slate-200 bg-white/90 p-1 shadow-[0_12px_30px_rgba(15,23,42,0.06)]",
        className
      )}
      {...props}
    />
  );
};

export const TabsTrigger = ({
  className,
  ...props
}: TabsPrimitive.TabsTriggerProps) => {
  return (
    <TabsPrimitive.Trigger
      className={cn(
        "inline-flex min-w-28 items-center justify-center rounded-xl px-4 py-2.5 text-sm font-medium text-slate-500 transition outline-none data-[state=active]:bg-slate-950 data-[state=active]:text-white",
        className
      )}
      {...props}
    />
  );
};

export const TabsContent = ({
  className,
  ...props
}: TabsPrimitive.TabsContentProps) => {
  return <TabsPrimitive.Content className={cn("outline-none", className)} {...props} />;
};
