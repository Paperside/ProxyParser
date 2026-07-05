import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "../../lib/cn";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-md text-[13px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 disabled:pointer-events-none disabled:opacity-50 cursor-pointer",
  {
    variants: {
      variant: {
        primary: "bg-accent-strong text-on-accent font-semibold hover:bg-accent",
        secondary: "border border-line-strong bg-surface2 text-ink hover:border-faint",
        ghost: "text-muted hover:bg-surface2 hover:text-ink",
        danger: "border border-err/40 text-err hover:bg-err-bg"
      },
      size: {
        default: "h-8 px-3",
        sm: "h-6.5 px-2 text-xs",
        lg: "h-9 px-4"
      }
    },
    defaultVariants: { variant: "secondary", size: "default" }
  }
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, ...props }, ref) => (
    <button ref={ref} className={cn(buttonVariants({ variant, size }), className)} {...props} />
  )
);

Button.displayName = "Button";
