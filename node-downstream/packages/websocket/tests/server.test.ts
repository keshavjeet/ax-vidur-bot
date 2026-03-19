/**
 * WebSocket server + session manager tests.
 * Run after build: node dist/packages/websocket/tests/server.test.js
 */

import { createServer } from '../src';
import WebSocket from 'ws';
import * as assert from 'assert';

const PORT = 18081;

function runTests(): void {
  const server = createServer({ port: PORT });

  server.onConnection((session) => {
    session.onMessage((data) => {
      session.send(data);
    });
  });

  const ws = new WebSocket(`ws://localhost:${PORT}`);
  const received: Buffer[] = [];

  ws.on('open', () => {
    assert.strictEqual(server.sessions.all().length, 1, 'one session');
    const session = server.sessions.all()[0];
    assert.ok(session.id.startsWith('session-'), 'session id format');
    ws.send(Buffer.from([1, 2, 3]));
  });

  ws.on('message', (data: WebSocket.RawData) => {
    received.push(Buffer.isBuffer(data) ? data : Buffer.from(data as ArrayBuffer));
    if (received.length >= 1) {
      assert.deepStrictEqual(received[0], Buffer.from([1, 2, 3]), 'echoed data');
      server.close();
      ws.close();
      console.log('websocket tests passed');
    }
  });

  ws.on('error', (err) => {
    console.error(err);
    process.exit(1);
  });
}

runTests();
