import { useCallback, useEffect, useRef, useState } from "react";

export interface ResizableWidthOptions {
  storageKey: string;
  defaultWidth: number;
  minWidth: number;
  maxWidth: number;
  /** Which side of the resize handle the panel sits on. */
  edge: "left" | "right";
}

export const DEBUG_PANEL_RESIZE: ResizableWidthOptions = {
  storageKey: "db-agent-debug-panel-width",
  defaultWidth: 360,
  minWidth: 280,
  maxWidth: 720,
  edge: "right",
};

export const SIDEBAR_RESIZE: ResizableWidthOptions = {
  storageKey: "db-agent-sidebar-width",
  defaultWidth: 280,
  minWidth: 220,
  maxWidth: 480,
  edge: "left",
};

function readStoredWidth(options: ResizableWidthOptions): number {
  if (typeof window === "undefined") return options.defaultWidth;
  const stored = window.localStorage.getItem(options.storageKey);
  const parsed = stored ? Number.parseInt(stored, 10) : NaN;
  if (!Number.isFinite(parsed)) return options.defaultWidth;
  return Math.min(options.maxWidth, Math.max(options.minWidth, parsed));
}

export function useResizableWidth(
  enabled: boolean,
  options: ResizableWidthOptions = DEBUG_PANEL_RESIZE,
) {
  const [width, setWidth] = useState(() => readStoredWidth(options));
  const dragging = useRef(false);
  const startX = useRef(0);
  const startWidth = useRef(width);
  const optionsRef = useRef(options);
  optionsRef.current = options;

  const onPointerMove = useCallback((event: PointerEvent) => {
    if (!dragging.current) return;
    const { minWidth, maxWidth, edge } = optionsRef.current;
    const rawDelta = event.clientX - startX.current;
    const delta = edge === "left" ? rawDelta : -rawDelta;
    const next = Math.min(maxWidth, Math.max(minWidth, startWidth.current + delta));
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
    window.localStorage.setItem(options.storageKey, String(width));
  }, [enabled, options.storageKey, width]);

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

  return {
    width,
    startResize,
    minWidth: options.minWidth,
    maxWidth: options.maxWidth,
  };
}
