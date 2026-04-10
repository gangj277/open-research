import { useEffect, useState } from "react";
import { useStdin, useStdout } from "ink";
import {
  isTerminalVisible,
  observeTerminalVisibility,
  setTerminalFocusVisible,
} from "@/tui/ink-stdout";

const ENABLE_FOCUS_REPORTING = "\u001b[?1004h";
const DISABLE_FOCUS_REPORTING = "\u001b[?1004l";
const FOCUS_IN = "\u001b[I";
const FOCUS_OUT = "\u001b[O";

export function useTerminalVisibility() {
  const { stdout } = useStdout();
  const { stdin } = useStdin();
  const [visible, setVisible] = useState(() =>
    isTerminalVisible(stdout as NodeJS.WriteStream)
  );

  useEffect(() => {
    const output = stdout as NodeJS.WriteStream & { isTTY?: boolean };
    const input = stdin as NodeJS.ReadStream & {
      on?: (event: string, listener: (data: Buffer | string) => void) => void;
      off?: (event: string, listener: (data: Buffer | string) => void) => void;
      removeListener?: (event: string, listener: (data: Buffer | string) => void) => void;
    };

    setVisible(isTerminalVisible(output));

    const unsubscribe = observeTerminalVisibility(output, setVisible);
    const handleData = (data: Buffer | string) => {
      const text = typeof data === "string" ? data : data.toString("utf8");

      if (text.includes(FOCUS_OUT)) {
        setTerminalFocusVisible(output, false);
      }

      if (text.includes(FOCUS_IN)) {
        setTerminalFocusVisible(output, true);
      }
    };

    if (output.isTTY) {
      output.write(ENABLE_FOCUS_REPORTING);
    }

    input.on?.("data", handleData);

    return () => {
      input.off?.("data", handleData);
      input.removeListener?.("data", handleData);
      unsubscribe();
      setTerminalFocusVisible(output, true);
      if (output.isTTY) {
        output.write(DISABLE_FOCUS_REPORTING);
      }
    };
  }, [stdin, stdout]);

  return visible;
}
