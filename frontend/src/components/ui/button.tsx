import * as React from "react";

import { cn } from "../../lib/cn";

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
}

const variants: Record<ButtonVariant, string> = {
  primary:
    "bg-slate-950 text-white shadow-[0_12px_30px_rgba(15,23,42,0.18)] hover:bg-slate-800",
  secondary:
    "border border-slate-200 bg-white/90 text-slate-700 hover:bg-white hover:text-slate-950",
  ghost: "bg-transparent text-slate-600 hover:bg-slate-100 hover:text-slate-950",
  danger: "bg-rose-600 text-white hover:bg-rose-700"
};

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = "primary", ...props }, ref) => {
    return (
      <button
        ref={ref}
        className={cn(
          "inline-flex items-center justify-center gap-2 rounded-2xl px-4 py-2.5 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-60",
          variants[variant],
          className
        )}
        {...props}
      />
    );
  }
);

Button.displayName = "Button";
