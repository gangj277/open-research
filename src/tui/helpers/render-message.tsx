import React from "react";
import {
  UserMessage,
  AgentMessage,
  SystemMessage as SystemMessageComponent,
  ToolActivitySummary,
} from "@/tui/components";
import type { ConversationMessage } from "@/tui/streaming";

export function renderConversationMessage(message: ConversationMessage, key: string, expanded = false, width?: number) {
  if (message.role === "system") {
    // Tool activity summary: render as collapsed or expanded group
    if (message.text.startsWith("__tool_summary__")) {
      try {
        const data = JSON.parse(message.text.slice("__tool_summary__".length));
        return <ToolActivitySummary key={key} summary={data.summary} tools={data.tools} expanded={expanded} width={width} />;
      } catch {
        return null;
      }
    }
    return <SystemMessageComponent key={key} text={message.text} width={width} />;
  }
  if (message.role === "user") {
    return <UserMessage key={key} text={message.text} width={width} />;
  }
  return <AgentMessage key={key} text={message.text} width={width} />;
}
