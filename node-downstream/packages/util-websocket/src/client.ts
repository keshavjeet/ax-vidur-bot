import WebSocket from 'ws';

export interface WebSocketClientOptions {
  url: string;
  headers?: Record<string, string>;
}

export interface WebSocketClient {
  send(data: Buffer | string): void;
  isOpen(): boolean;
  onOpen(handler: () => void): void;
  onMessage(handler: (data: Buffer) => void): void;
  onTextMessage(handler: (text: string) => void): void;
  onError(handler: (err: Error) => void): void;
  onClose(handler: (code: number, reason: string) => void): void;
  close(): void;
}

export function createClient(options: WebSocketClientOptions): WebSocketClient {
  const socket = new WebSocket(options.url, options.headers ? { headers: options.headers } : {});

  return {
    send(data: Buffer | string): void {
      if (socket.readyState === WebSocket.OPEN) {
        socket.send(data);
      }
    },

    isOpen(): boolean {
      return socket.readyState === WebSocket.OPEN;
    },

    onOpen(handler: () => void): void {
      socket.on('open', handler);
    },

    onMessage(handler: (data: Buffer) => void): void {
      socket.on('message', (raw: WebSocket.RawData) => {
        const data = Buffer.isBuffer(raw) ? raw : Buffer.from(raw as ArrayBuffer);
        if (data.length > 0) {
          handler(data);
        }
      });
    },

    onTextMessage(handler: (text: string) => void): void {
      socket.on('message', (raw: WebSocket.RawData) => {
        const text =
          typeof raw === 'string'
            ? raw
            : Buffer.isBuffer(raw)
              ? raw.toString('utf8')
              : Buffer.from(raw as ArrayBuffer).toString('utf8');
        handler(text);
      });
    },

    onError(handler: (err: Error) => void): void {
      socket.on('error', handler);
    },

    onClose(handler: (code: number, reason: string) => void): void {
      socket.on('close', (code: number, reason: Buffer) => {
        handler(code, reason.toString('utf8'));
      });
    },

    close(): void {
      if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) {
        socket.close();
      }
    },
  };
}
