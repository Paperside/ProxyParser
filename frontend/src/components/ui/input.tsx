import * as React from "react";

import { cn } from "../../lib/cn";

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => {
    return (
      <input
        ref={ref}
        className={cn(
          "w-full rounded-lg border border-[#dedcd1] bg-[#fffdf8] px-4 py-3 text-sm text-[#141413] outline-none transition-[border-color,box-shadow,background-color] placeholder:text-[#9c9a92] focus:border-[#c96442] focus:bg-white focus:shadow-[0_0_0_3px_rgba(201,100,66,0.12)]",
          className
        )}
        {...props}
      />
    );
  }
);

Input.displayName = "Input";
