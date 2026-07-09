import { cn } from "../../lib/cn";

interface Props {
  completedQueries: number;
  totalQueries: number;
  queryIndex: number;
  className?: string;
  size?: "sm" | "md";
}

export function WorkflowTestProgressBar({
  completedQueries,
  totalQueries,
  queryIndex,
  className,
  size = "md",
}: Props) {
  const inFlight = queryIndex > completedQueries;
  const completedPct =
    totalQueries > 0 ? Math.round((completedQueries / totalQueries) * 100) : 0;

  return (
    <div
      className={cn(
        "relative w-full overflow-hidden rounded-full bg-muted",
        size === "sm" ? "h-1" : "h-2",
        className,
      )}
      role="progressbar"
      aria-valuenow={completedPct}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={`${completedQueries} of ${totalQueries} queries completed`}
    >
      {inFlight && completedQueries === 0 ? (
        <div
          className={cn(
            "h-full w-full rounded-full",
            "bg-gradient-to-r from-primary/20 via-primary/50 to-primary/20",
            "bg-[length:200%_100%] motion-safe:animate-[shimmer_1.5s_ease-in-out_infinite]",
          )}
        />
      ) : (
        <>
          <div
            className="h-full rounded-full bg-primary transition-all duration-300"
            style={{ width: `${completedPct}%` }}
          />
          {inFlight && (
            <div
              className={cn(
                "absolute inset-y-0 rounded-full",
                "bg-gradient-to-r from-primary/20 via-primary/50 to-primary/20",
                "bg-[length:200%_100%] motion-safe:animate-[shimmer_1.5s_ease-in-out_infinite]",
              )}
              style={{ left: `${completedPct}%`, right: 0 }}
            />
          )}
        </>
      )}
    </div>
  );
}
