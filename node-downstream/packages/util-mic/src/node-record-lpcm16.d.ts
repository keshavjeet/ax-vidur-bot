declare module 'node-record-lpcm16' {
  import type { Readable } from 'stream';
  import type { ChildProcess } from 'child_process';

  export interface RecordOptions {
    sampleRate?: number;
    channels?: number;
    compress?: boolean;
    threshold?: number;
    audioType?: string;
    recorder?: string;
    endOnSilence?: boolean;
    silence?: string;
    device?: string;
  }

  export interface Recording {
    stream(): Readable;
    stop(): void;
    pause(): void;
    resume(): void;
    process: ChildProcess;
  }

  export function record(options?: RecordOptions): Recording;
}
