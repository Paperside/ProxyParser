import * as React from "react";

import { cn } from "../../lib/cn";

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
}

const variants: Record<ButtonVariant, string> = {
  primary:
    "bg-[#141413] text-[#faf9f5] shadow-[0_1px_1px_rgba(20,20,19,0.16)] hover:bg-[#2b2b28] active:bg-[#050505]",
  secondary:
    "border border-[#dedcd1] bg-[#fffdf8] text-[#3d3d3a] hover:border-[#c9c6ba] hover:bg-white hover:text-[#141413]",
  ghost: "bg-transparent text-[#73726c] hover:bg-[#f1eee6] hover:text-[#141413]",
  danger: "bg-[#a73d39] text-[#faf9f5] hover:bg-[#8f302d]"
};

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = "primary", ...props }, ref) => {
    return (
      <button
        ref={ref}
        className={cn(
          "inline-flex min-h-10 items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-medium transition-[background-color,border-color,color,box-shadow,transform] duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#c96442]/35 focus-visible:ring-offset-2 focus-visible:ring-offset-[#faf9f5] active:translate-y-px disabled:cursor-not-allowed disabled:opacity-55 disabled:active:translate-y-0",
          variants[variant],
          className
        )}
        {...props}
      />
    );
  }
);

Button.displayName = "Button";
