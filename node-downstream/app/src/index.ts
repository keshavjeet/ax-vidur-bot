import { createClient, createServer } from '@node-downstream/util-websocket';
import { createProviderMode } from './vidur-realtime-agent';
import type { AgentMode, AudioConfig, ProviderAdapter } from './vidur-realtime-agent';


const DEFAULT_AUDIO: AudioConfig = {
  sampleRate: 16000,
  channels: 1,
};

function run(port: number): void {
  const rawMode = process.env.VIDUR_AGENT_MODE;
  const mode: AgentMode =
    rawMode === 'echo' || rawMode === 'openai' || rawMode === 'gemini' ? rawMode : 'echo';
  const server = createServer({ port });

  server.onConnection((session) => {
    console.log('Session connected:', session.id, `mode=${mode}`);

    if (mode === 'echo') {
      console.log('Echo mode');
      session.onMessage((data) => {
        session.send(data);
      });
      session.onClose(() => {
        console.log('Session disconnected:', session.id);
      });
      return;
    }

    let upstream = null as ReturnType<typeof createClient> | null;
    let adapter: ProviderAdapter | null = null;
    let audioIdleTimer: NodeJS.Timeout | null = null;
    let statsTimer: NodeJS.Timeout | null = null;
    let setupComplete = false;
    const pendingAudio: Buffer[] = [];
    let forwardedAudioChunks = 0;
    try {
      adapter = createProviderMode(mode, DEFAULT_AUDIO);
      upstream = createClient({ url: adapter.url, ...(adapter.headers ? { headers: adapter.headers } : {}) });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      session.send(JSON.stringify({ type: 'error', message: msg }));
      session.close();
      return;
    }

    const sendSessionEvent = (event: Record<string, unknown>): void => {
      session.send(JSON.stringify(event));
    };

    const clearAudioIdleTimer = (): void => {
      if (!audioIdleTimer) return;
      clearTimeout(audioIdleTimer);
      audioIdleTimer = null;
    };
    const clearStatsTimer = (): void => {
      if (!statsTimer) return;
      clearInterval(statsTimer);
      statsTimer = null;
    };

    const sendAudioChunk = (data: Buffer): void => {
      if (!adapter || !upstream || !upstream.isOpen() || data.length === 0) return;
      upstream.send(adapter.audioMessage(data));
      forwardedAudioChunks += 1;
      const audioStreamEndMessage = adapter.audioStreamEndMessage?.();
      if (audioStreamEndMessage) {
        clearAudioIdleTimer();
        // Voice-gated input can hide silence from the provider; force turn boundary after idle.
        audioIdleTimer = setTimeout(() => {
          if (!upstream || !upstream.isOpen()) return;
          upstream.send(audioStreamEndMessage);
          if (adapter) {
            for (const msg of adapter.stopMessages()) {
              upstream.send(msg);
            }
          }
        }, 700);
      }
    };

    upstream.onOpen(() => {
      if (!adapter || !upstream || !upstream.isOpen()) return;
      for (const msg of adapter.setupMessages()) {
        upstream.send(msg);
      }
    });

    upstream.onTextMessage((text: string) => {
      if (!adapter) return;
      const parsed = adapter.parseIncomingText(text);
      if (parsed.event && 'setupComplete' in parsed.event) {
        setupComplete = true;
        sendSessionEvent({ type: 'provider_ready', provider: mode });
        clearStatsTimer();
        statsTimer = setInterval(() => {
          sendSessionEvent({
            type: 'bridge_stats',
            provider: mode,
            forwardedAudioChunks,
            bufferedAudioChunks: pendingAudio.length,
          });
        }, 2000);
        while (pendingAudio.length > 0) {
          const chunk = pendingAudio.shift();
          if (!chunk) break;
          sendAudioChunk(chunk);
        }
      }
      if (parsed.audio) {
        for (const pcm of parsed.audio) session.send(pcm);
      }
      if (parsed.providerError) {
        sendSessionEvent({ type: 'error', message: parsed.providerError, provider: mode });
      }
      if (parsed.event) {
        sendSessionEvent({ type: 'provider_event', provider: mode, payload: parsed.event });
      }
    });

    upstream.onError((err: Error) => {
      sendSessionEvent({ type: 'error', message: err.message, provider: mode });
    });
    upstream.onClose((code: number, reason: string) => {
      const suffix = reason ? ` (${code}: ${reason})` : ` (${code})`;
      sendSessionEvent({
        type: 'error',
        message: `Provider connection closed${suffix}`,
        provider: mode,
      });
    });

    session.onMessage((data) => {
      try {
        if (!data || data.length === 0) return;
        if (!setupComplete) {
          pendingAudio.push(Buffer.from(data));
          if (pendingAudio.length > 32) {
            pendingAudio.shift();
          }
          return;
        }
        sendAudioChunk(data);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        sendSessionEvent({ type: 'error', message: msg, provider: mode });
      }
    });

    session.onClose(() => {
      clearAudioIdleTimer();
      clearStatsTimer();
      pendingAudio.length = 0;
      if (adapter && upstream && upstream.isOpen()) {
        for (const msg of adapter.stopMessages()) {
          upstream.send(msg);
        }
      }
      if (upstream) {
        upstream.close();
      }
      console.log('Session disconnected:', session.id);
    });
  });
  console.log(`Node downstream bridge listening on ws://localhost:${port} (mode: ${mode})`);
}

const port = Number(process.env.PORT) || 8081;
run(port);
