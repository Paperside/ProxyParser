import * as TabsPrimitive from "@radix-ui/react-tabs";

import { cn } from "../../lib/cn";

export const Tabs = TabsPrimitive.Root;
export const TabsContent = TabsPrimitive.Content;

export const TabsList = ({ className, ...props }: TabsPrimitive.TabsListProps) => (
  <TabsPrimitive.List
    className={cn("flex gap-0.5 rounded-md border border-line p-0.5", className)}
    {...props}
  />
);

export const TabsTrigger = ({ className, ...props }: TabsPrimitive.TabsTriggerProps) => (
  <TabsPrimitive.Trigger
    className={cn(
      "flex-1 rounded px-2 py-1 text-xs text-muted transition-colors data-[state=active]:bg-surface2 data-[state=active]:font-medium data-[state=active]:text-ink cursor-pointer",
      className
    )}
    {...props}
  />
);
