import { RealTimeVAD } from 'avr-vad';

const FRAME_48 = 480;
const OUT_16K_SAMPLES = 160;

type RnnoiseModule = {
  _rnnoise_get_frame_size(): number;
  _rnnoise_create(model: number): number;
  _rnnoise_destroy(state: number): void;
  _rnnoise_process_frame(state: number, outPtr: number, inPtr: number): number;
  _malloc(size: number): number;
  _free(ptr: number): void;
  HEAPF32: Float32Array;
};

export interface CreateVoiceGatePipelineOptions {
  /**
   * Called with s16le mono @ 16 kHz only while the gate is open (speech + hangover).
   * Default path sends **one buffer per VAD frame** (512 samples = 32 ms @ 16 kHz).
   */
  onSend: (pcmS16leMono: Buffer) => void;
  /** Silero speech probability threshold (0–1). Default 0.35. */
  speechThreshold?: number;
  /**
   * Frames (~32 ms @ 512/16k) to keep sending after probability drops. Default 6.
   */
  hangoverFrames?: number;
  /**
   * When true, runs RNNoise (48 kHz internal) on gated audio — can sound worse on upsampled 16 kHz.
   * Default **false**: gate only, one clean PCM frame per send (no triple-chunk artifact).
   */
  enableDenoise?: boolean;
  /** RNNoise dry mix when enableDenoise. Default 0.25. */
  dryMix?: number;
  /**
   * Frames (~32 ms each) to buffer while gate is closed and flush once speech starts.
   * Helps preserve word onsets that start just before VAD crosses threshold.
   * Default 4 (~128 ms).
   */
  preSpeechFrames?: number;
  /**
   * Minimum RMS floor used to reject very low-level background while gate is closed.
   * Default 0.006 (~ -44 dBFS).
   */
  minSpeechRms?: number;
  /**
   * Required ratio of frame RMS to estimated background RMS for low-confidence frames.
   * High-confidence VAD frames bypass this ratio check.
   * Default 2.2.
   */
  speechToNoiseRatio?: number;
  /** VAD confidence that bypasses RMS ratio checks. Default 0.6. */
  confidentSpeechThreshold?: number;
}

export interface VoiceGatePipeline {
  start(): void;
  feedPcmS16leMono(chunk: Buffer): void;
  flush(): Promise<void>;
  destroy(): void;
}

function floatFrameToS16leMono(frame: Float32Array): Buffer {
  const buf = Buffer.alloc(frame.length * 2);
  for (let i = 0; i < frame.length; i++) {
    const s = Math.round(frame[i]! * 32768);
    buf.writeInt16LE(Math.max(-32768, Math.min(32767, s)), i * 2);
  }
  return buf;
}

function upsampleLinear16kTo48k(s: Float32Array): Float32Array {
  const n = s.length;
  const out = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const a = s[i]!;
    const b = i + 1 < n ? s[i + 1]! : a;
    const base = i * 3;
    out[base] = a;
    out[base + 1] = a + (b - a) / 3;
    out[base + 2] = a + (2 * (b - a)) / 3;
  }
  return out;
}

function decimate48kFloatTo16kS16le(float48: Float32Array): Buffer {
  const buf = Buffer.alloc(OUT_16K_SAMPLES * 2);
  const out = new Int16Array(buf.buffer, buf.byteOffset, OUT_16K_SAMPLES);
  for (let i = 0; i < OUT_16K_SAMPLES; i++) {
    const c = i * 3;
    const p = c - 1;
    const n = c + 3;
    const a0 = float48[c]!;
    const a1 = float48[c + 1]!;
    const a2 = float48[c + 2]!;
    let v: number;
    if (p >= 0 && n + 1 < FRAME_48) {
      v =
        0.0625 * float48[p]! +
        0.25 * a0 +
        0.375 * a1 +
        0.25 * a2 +
        0.0625 * float48[n + 1]!;
    } else {
      v = (a0 + a1 + a2) / 3;
    }
    const s = Math.round(v * 32768);
    out[i] = Math.max(-32768, Math.min(32767, s));
  }
  return buf;
}

function frameRms(frame: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < frame.length; i++) {
    const s = frame[i]!;
    sum += s * s;
  }
  return Math.sqrt(sum / frame.length);
}

function cloneFrame(frame: Float32Array): Float32Array {
  return new Float32Array(frame);
}

class Rnnoise16kFrameStream {
  private readonly Module: RnnoiseModule;
  private readonly state: number;
  private readonly inPtr: number;
  private readonly outPtr: number;
  private readonly floatIn = new Float32Array(FRAME_48);
  private readonly floatDry = new Float32Array(FRAME_48);
  private readonly floatOut = new Float32Array(FRAME_48);
  private readonly dryMix: number;
  private readonly wetMix: number;
  private pending48 = new Float32Array(0);

  constructor(Module: RnnoiseModule, dryMix: number) {
    this.Module = Module;
    this.dryMix = dryMix;
    this.wetMix = 1 - dryMix;
    const state = Module._rnnoise_create(0);
    const inPtr = Module._malloc(FRAME_48 * 4);
    const outPtr = Module._malloc(FRAME_48 * 4);
    if (!state || !inPtr || !outPtr) {
      if (inPtr) Module._free(inPtr);
      if (outPtr) Module._free(outPtr);
      if (state) Module._rnnoise_destroy(state);
      throw new Error('RNNoise allocation failed');
    }
    this.state = state;
    this.inPtr = inPtr;
    this.outPtr = outPtr;
  }

  processFloatFrame(frame16k: Float32Array): Buffer[] {
    const up = upsampleLinear16kTo48k(frame16k);
    const merged = new Float32Array(this.pending48.length + up.length);
    merged.set(this.pending48);
    merged.set(up, this.pending48.length);
    this.pending48 = merged;

    const outs: Buffer[] = [];
    while (this.pending48.length >= FRAME_48) {
      const chunk = this.pending48.subarray(0, FRAME_48);
      this.pending48 = this.pending48.subarray(FRAME_48);
      this.floatIn.set(chunk);
      this.floatDry.set(this.floatIn);
      this.Module.HEAPF32.set(this.floatIn, this.inPtr >> 2);
      this.Module._rnnoise_process_frame(this.state, this.outPtr, this.inPtr);
      this.floatOut.set(
        this.Module.HEAPF32.subarray(this.outPtr >> 2, (this.outPtr >> 2) + FRAME_48)
      );
      for (let i = 0; i < FRAME_48; i++) {
        this.floatOut[i] = this.floatDry[i]! * this.dryMix + this.floatOut[i]! * this.wetMix;
      }
      outs.push(decimate48kFloatTo16kS16le(this.floatOut));
    }
    return outs;
  }

  destroy(): void {
    this.Module._free(this.inPtr);
    this.Module._free(this.outPtr);
    this.Module._rnnoise_destroy(this.state);
  }
}

export async function createVoiceGatePipeline(
  options: CreateVoiceGatePipelineOptions
): Promise<VoiceGatePipeline> {
  const {
    onSend,
    speechThreshold = 0.35,
    hangoverFrames = 6,
    enableDenoise = false,
    dryMix = 0.25,
    preSpeechFrames = 4,
    minSpeechRms = 0.006,
    speechToNoiseRatio = 2.2,
    confidentSpeechThreshold = 0.6,
  } = options;

  let rn: Rnnoise16kFrameStream | null = null;
  if (enableDenoise) {
    const { default: loadRn } = await import('@echogarden/rnnoise-wasm');
    const Module = (await loadRn()) as RnnoiseModule;
    if (Module._rnnoise_get_frame_size() !== FRAME_48) {
      throw new Error('Unexpected RNNoise frame size');
    }
    rn = new Rnnoise16kFrameStream(Module, Math.min(1, Math.max(0, dryMix)));
  }

  const preSpeechCap = Math.max(0, Math.round(preSpeechFrames));
  const noiseRatio = Math.max(1, speechToNoiseRatio);
  const rmsFloor = Math.max(0, minSpeechRms);
  const confidentThreshold = Math.max(speechThreshold, confidentSpeechThreshold);
  let hangover = 0;
  let gateOpen = false;
  let noiseRmsEstimate = rmsFloor;
  const preSpeech: Float32Array[] = [];
  let queue: Promise<void> = Promise.resolve();

  const sendFrame = (frame: Float32Array): void => {
    if (rn) {
      const chunks = rn.processFloatFrame(frame);
      for (const c of chunks) {
        if (c.length > 0) onSend(c);
      }
      return;
    }
    onSend(floatFrameToS16leMono(frame));
  };

  const vad = await RealTimeVAD.new({
    sampleRate: 16000,
    model: 'v5',
    onFrameProcessed: (probs, frame) => {
      const current = cloneFrame(frame);
      const rms = frameRms(current);
      const isHighConfidenceSpeech = probs.isSpeech >= confidentThreshold;
      const isSpeechLikeLevel =
        rms >= Math.max(rmsFloor, noiseRmsEstimate * noiseRatio) || isHighConfidenceSpeech;
      const isSpeech = probs.isSpeech >= speechThreshold && isSpeechLikeLevel;

      if (!gateOpen) {
        if (preSpeechCap > 0) {
          preSpeech.push(current);
          while (preSpeech.length > preSpeechCap) preSpeech.shift();
        }

        if (!isSpeech) {
          // Adapt slowly so transient sounds do not raise the floor too quickly.
          noiseRmsEstimate = noiseRmsEstimate * 0.98 + rms * 0.02;
          return;
        }
      }

      if (isSpeech) {
        hangover = hangoverFrames;
      } else if (hangover > 0) {
        hangover--;
      } else {
        gateOpen = false;
        return;
      }

      if (!gateOpen) {
        gateOpen = true;
        if (preSpeech.length > 0) {
          for (const f of preSpeech) sendFrame(f);
          preSpeech.length = 0;
          return;
        }
      }

      sendFrame(current);
    },
  });

  return {
    start() {
      vad.start();
    },

    feedPcmS16leMono(chunk: Buffer) {
      queue = queue.then(async () => {
        if (chunk.length < 2) return;
        const n = Math.floor(chunk.length / 2);
        const f = new Float32Array(n);
        for (let i = 0; i < n; i++) {
          f[i] = chunk.readInt16LE(i * 2) / 32768;
        }
        await vad.processAudio(f);
      });
    },

    async flush() {
      await queue;
      await vad.flush();
    },

    destroy() {
      vad.destroy();
      rn?.destroy();
    },
  };
}
