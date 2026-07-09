import { FlaskConical } from "lucide-react";
import { cn } from "../../lib/cn";

interface Props {
  className?: string;
  iconClassName?: string;
}

export function LiveFlaskIcon({ className, iconClassName }: Props) {
  return (
    <span className={cn("relative inline-flex shrink-0", className)}>
      <FlaskConical className={cn("h-4 w-4", iconClassName)} aria-hidden />
      <span
        className="absolute -right-0.5 -top-0.5 flex h-2 w-2"
        aria-hidden
      >
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-75" />
        <span className="relative inline-flex h-2 w-2 rounded-full bg-primary" />
      </span>
    </span>
  );
}
