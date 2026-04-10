export type ConversationMessage = {
  role: "user" | "assistant" | "system";
  text: string;
};

export const STREAM_FLUSH_PATTERN = /[.!?]\s|\n|^#{1,3}\s|^[-*]\s/m;
export const STREAM_FLUSH_INTERVAL_MS = 80;

export function splitMessagesForRender(
  messages: ConversationMessage[],
  busy: boolean,
): {
  staticMessages: ConversationMessage[];
  dynamicMessages: ConversationMessage[];
} {
  if (messages.length === 0) {
    return {
      staticMessages: messages,
      dynamicMessages: [],
    };
  }

  const last = messages[messages.length - 1];

  if (last && (last.role === "assistant" ? busy : !busy && last.role === "system")) {
    return {
      staticMessages: messages.slice(0, -1),
      dynamicMessages: [last],
    };
  }

  return {
    staticMessages: messages,
    dynamicMessages: [],
  };
}

export function createSentenceStreamBuffer({
  onFlush,
  isVisible = () => true,
  flushIntervalMs = STREAM_FLUSH_INTERVAL_MS,
  flushPattern = STREAM_FLUSH_PATTERN,
}: {
  onFlush: (text: string) => void;
  isVisible?: () => boolean;
  flushIntervalMs?: number;
  flushPattern?: RegExp;
}) {
  let buffer = "";
  let timer: ReturnType<typeof setTimeout> | null = null;

  const clearPendingTimer = () => {
    if (!timer) return;
    clearTimeout(timer);
    timer = null;
  };

  const flush = (options?: { force?: boolean }) => {
    if (!buffer) return "";
    if (!options?.force && !isVisible()) return "";
    clearPendingTimer();
    const text = buffer;
    buffer = "";
    onFlush(text);
    return text;
  };

  const scheduleFlush = () => {
    if (timer) return;
    timer = setTimeout(() => {
      timer = null;
      flush();
    }, flushIntervalMs);
  };

  return {
    push(chunk: string) {
      if (!chunk) return "";
      buffer += chunk;
      if (flushPattern.test(buffer)) {
        return flush();
      }
      scheduleFlush();
      return "";
    },
    flush,
    dispose() {
      clearPendingTimer();
      return flush({ force: true });
    },
  };
}
