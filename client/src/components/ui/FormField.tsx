import { forwardRef, type HTMLAttributes } from "react";
import { cn } from "../../lib/cn";

export const FormField = forwardRef<
  HTMLDivElement,
  HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div ref={ref} className={cn("grid gap-2", className)} {...props} />
));
FormField.displayName = "FormField";

export function FormError({ message }: { message?: string | null }) {
  if (!message) return null;
  return <p className="text-xs text-destructive">{message}</p>;
}
