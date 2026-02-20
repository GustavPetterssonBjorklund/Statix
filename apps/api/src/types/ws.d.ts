declare module "ws" {
  import type { EventEmitter } from "node:events";
  import type { IncomingMessage } from "node:http";
  import type { Duplex } from "node:stream";

  export class WebSocket extends EventEmitter {
    static readonly OPEN: number;
    readonly OPEN: number;
    readyState: number;
    send(data: string | Buffer): void;
    close(): void;
  }

  export type ServerOptions = {
    noServer?: boolean;
  };

  export class WebSocketServer extends EventEmitter {
    constructor(options?: ServerOptions);
    handleUpgrade(
      request: IncomingMessage,
      socket: Duplex,
      head: Buffer,
      callback: (ws: WebSocket) => void
    ): void;
  }
}
