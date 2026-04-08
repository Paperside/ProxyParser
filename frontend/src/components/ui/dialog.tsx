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
      <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-slate-950/30 backdrop-blur-sm" />
      <DialogPrimitive.Content
        className={cn(
          "fixed left-1/2 top-1/2 z-50 w-[min(92vw,640px)] -translate-x-1/2 -translate-y-1/2 rounded-[28px] border border-white/60 bg-[#fbfdff] p-6 shadow-[0_28px_80px_rgba(15,23,42,0.18)] outline-none",
          className
        )}
        {...props}
      >
        {children}
        <DialogPrimitive.Close className="absolute right-4 top-4 rounded-full p-2 text-slate-400 transition hover:bg-slate-100 hover:text-slate-950">
          <X className="size-4" />
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
  return <DialogPrimitive.Title className={cn("text-xl font-semibold text-slate-950", className)} {...props} />;
};

export const DialogDescription = ({
  className,
  ...props
}: DialogPrimitive.DialogDescriptionProps) => {
  return <DialogPrimitive.Description className={cn("text-sm text-slate-500", className)} {...props} />;
};
