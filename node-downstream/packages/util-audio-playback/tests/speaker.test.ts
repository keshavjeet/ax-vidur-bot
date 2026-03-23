/**
 * Audio package tests: createSpeaker returns a writable stream.
 * Run after build: node dist/tests/speaker.test.js
 */

import { createSpeaker, type AudioFormat } from '../src';
import * as assert from 'assert';

const format: AudioFormat = {
  channels: 1,
  bitDepth: 16,
  sampleRate: 16000,
  signed: true,
};

function runTests(): void {
  const speaker = createSpeaker(format);
  assert.strictEqual(typeof speaker.write, 'function', 'has write');
  assert.strictEqual(typeof speaker.end, 'function', 'has end');
  assert.strictEqual(typeof speaker.destroy, 'function', 'has destroy');
  speaker.destroy();
  console.log('audio package tests passed');
}

runTests();
