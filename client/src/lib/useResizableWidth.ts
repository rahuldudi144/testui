import { useCallback, useEffect, useRef, useState } from "react";

const STORAGE_KEY = "db-agent-debug-panel-width";
const DEFAULT_WIDTH = 360;
const MIN_WIDTH = 280;
const MAX_WIDTH = 720;

function readStoredWidth(): number {
  if (typeof window === "undefined") return DEFAULT_WIDTH;
  const stored = window.localStorage.getItem(STORAGE_KEY);
  const parsed = stored ? Number.parseInt(stored, 10) : NaN;
  if (!Number.isFinite(parsed)) return DEFAULT_WIDTH;
  return Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, parsed));
}

export function useResizableWidth(enabled: boolean) {
  const [width, setWidth] = useState(readStoredWidth);
  const dragging = useRef(false);
  const startX = useRef(0);
  const startWidth = useRef(width);

  const onPointerMove = useCallback((event: PointerEvent) => {
    if (!dragging.current) return;
    const delta = startX.current - event.clientX;
    const next = Math.min(
      MAX_WIDTH,
      Math.max(MIN_WIDTH, startWidth.current + delta),
    );
    setWidth(next);
  }, []);

  const stopDragging = useCallback(() => {
    if (!dragging.current) return;
    dragging.current = false;
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
  }, []);

  useEffect(() => {
    if (!enabled) return;

    const onPointerUp = () => stopDragging();

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", onPointerUp);

    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onPointerUp);
      stopDragging();
    };
  }, [enabled, onPointerMove, stopDragging]);

  useEffect(() => {
    if (!enabled) return;
    window.localStorage.setItem(STORAGE_KEY, String(width));
  }, [enabled, width]);

  function startResize(event: React.PointerEvent<HTMLDivElement>) {
    if (!enabled) return;
    event.preventDefault();
    dragging.current = true;
    startX.current = event.clientX;
    startWidth.current = width;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  return { width, startResize, minWidth: MIN_WIDTH, maxWidth: MAX_WIDTH };
}
