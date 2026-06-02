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
        "inline-flex rounded-lg border border-[#dedcd1] bg-[#f5f4ed] p-1",
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
        "inline-flex min-w-28 items-center justify-center rounded-md px-4 py-2.5 text-sm font-medium text-[#73726c] transition outline-none focus-visible:ring-2 focus-visible:ring-[#c96442]/35 data-[state=active]:bg-[#141413] data-[state=active]:text-[#faf9f5]",
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
