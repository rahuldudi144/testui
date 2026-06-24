import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { forwardRef, type ComponentPropsWithoutRef, type ElementRef, type ReactNode } from "react";
import { cn } from "../../lib/cn";

interface SheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: ReactNode;
  side?: "left" | "right";
  title?: string;
  description?: string;
  className?: string;
}

export function Sheet({
  open,
  onOpenChange,
  children,
  side = "right",
  title,
  description,
  className,
}: SheetProps) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm data-[state=open]:animate-fade-in" />
        <DialogPrimitive.Content
          className={cn(
            "fixed z-50 flex h-full flex-col border-border bg-card shadow-xl focus:outline-none",
            side === "left" && "inset-y-0 left-0 w-full max-w-[280px] border-r data-[state=open]:animate-[slide-in-left_200ms_ease-out]",
            side === "right" && "inset-y-0 right-0 w-full max-w-sm border-l data-[state=open]:animate-[slide-in-right_200ms_ease-out]",
            className,
          )}
        >
          {(title || description) && (
            <div className="border-b border-border px-4 py-3 pr-12">
              {title && (
                <DialogPrimitive.Title className="text-sm font-semibold">
                  {title}
                </DialogPrimitive.Title>
              )}
              {description && (
                <DialogPrimitive.Description className="mt-0.5 text-xs text-muted-foreground">
                  {description}
                </DialogPrimitive.Description>
              )}
            </div>
          )}
          <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
          <DialogPrimitive.Close className="absolute right-3 top-3 rounded-sm text-muted-foreground opacity-70 transition-opacity hover:opacity-100 focus-ring">
            <X className="h-4 w-4" />
            <span className="sr-only">Close</span>
          </DialogPrimitive.Close>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

export const SheetHeader = forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn("border-b border-border px-4 py-3", className)} {...props} />
  ),
);
SheetHeader.displayName = "SheetHeader";

export type SheetContentProps = ComponentPropsWithoutRef<typeof DialogPrimitive.Content>;
export type SheetContentRef = ElementRef<typeof DialogPrimitive.Content>;
