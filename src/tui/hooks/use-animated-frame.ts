import { useState, useEffect } from "react";
import { useStdout } from "ink";
import { hasRenderableTerminalDimensions } from "@/tui/ink-stdout";

const SPINNER_FRAMES = ["◐", "◓", "◑", "◒"] as const;

export function useAnimatedFrame(active: boolean) {
  const { stdout } = useStdout();
  const [index, setIndex] = useState(0);

  useEffect(() => {
    if (!active) { setIndex(0); return; }

    const timer = setInterval(() => {
      if (!hasRenderableTerminalDimensions(stdout as NodeJS.WriteStream & { columns?: number; rows?: number })) {
        return;
      }

      setIndex((v) => (v + 1) % SPINNER_FRAMES.length);
    }, 120);

    return () => clearInterval(timer);
  }, [active, stdout]);

  return SPINNER_FRAMES[index] ?? SPINNER_FRAMES[0];
}
