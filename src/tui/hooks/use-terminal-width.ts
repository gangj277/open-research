import { useState, useEffect } from "react";
import { useStdout } from "ink";
import { getObservedTerminalWidth, getStableObservedTerminalWidth } from "@/tui/layout";

const RESIZE_DEBOUNCE_MS = 50;

export function useTerminalWidth() {
  const { stdout } = useStdout();
  const [terminalWidth, setTerminalWidth] = useState(() =>
    getObservedTerminalWidth((stdout as { columns?: number }).columns, process.stdout.columns)
  );

  useEffect(() => {
    const stream = stdout as NodeJS.WriteStream & { columns?: number };
    let resizeTimer: ReturnType<typeof setTimeout> | null = null;

    const commitWidth = () => {
      setTerminalWidth((current) => {
        const nextWidth = getStableObservedTerminalWidth(current, stream.columns, process.stdout.columns);
        return current === nextWidth ? current : nextWidth;
      });
    };

    const scheduleWidthUpdate = () => {
      if (resizeTimer) {
        clearTimeout(resizeTimer);
      }

      resizeTimer = setTimeout(() => {
        resizeTimer = null;
        commitWidth();
      }, RESIZE_DEBOUNCE_MS);
    };

    commitWidth();
    if (typeof stream.on === "function") {
      stream.on("resize", scheduleWidthUpdate);
      return () => {
        if (resizeTimer) {
          clearTimeout(resizeTimer);
        }
        if (typeof stream.off === "function") {
          stream.off("resize", scheduleWidthUpdate);
        }
      };
    }

    return () => {
      if (resizeTimer) {
        clearTimeout(resizeTimer);
      }
    };
  }, [stdout]);

  return terminalWidth;
}
