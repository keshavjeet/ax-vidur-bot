import { createServer } from '@node-downstream/websocket';
import { createSpeaker, type AudioFormat } from '@node-downstream/audio';

const PCM_FORMAT: AudioFormat = {
  channels: 1,
  bitDepth: 16,
  sampleRate: 16000,
  signed: true,
};

function run(port: number): void {
  const server = createServer({ port });

  server.onConnection((session) => {
    console.log('Session connected:', session.id);
    const speaker = createSpeaker(PCM_FORMAT);

    session.onMessage((data) => {
      try {
        speaker.write(data);
      } catch (err) {
        const e = err as NodeJS.ErrnoException;
        if (e.code !== 'ERR_STREAM_DESTROYED') {
          console.error('Playback write error:', e.message);
        }
      }
      session.send(data);
    });

    session.onClose(() => {
      try {
        speaker.end();
      } catch {
        /* ignore */
      }
      console.log('Session disconnected:', session.id);
    });
  });

  console.log(`Node downstream bridge listening on ws://localhost:${port}`);
}

const port = Number(process.env.PORT) || 8081;
run(port);
