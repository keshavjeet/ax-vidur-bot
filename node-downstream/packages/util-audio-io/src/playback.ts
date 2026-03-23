import { createSpeaker, type AudioFormat } from '@node-downstream/util-audio-playback';
import type { Writable } from 'stream';

export interface PlaybackRuntime {
  play(buffer: Buffer): void;
  stop(): void;
}

export interface CreatePlaybackRuntimeOptions {
  sampleRate?: number;
  channels?: number;
  bitDepth?: number;
  signed?: boolean;
}

export function createPlaybackRuntime(options: CreatePlaybackRuntimeOptions = {}): PlaybackRuntime {
  const format: AudioFormat = {
    sampleRate: options.sampleRate ?? 16000,
    channels: options.channels ?? 1,
    bitDepth: options.bitDepth ?? 16,
    signed: options.signed ?? true,
  };
  const speaker: Writable = createSpeaker(format);

  return {
    play(buffer: Buffer): void {
      try {
        speaker.write(buffer);
      } catch (err) {
        const e = err as NodeJS.ErrnoException;
        if (e.code !== 'ERR_STREAM_DESTROYED') {
          console.error('Playback error:', e.message);
        }
      }
    },

    stop(): void {
      try {
        speaker.end();
      } catch {
        /* ignore */
      }
    },
  };
}
