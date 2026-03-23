/**
 * Voice-gate tests with a mocked VAD backend for deterministic behavior.
 * Run after build: node dist/tests/voice-gate.test.js
 */

import * as assert from 'assert';

type OnFrameProcessed = (probs: { isSpeech: number }, frame: Float32Array) => void;

interface FakeVadInstance {
  start(): void;
  processAudio(frame: Float32Array): Promise<void>;
  flush(): Promise<void>;
  destroy(): void;
}

type AvrVadModule = {
  RealTimeVAD: {
    new(options: { onFrameProcessed: OnFrameProcessed }): Promise<FakeVadInstance>;
  };
};

const avrVad = require('avr-vad') as AvrVadModule;

let scriptedProbs: number[] = [];
let onFrameProcessed: OnFrameProcessed | null = null;

const fakeVad: FakeVadInstance = {
  start() {
    /* noop */
  },
  async processAudio(frame: Float32Array) {
    const p = scriptedProbs.length > 0 ? scriptedProbs.shift()! : 0;
    if (onFrameProcessed) {
      onFrameProcessed({ isSpeech: p }, frame);
    }
  },
  async flush() {
    /* noop */
  },
  destroy() {
    /* noop */
  },
};

(avrVad.RealTimeVAD as unknown as { new: (o: { onFrameProcessed: OnFrameProcessed }) => Promise<FakeVadInstance> }).new =
  async (options: { onFrameProcessed: OnFrameProcessed }) => {
    onFrameProcessed = options.onFrameProcessed;
    return fakeVad;
  };

const { createVoiceGatePipeline } = require('../src/voice-gate') as {
  createVoiceGatePipeline: (options: {
    onSend: (pcm: Buffer) => void;
    speechThreshold?: number;
    hangoverFrames?: number;
    preSpeechFrames?: number;
    minSpeechRms?: number;
    speechToNoiseRatio?: number;
    confidentSpeechThreshold?: number;
    enableDenoise?: boolean;
  }) => Promise<{
    start(): void;
    feedPcmS16leMono(chunk: Buffer): void;
    flush(): Promise<void>;
    destroy(): void;
  }>;
};

function makePcmFrame(samples: number, amplitudeInt16: number): Buffer {
  const buf = Buffer.alloc(samples * 2);
  for (let i = 0; i < samples; i++) {
    buf.writeInt16LE(amplitudeInt16, i * 2);
  }
  return buf;
}

async function testSilenceDoesNotStream(): Promise<void> {
  scriptedProbs = [0.05, 0.1, 0.15, 0.2];
  const sent: Buffer[] = [];
  const gate = await createVoiceGatePipeline({
    onSend: (pcm: Buffer) => sent.push(Buffer.from(pcm)),
    speechThreshold: 0.35,
    preSpeechFrames: 4,
    minSpeechRms: 0.006,
    speechToNoiseRatio: 2.2,
    confidentSpeechThreshold: 0.6,
    enableDenoise: false,
  });
  gate.start();

  // Very low-level background signal.
  for (let i = 0; i < 4; i++) {
    gate.feedPcmS16leMono(makePcmFrame(512, 80));
  }
  await gate.flush();
  gate.destroy();

  assert.strictEqual(sent.length, 0, 'background-only frames must not be streamed');
}

async function testGateOpenDoesNotDuplicateCurrentFrame(): Promise<void> {
  // Third frame opens the gate.
  scriptedProbs = [0.1, 0.2, 0.85];
  const sent: Buffer[] = [];
  const gate = await createVoiceGatePipeline({
    onSend: (pcm: Buffer) => sent.push(Buffer.from(pcm)),
    speechThreshold: 0.35,
    preSpeechFrames: 2,
    hangoverFrames: 0,
    minSpeechRms: 0.001,
    speechToNoiseRatio: 1,
    confidentSpeechThreshold: 0.95,
    enableDenoise: false,
  });
  gate.start();

  gate.feedPcmS16leMono(makePcmFrame(512, 1200));
  gate.feedPcmS16leMono(makePcmFrame(512, 1400));
  gate.feedPcmS16leMono(makePcmFrame(512, 1600));

  await gate.flush();
  gate.destroy();

  // With preSpeechFrames=2, opening flushes frame2+frame3 exactly once each.
  assert.strictEqual(sent.length, 2, 'gate-open transition must not duplicate the current frame');

  const sampleCounts = sent.map((b) => b.length / 2);
  assert.deepStrictEqual(sampleCounts, [512, 512], 'each streamed payload is one VAD frame');
}

async function runTests(): Promise<void> {
  await testSilenceDoesNotStream();
  await testGateOpenDoesNotDuplicateCurrentFrame();
  console.log('voice gate tests passed');
}

runTests().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
