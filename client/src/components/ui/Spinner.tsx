import { forwardRef, type HTMLAttributes } from "react";
import { cn } from "../../lib/cn";

export const Spinner = forwardRef<
  HTMLSpanElement,
  HTMLAttributes<HTMLSpanElement> & { size?: "sm" | "md" | "lg" }
>(({ className, size = "md", ...props }, ref) => {
  const sizeClass =
    size === "sm" ? "h-3.5 w-3.5 border" : size === "lg" ? "h-7 w-7 border-2" : "h-5 w-5 border-2";

  return (
    <span
      ref={ref}
      role="status"
      aria-label="Loading"
      className={cn(
        "inline-block animate-spin-slow rounded-full border-white/20 border-t-white",
        sizeClass,
        className,
      )}
      {...props}
    />
  );
});
Spinner.displayName = "Spinner";
