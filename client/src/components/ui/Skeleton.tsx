import { forwardRef, type HTMLAttributes } from "react";
import { cn } from "../../lib/cn";

export const Skeleton = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn("animate-shimmer rounded-md", className)}
      aria-hidden
      {...props}
    />
  ),
);
Skeleton.displayName = "Skeleton";
