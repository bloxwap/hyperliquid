/**
 * In-memory socket for transport tests, injected through the `webSocketFactory` options.
 * @module
 */

import { RealCloseEvent } from "./_noCloseEvent.ts";

/** Injectable, in-memory platform socket; no global WebSocket replacement. */
export class FakeSocket extends EventTarget {
  readyState = 0;
  binaryType = "blob";
  bufferedAmount = 0;
  protocol = "";
  extensions = "";
  readonly sent: string[] = [];
  constructor(readonly onSend?: (data: string) => void) {
    super();
  }
  open(): void {
    this.readyState = 1;
    this.dispatchEvent(new Event("open"));
  }
  send(data: string): void {
    this.sent.push(data);
    this.onSend?.(data);
  }
  receive(data: unknown): void {
    this.dispatchEvent(new MessageEvent("message", { data: JSON.stringify(data) }));
  }
  close(): void {
    this.readyState = 3;
    this.dispatchEvent(new RealCloseEvent("close", { code: 1000 }));
  }
}
