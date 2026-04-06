import { useState, useEffect } from "react";

const SPINNER_FRAMES = ["◐", "◓", "◑", "◒"] as const;

export function useAnimatedFrame(active: boolean) {
  const [index, setIndex] = useState(0);
  useEffect(() => {
    if (!active) { setIndex(0); return; }
    const timer = setInterval(() => setIndex((v) => (v + 1) % SPINNER_FRAMES.length), 120);
    return () => clearInterval(timer);
  }, [active]);
  return SPINNER_FRAMES[index] ?? SPINNER_FRAMES[0];
}
