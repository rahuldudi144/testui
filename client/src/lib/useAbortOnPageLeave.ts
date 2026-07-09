import { useEffect, useRef } from "react";

export function useAbortOnPageLeave(
  getController: () => AbortController | null,
) {
  const getControllerRef = useRef(getController);
  getControllerRef.current = getController;

  useEffect(() => {
    const abort = () => getControllerRef.current()?.abort();
    window.addEventListener("pagehide", abort);
    return () => {
      window.removeEventListener("pagehide", abort);
      abort();
    };
  }, []);
}
