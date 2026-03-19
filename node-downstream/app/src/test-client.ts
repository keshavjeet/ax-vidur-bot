/**
 * App test client: sends PCM to the bridge and plays back the echoed audio.
 * Verifies upstream (client -> server) and downstream (server -> client).
 * Run the server first (npm start).
 *
 * Usage: node dist/test-client.js [ws://localhost:8081]
 */

import WebSocket from 'ws';
import { createSpeaker, type AudioFormat } from '@node-downstream/audio';

const WS_URL = process.argv[2] || 'ws://localhost:8081';

const SAMPLE_RATE = 16000;
const FREQUENCY = 440;
const AMPLITUDE = 10000;
const CHUNK_SAMPLES = 640;
const CHUNK_MS = 20;
const DURATION_SEC = 3;

const AUDIO_FORMAT: AudioFormat = {
  channels: 1,
  bitDepth: 16,
  sampleRate: SAMPLE_RATE,
  signed: true,
};

interface PhaseRef {
  phase: number;
}

function generateToneChunk(phaseRef: PhaseRef): Buffer {
  const buffer = Buffer.alloc(CHUNK_SAMPLES * 2);
  for (let i = 0; i < CHUNK_SAMPLES; i++) {
    const sample = Math.round(
      AMPLITUDE * Math.sin((2 * Math.PI * FREQUENCY * (i + phaseRef.phase)) / SAMPLE_RATE)
    );
    buffer.writeInt16LE(sample, i * 2);
  }
  phaseRef.phase += CHUNK_SAMPLES;
  return buffer;
}

function run(): void {
  console.log('Connecting to', WS_URL, '...');
  const ws = new WebSocket(WS_URL);
  const speaker = createSpeaker(AUDIO_FORMAT);

  ws.on('message', (data: WebSocket.RawData) => {
    const buffer = Buffer.isBuffer(data) ? data : Buffer.from(data as ArrayBuffer);
    if (buffer.length > 0) {
      try {
        speaker.write(buffer);
      } catch (err) {
        const e = err as NodeJS.ErrnoException;
        if (e.code !== 'ERR_STREAM_DESTROYED') console.error('Playback error:', e.message);
      }
    }
  });

  ws.on('open', () => {
    console.log('Connected. Sending', DURATION_SEC, 's of', FREQUENCY, 'Hz (upstream).');
    console.log('Echo will play on this client (downstream). Server also plays locally.');
    const phaseRef: PhaseRef = { phase: 0 };
    const totalChunks = Math.ceil((DURATION_SEC * 1000) / CHUNK_MS);
    let sent = 0;

    const interval = setInterval(() => {
      if (sent >= totalChunks) {
        clearInterval(interval);
        ws.close();
        return;
      }
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(generateToneChunk(phaseRef));
        sent++;
      }
    }, CHUNK_MS);
  });

  ws.on('close', () => {
    try {
      speaker.end();
    } catch {
      /* ignore */
    }
    console.log('Done. Heard tone on server (upstream) and echo on this client (downstream).');
    process.exit(0);
  });

  ws.on('error', (err: Error) => {
    try {
      speaker.destroy();
    } catch {
      /* ignore */
    }
    console.error('Error:', err.message);
    process.exit(1);
  });
}

run();
