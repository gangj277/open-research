import { useState, useEffect } from "react";
import { useStdout } from "ink";
import { getObservedTerminalWidth } from "@/tui/layout";

export function useTerminalWidth() {
  const { stdout } = useStdout();
  const [terminalWidth, setTerminalWidth] = useState(() =>
    getObservedTerminalWidth((stdout as { columns?: number }).columns, process.stdout.columns)
  );

  useEffect(() => {
    const stream = stdout as NodeJS.WriteStream & { columns?: number };
    const updateWidth = () => {
      const nextWidth = getObservedTerminalWidth(stream.columns, process.stdout.columns);
      setTerminalWidth((current) => current === nextWidth ? current : nextWidth);
    };

    updateWidth();
    if (typeof stream.on === "function") {
      stream.on("resize", updateWidth);
      return () => {
        if (typeof stream.off === "function") {
          stream.off("resize", updateWidth);
        }
      };
    }
  }, [stdout]);

  return terminalWidth;
}
