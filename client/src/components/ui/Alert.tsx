import { forwardRef, type HTMLAttributes } from "react";
import { AlertCircle, CheckCircle2, Info, X, AlertTriangle } from "lucide-react";
import { cn } from "../../lib/cn";
import { Button } from "./Button";

const variants = {
  error: {
    className: "border-destructive/30 bg-destructive/10 text-destructive",
    Icon: AlertCircle,
  },
  success: {
    className: "border-success/30 bg-success/10 text-success",
    Icon: CheckCircle2,
  },
  warning: {
    className: "border-warning/30 bg-warning/10 text-warning",
    Icon: AlertTriangle,
  },
  info: {
    className: "border-info/30 bg-info/10 text-info",
    Icon: Info,
  },
} as const;

export interface AlertProps extends HTMLAttributes<HTMLDivElement> {
  variant?: keyof typeof variants;
  onDismiss?: () => void;
  title?: string;
}

export const Alert = forwardRef<HTMLDivElement, AlertProps>(
  ({ className, variant = "info", onDismiss, title, children, ...props }, ref) => {
    const { className: variantClass, Icon } = variants[variant];

    return (
      <div
        ref={ref}
        role="alert"
        className={cn(
          "relative flex gap-3 rounded-lg border px-4 py-3 text-sm",
          variantClass,
          className,
        )}
        {...props}
      >
        <Icon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
        <div className="min-w-0 flex-1">
          {title && <p className="mb-1 font-medium">{title}</p>}
          <div className="leading-relaxed">{children}</div>
        </div>
        {onDismiss && (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-6 w-6 shrink-0 text-current hover:bg-black/10"
            onClick={onDismiss}
            aria-label="Dismiss"
          >
            <X className="h-3.5 w-3.5" />
          </Button>
        )}
      </div>
    );
  },
);
Alert.displayName = "Alert";
