export function ResizeHandle({
  label,
  onPointerDown,
  className,
}: {
  label: string;
  onPointerDown: (event: React.PointerEvent<HTMLDivElement>) => void;
  className?: string;
}) {
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      onPointerDown={onPointerDown}
      className={
        className ??
        "group relative w-1 shrink-0 cursor-col-resize touch-none bg-border/40"
      }
    >
      <div className="absolute inset-y-0 -left-1.5 -right-1.5" />
      <div className="absolute inset-y-0 left-0 w-px bg-border transition-colors group-hover:bg-primary/50 group-active:bg-primary" />
    </div>
  );
}
