import { EventEmitter } from "node:events";
import type { ServerEvent } from "./types";

/**
 * Per-session typed event bus.
 * Wraps Node's EventEmitter to provide typed publish/subscribe for ServerEvents.
 */
export class SessionBus {
  private emitter = new EventEmitter();

  constructor() {
    // Allow many listeners (SSE clients, internal consumers)
    this.emitter.setMaxListeners(50);
  }

  emit(event: ServerEvent): void {
    this.emitter.emit("event", event);
  }

  subscribe(cb: (event: ServerEvent) => void): () => void {
    this.emitter.on("event", cb);
    return () => {
      this.emitter.off("event", cb);
    };
  }

  /** Number of active subscribers */
  listenerCount(): number {
    return this.emitter.listenerCount("event");
  }

  /** Remove all subscribers */
  removeAllListeners(): void {
    this.emitter.removeAllListeners("event");
  }
}
