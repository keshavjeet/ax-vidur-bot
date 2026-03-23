import { spawn, type ChildProcess } from 'child_process';
import type { Readable } from 'stream';
import { record } from 'node-record-lpcm16';

/** Layout of captured PCM: signed 16-bit little-endian, interleaved if stereo. */
export interface PcmCaptureFormat {
  sampleRate: number;
  channels: number;
}

export interface CreateMicrophoneOptions {
  format: PcmCaptureFormat;
  /** Passed through to node-record-lpcm16; default `sox`. */
  recorder?: string;
  /** Optional input device (SoX `AUDIODEV` when set). */
  device?: string;
  /**
   * When non-empty, spawns `sox` directly: default mic → raw s16le stdout with these effects
   * after the output spec (SoX syntax), e.g. `['highpass', '130']` to cut rumble/fan lows.
   * When empty/omitted, uses node-record-lpcm16’s default SoX argv (no extra effects).
   */
  soxEffects?: string[];
}

export interface PcmMicrophone {
  /** Raw PCM chunks (no container header when using default raw capture). */
  readonly stream: Readable;
  stop(): void;
}

function wrapSpawnError(recorder: string, err: NodeJS.ErrnoException): Error {
  const message =
    err.code === 'ENOENT'
      ? `Recorder command "${recorder}" not found. Install SoX so it is on your PATH (macOS: brew install sox).`
      : `Microphone capture failed: ${err.message}`;
  const wrapped = new Error(message);
  (wrapped as Error & { cause?: unknown }).cause = err;
  return wrapped;
}

/**
 * SoX usage: `[[fopts] infile] [fopts] outfile [effect ...]` — effects go after the outfile (`-`).
 * @see https://sox.sourceforge.net/sox.html
 */
function createSoxEffectsMicrophone(
  format: PcmCaptureFormat,
  effects: string[],
  device?: string
): PcmMicrophone {
  const sr = String(format.sampleRate);
  const ch = String(format.channels);
  const args = [
    '--no-show-progress',
    '-d',
    '-t',
    'raw',
    '-r',
    sr,
    '-c',
    ch,
    '-b',
    '16',
    '-e',
    'signed-integer',
    '-',
    ...effects,
  ];
  const env = device !== undefined ? { ...process.env, AUDIODEV: device } : process.env;
  const cp: ChildProcess = spawn('sox', args, {
    stdio: ['ignore', 'pipe', 'pipe'],
    env,
  });

  const stream = cp.stdout!;
  let stopped = false;
  cp.stderr!.on('data', () => {
    /* SoX progress on stderr; ignore */
  });
  cp.on('error', (err: NodeJS.ErrnoException) => {
    stream.emit('error', wrapSpawnError('sox', err));
  });
  cp.on('close', (code) => {
    if (stopped) return;
    if (code !== 0 && code !== null) {
      stream.emit(
        'error',
        new Error(`sox exited with code ${code}. Try MIC_RAW=1 or fewer/softer sox effects.`)
      );
    }
  });

  return {
    stream,
    stop: () => {
      stopped = true;
      cp.kill();
    },
  };
}

export function createMicrophone(options: CreateMicrophoneOptions): PcmMicrophone {
  const { format, recorder = 'sox', device, soxEffects } = options;

  if (recorder === 'sox' && soxEffects !== undefined && soxEffects.length > 0) {
    return createSoxEffectsMicrophone(format, soxEffects, device);
  }

  const rec = record({
    sampleRate: format.sampleRate,
    channels: format.channels,
    audioType: 'raw',
    recorder,
    ...(device !== undefined ? { device } : {}),
  });

  const stream = rec.stream();
  rec.process.on('error', (err: NodeJS.ErrnoException) => {
    stream.emit('error', wrapSpawnError(recorder, err));
  });

  return {
    stream,
    stop: () => rec.stop(),
  };
}
