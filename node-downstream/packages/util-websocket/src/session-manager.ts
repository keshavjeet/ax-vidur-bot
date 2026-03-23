import type { Session } from './session';

export interface SessionManager {
  add(session: Session): void;
  remove(session: Session): void;
  get(id: string): Session | undefined;
  all(): Session[];
  broadcast(data: Buffer | string): void;
}

export function createSessionManager(): SessionManager {
  const byId = new Map<string, Session>();

  return {
    add(session: Session) {
      byId.set(session.id, session);
      session.onClose(() => this.remove(session));
    },
    remove(session: Session) {
      byId.delete(session.id);
    },
    get(id: string) {
      return byId.get(id);
    },
    all() {
      return Array.from(byId.values());
    },
    broadcast(data: Buffer | string) {
      for (const s of byId.values()) {
        s.send(data);
      }
    },
  };
}
