import WebSocket from 'ws';
import { createSession } from './session';
import { createSessionManager, type SessionManager } from './session-manager';
import type { Session } from './session';

let sessionCounter = 0;

export interface ServerOptions {
  port: number;
}

export interface WebSocketServer {
  onConnection(handler: (session: Session) => void): void;
  readonly sessions: SessionManager;
  close(): void;
}

export function createServer(options: ServerOptions): WebSocketServer {
  const { port } = options;
  const wss = new WebSocket.Server({ port });
  const sessions = createSessionManager();
  let connectionHandler: ((session: Session) => void) | null = null;

  wss.on('connection', (socket: WebSocket) => {
    const id = `session-${++sessionCounter}`;
    const session = createSession(socket, id);
    sessions.add(session);
    if (connectionHandler) {
      connectionHandler(session);
    }
  });

  return {
    onConnection(handler: (session: Session) => void) {
      connectionHandler = handler;
    },
    get sessions() {
      return sessions;
    },
    close() {
      wss.close();
    },
  };
}

export type { Session, SessionManager };
