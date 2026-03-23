import type { AudioConfig, ProviderAdapter } from '../types';

type InlineChunk = { data: string; mimeType?: string };

function getInlineDataChunks(payload: Record<string, unknown>): InlineChunk[] {
  const out: InlineChunk[] = [];
  const serverContent = payload.serverContent as Record<string, unknown> | undefined;
  const modelTurn = serverContent?.modelTurn as Record<string, unknown> | undefined;
  const parts = modelTurn?.parts;
  if (!Array.isArray(parts)) return out;
  for (const p of parts) {
    if (typeof p !== 'object' || p === null) continue;
    const part = p as Record<string, unknown>;
    const candidates = [
      part.inlineData as Record<string, unknown> | undefined,
      part.inline_data as Record<string, unknown> | undefined,
      part.audio as Record<string, unknown> | undefined,
    ];
    for (const candidate of candidates) {
      const data = candidate?.data;
      if (typeof data !== 'string' || data.length === 0) continue;
      const mimeType =
        typeof candidate?.mimeType === 'string' && candidate.mimeType.length > 0
          ? candidate.mimeType
          : typeof candidate?.mime_type === 'string' && candidate.mime_type.length > 0
            ? candidate.mime_type
            : undefined;
      out.push({ data, mimeType });
    }
  }
  return out;
}

export function createGeminiLiveAdapter(config: AudioConfig): ProviderAdapter {
  const apiKey = process.env.GEMINI_API_KEY;
  const requestedModel = process.env.GEMINI_LIVE_MODEL;
  const model =
    requestedModel === 'models/gemini-2.0-flash-live-001'
      ? 'models/gemini-2.5-flash-native-audio-latest'
      : requestedModel || 'models/gemini-2.5-flash-native-audio-latest';
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY is required for gemini mode');
  }
  const sampleRate = config.sampleRate;

  const url =
    'wss://generativelanguage.googleapis.com/ws/' +
    `google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key=${encodeURIComponent(apiKey)}`;

  return {
    provider: 'gemini',
    url,
    setupMessages: () => [
      JSON.stringify({
        setup: {
          model,
          generationConfig: {
            responseModalities: ['AUDIO'],
          },
        },
      }),
    ],
    audioMessage: (chunk: Buffer) =>
      JSON.stringify({
        realtimeInput: {
          audio: {
            mimeType: `audio/pcm;rate=${sampleRate}`,
            data: chunk.toString('base64'),
          },
        },
      }),
    audioStreamEndMessage: () =>
      JSON.stringify({
        realtimeInput: {
          audioStreamEnd: true,
        },
      }),
    stopMessages: () => [],
    parseIncomingText: (text: string) => {
      let evt: Record<string, unknown>;
      try {
        evt = JSON.parse(text) as Record<string, unknown>;
      } catch {
        return {};
      }

      const audioChunks = getInlineDataChunks(evt);
      if (audioChunks.length > 0) {
        const serverContent = evt.serverContent as Record<string, unknown> | undefined;
        const debugEvent: Record<string, unknown> = {
          geminiAudio: {
            chunks: audioChunks.length,
            mimeTypes: Array.from(new Set(audioChunks.map((c) => c.mimeType || 'unknown'))),
            generationComplete: Boolean(serverContent?.generationComplete),
            turnComplete: Boolean(serverContent?.turnComplete),
            interrupted: Boolean(serverContent?.interrupted),
          },
        };
        return {
          audio: audioChunks.map((c) => Buffer.from(c.data, 'base64')),
          event: debugEvent,
        };
      }
      if ('setupComplete' in evt) {
        return { event: evt };
      }
      const serverContent = evt.serverContent as Record<string, unknown> | undefined;
      const modelTurn = serverContent?.modelTurn as Record<string, unknown> | undefined;
      const parts = Array.isArray(modelTurn?.parts) ? modelTurn.parts : [];
      const firstPart =
        parts.length > 0 && typeof parts[0] === 'object' && parts[0] !== null
          ? (parts[0] as Record<string, unknown>)
          : null;
      const summary: Record<string, unknown> = {
        geminiEvent: {
          topLevelKeys: Object.keys(evt),
          serverContentKeys: serverContent ? Object.keys(serverContent) : [],
          partCount: parts.length,
          firstPartKeys: firstPart ? Object.keys(firstPart) : [],
        },
      };
      if (evt.error && typeof evt.error === 'object') {
        return { providerError: JSON.stringify(evt.error) };
      }
      return { event: summary };
    },
  };
}
