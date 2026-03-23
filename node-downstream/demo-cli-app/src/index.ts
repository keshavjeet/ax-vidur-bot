/**
 * Demo CLI client.
 *
 * Uses util packages only:
 * - @node-downstream/util-websocket for WebSocket client
 * - @node-downstream/util-audio-io for capture + playback
 */

import { createClient, type WebSocketClient } from '@node-downstream/util-websocket';
import { createCaptureRuntime, createPlaybackRuntime } from '@node-downstream/util-audio-io';

const WS_URL = process.argv[2] || 'ws://localhost:8081';
const COREAUDIO_UNDERFLOW_WARNING =
  "[../deps/mpg123/src/output/coreaudio.c:81] warning: Didn't have any audio data in callback (buffer underflow)";

function suppressCoreAudioUnderflowWarning(): void {
  const originalWrite = process.stderr.write.bind(process.stderr);
  process.stderr.write = ((chunk: unknown, ...args: unknown[]) => {
    const text = Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk ?? '');
    if (text.includes(COREAUDIO_UNDERFLOW_WARNING)) {
      return true;
    }
    return originalWrite(chunk as never, ...(args as []));
  }) as typeof process.stderr.write;
}

async function run(): Promise<void> {
  suppressCoreAudioUnderflowWarning();
  // Default demo mode to raw mic stream so provider receives audio reliably.
  if (!process.env.VOICE_RAW) {
    process.env.VOICE_RAW = '1';
  }
  const capture = createCaptureRuntime();
  const playback = createPlaybackRuntime();
  const ws: WebSocketClient = createClient({ url: WS_URL });
  let exitCode = 0;
  let stopped = false;
  let captureStarted = false;

  const isJsonControlFrame = (buf: Buffer): boolean => {
    const txt = buf.toString('utf8').trim();
    if (!(txt.startsWith('{') && txt.endsWith('}'))) return false;
    try {
      const evt = JSON.parse(txt) as { type?: string; message?: string };
      if (evt.type === 'error') {
        console.error('Server error:', evt.message || evt);
      } else {
        console.log('Server event:', evt);
      }
      return true;
    } catch {
      return false;
    }
  };

  const stop = async (code = 0): Promise<void> => {
    if (stopped) return;
    stopped = true;
    exitCode = code;
    await capture.stop();
    playback.stop();
    ws.close();
  };

  process.stdin.setEncoding('utf8');
  process.stdin.resume();
  process.stdin.on('data', (chunk: string) => {
    if (chunk.trim().toLowerCase() === 'q') {
      void stop(0);
    }
  });
  process.on('SIGINT', () => {
    void stop(0);
  });

  ws.onOpen(() => {
    if (captureStarted) return;
    captureStarted = true;
    console.log(`Connected to ${WS_URL}. Press q + Enter or Ctrl+C to stop.`);
    void capture.start((pcm: Buffer) => {
      ws.send(pcm);
    });
  });

  ws.onMessage((buffer: Buffer) => {
    if (isJsonControlFrame(buffer)) return;
    playback.play(buffer);
  });

  ws.onError((err: Error) => {
    console.error('WebSocket error:', err.message);
    void stop(1);
  });

  ws.onClose(() => {
    console.log('Disconnected.');
    process.exit(exitCode);
  });
}

run().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
