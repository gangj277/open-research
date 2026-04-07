import React from "react";
import {
  UserMessage,
  AgentMessage,
  SystemMessage as SystemMessageComponent,
  ToolActivitySummary,
  Divider,
} from "@/tui/components";
import type { ConversationMessage } from "@/tui/streaming";

/**
 * Renders a flat list of ConversationMessages into React elements with:
 * - Turn dividers between turns (inserted before a user message that follows a non-user message)
 * - Turn numbers on user messages
 */
export function renderConversationMessages(
  messages: ConversationMessage[],
  expanded: boolean,
  width?: number,
): React.ReactNode[] {
  const elements: React.ReactNode[] = [];
  let turnCount = 0;

  for (let i = 0; i < messages.length; i++) {
    const message = messages[i];
    const key = `msg-${i}`;

    // Insert divider between turns: when a user message follows a non-user message
    // (and it's not the very first message)
    if (message.role === "user" && i > 0) {
      const prev = messages[i - 1];
      if (prev && prev.role !== "user") {
        elements.push(<Divider key={`div-${i}`} width={width} />);
      }
    }

    if (message.role === "user") {
      turnCount++;
      elements.push(<UserMessage key={key} text={message.text} turnNumber={turnCount} width={width} />);
    } else if (message.role === "system") {
      if (message.text.startsWith("__tool_summary__")) {
        try {
          const data = JSON.parse(message.text.slice("__tool_summary__".length));
          elements.push(<ToolActivitySummary key={key} summary={data.summary} tools={data.tools} expanded={expanded} width={width} />);
        } catch {
          // skip malformed tool summaries
        }
      } else {
        elements.push(<SystemMessageComponent key={key} text={message.text} width={width} />);
      }
    } else {
      elements.push(<AgentMessage key={key} text={message.text} width={width} />);
    }
  }

  return elements;
}

