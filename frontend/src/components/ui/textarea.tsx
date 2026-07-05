import * as React from "react";

import { cn } from "../../lib/cn";

export const Textarea = React.forwardRef<
  HTMLTextAreaElement,
  React.TextareaHTMLAttributes<HTMLTextAreaElement>
>(({ className, ...props }, ref) => (
  <textarea
    ref={ref}
    className={cn(
      "min-h-24 w-full rounded-md border border-line-strong bg-bg px-2.5 py-2 font-mono text-xs text-ink placeholder:text-faint focus:border-accent focus:outline-none",
      className
    )}
    {...props}
  />
));

Textarea.displayName = "Textarea";
