import type { AudioConfig, ProviderAdapter } from '../types';

function base64(chunk: Buffer): string {
  return chunk.toString('base64');
}

export function createOpenAIRealtimeAdapter(config: AudioConfig): ProviderAdapter {
  const apiKey = process.env.OPENAI_API_KEY;
  const model = process.env.OPENAI_REALTIME_MODEL || 'gpt-4o-realtime-preview';
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY is required for openai mode');
  }

  const url = `wss://api.openai.com/v1/realtime?model=${encodeURIComponent(model)}`;
  const inputFormat =
    config.sampleRate === 16000 ? 'pcm16' : `pcm16_${Math.round(config.sampleRate)}hz`;

  return {
    provider: 'openai',
    url,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'OpenAI-Beta': 'realtime=v1',
    },
    setupMessages: () => [
      JSON.stringify({
        type: 'session.update',
        session: {
          modalities: ['audio', 'text'],
          input_audio_format: inputFormat,
          output_audio_format: 'pcm16',
          turn_detection: {
            type: 'server_vad',
          },
        },
      }),
    ],
    audioMessage: (chunk: Buffer) =>
      JSON.stringify({
        type: 'input_audio_buffer.append',
        audio: base64(chunk),
      }),
    stopMessages: () => [
      JSON.stringify({ type: 'input_audio_buffer.commit' }),
      JSON.stringify({ type: 'response.create' }),
    ],
    parseIncomingText: (text: string) => {
      let evt: Record<string, unknown>;
      try {
        evt = JSON.parse(text) as Record<string, unknown>;
      } catch {
        return {};
      }

      const type = evt.type;
      if (type === 'response.audio.delta') {
        const delta = evt.delta;
        if (typeof delta === 'string' && delta.length > 0) {
          return { audio: [Buffer.from(delta, 'base64')] };
        }
        return {};
      }

      if (type === 'error') {
        const message = typeof evt.message === 'string' ? evt.message : JSON.stringify(evt);
        return { providerError: message };
      }
      return { event: evt };
    },
  };
}
