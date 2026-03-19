import type WebSocket from 'ws';

export interface Session {
  readonly id: string;
  send(data: Buffer | string): void;
  onMessage(handler: (data: Buffer) => void): void;
  onClose(handler: () => void): void;
  close(): void;
}

export function createSession(socket: WebSocket, id: string): Session {
  const handlers: { message: ((data: Buffer) => void)[]; close: (() => void)[] } = {
    message: [],
    close: [],
  };

  socket.on('message', (raw: WebSocket.RawData) => {
    const data = Buffer.isBuffer(raw) ? raw : Buffer.from(raw as ArrayBuffer);
    if (data.length > 0) {
      handlers.message.forEach((h) => h(data));
    }
  });

  socket.on('close', () => {
    handlers.close.forEach((h) => h());
  });

  return {
    get id() {
      return id;
    },
    send(data: Buffer | string) {
      if (socket.readyState === 1) {
        socket.send(data);
      }
    },
    onMessage(handler: (data: Buffer) => void) {
      handlers.message.push(handler);
    },
    onClose(handler: () => void) {
      handlers.close.push(handler);
    },
    close() {
      socket.close();
    },
  };
}
