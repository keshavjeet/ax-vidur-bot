import Speaker from 'speaker';
import type { Writable } from 'stream';

export interface AudioFormat {
  channels: number;
  bitDepth: number;
  sampleRate: number;
  signed?: boolean;
}

export function createSpeaker(format: AudioFormat): Writable {
  return new Speaker({
    channels: format.channels,
    bitDepth: format.bitDepth,
    sampleRate: format.sampleRate,
    signed: format.signed ?? true,
  });
}
