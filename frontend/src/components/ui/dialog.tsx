import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";

import { cn } from "../../lib/cn";

export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;

export const DialogContent = ({
  className,
  children,
  ...props
}: DialogPrimitive.DialogContentProps) => {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-[#141413]/24" />
      <DialogPrimitive.Content
        className={cn(
          "pp-soft-pop fixed left-1/2 top-1/2 z-50 w-[min(92vw,640px)] -translate-x-1/2 -translate-y-1/2 rounded-xl border border-[#dedcd1] bg-[#fffdf8] p-6 shadow-[0_18px_50px_rgba(20,20,19,0.16)] outline-none",
          className
        )}
        {...props}
      >
        {children}
        <DialogPrimitive.Close className="absolute right-4 top-4 rounded-md p-2 text-[#73726c] transition hover:bg-[#f1eee6] hover:text-[#141413] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#c96442]/35">
          <X className="size-4" />
          <span className="sr-only">关闭</span>
        </DialogPrimitive.Close>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
};

export const DialogHeader = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => {
  return <div className={cn("space-y-1.5", className)} {...props} />;
};

export const DialogTitle = ({
  className,
  ...props
}: DialogPrimitive.DialogTitleProps) => {
  return <DialogPrimitive.Title className={cn("text-xl font-semibold text-[#141413]", className)} {...props} />;
};

export const DialogDescription = ({
  className,
  ...props
}: DialogPrimitive.DialogDescriptionProps) => {
  return <DialogPrimitive.Description className={cn("text-sm text-[#73726c]", className)} {...props} />;
};
