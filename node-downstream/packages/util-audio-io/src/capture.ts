import { createMicrophone, type PcmMicrophone } from '@node-downstream/util-mic';
import { createVoiceGatePipeline, type VoiceGatePipeline } from '@node-downstream/util-audio-filter';

export interface CaptureRuntime {
  start(onCapture: (pcm: Buffer) => void): Promise<void>;
  stop(): Promise<void>;
}

export interface CreateCaptureRuntimeOptions {
  sampleRate?: number;
  channels?: number;
}

function envNumber(name: string, fallback: number): number {
  const v = process.env[name];
  if (v === undefined || v === '') return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function micSoxEffects(): string[] | undefined {
  if (process.env.MIC_RAW === '1' || process.env.MIC_RAW === 'true') {
    return undefined;
  }
  const corner = Math.round(envNumber('SOX_HIGHPASS_HZ', 130));
  return ['highpass', String(corner > 0 ? corner : 130)];
}

export function createCaptureRuntime(options: CreateCaptureRuntimeOptions = {}): CaptureRuntime {
  const sampleRate = options.sampleRate ?? 16000;
  const channels = options.channels ?? 1;
  const useRaw = process.env.VOICE_RAW === '1' || process.env.VOICE_RAW === 'true';
  const denoise = process.env.VOICE_DENOISE === '1' || process.env.VOICE_DENOISE === 'true';

  let mic: PcmMicrophone | null = null;
  let gate: VoiceGatePipeline | null = null;
  let gateClosed = false;

  const stopMic = (): void => {
    if (!mic) return;
    try {
      mic.stop();
    } catch {
      /* ignore */
    }
    mic = null;
  };

  return {
    async start(onCapture: (pcm: Buffer) => void): Promise<void> {
      const effects = micSoxEffects();
      if (useRaw) {
        console.log('Audio mode: raw mic stream');
      } else {
        console.log(denoise ? 'Audio mode: voice-gated + RNNoise' : 'Audio mode: voice-gated PCM');
      }
      if (effects) {
        console.log('Mic SoX effects:', effects.join(' '));
      }

      if (!useRaw) {
        gate = await createVoiceGatePipeline({
          onSend: onCapture,
          speechThreshold: envNumber('VOICE_THRESHOLD', 0.35),
          hangoverFrames: Math.max(0, Math.round(envNumber('VOICE_HANGOVER', 6))),
          enableDenoise: denoise,
          dryMix: Math.min(1, Math.max(0, envNumber('VOICE_DRY_MIX', 0.25))),
        });
        gate.start();
      }

      mic = createMicrophone({
        format: { sampleRate, channels },
        recorder: 'sox',
        ...(effects !== undefined ? { soxEffects: effects } : {}),
      });

      mic.stream.on('error', (err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err);
        console.error('Mic stream error:', msg.trim() || err);
      });

      mic.stream.on('data', (chunk: Buffer) => {
        if (useRaw) {
          onCapture(chunk);
          return;
        }
        if (gate && !gateClosed) {
          gate.feedPcmS16leMono(chunk);
        }
      });
    },

    async stop(): Promise<void> {
      stopMic();
      if (gate && !gateClosed) {
        gateClosed = true;
        try {
          await gate.flush();
        } catch {
          /* ignore */
        }
        try {
          gate.destroy();
        } catch {
          /* ignore */
        }
      }
    },
  };
}
