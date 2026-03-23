export type { AgentMode } from './types';
export type { AudioConfig, ProviderAdapter } from './types';
export { createOpenAIRealtimeAdapter } from './models/openai-realtime';
export { createGeminiLiveAdapter } from './models/gemini-live';

import { createGeminiLiveAdapter } from './models/gemini-live';
import { createOpenAIRealtimeAdapter } from './models/openai-realtime';
import type { AgentMode, AudioConfig, ProviderAdapter } from './types';


export function createProviderMode(
  mode: Exclude<AgentMode, 'echo'>,
  config: AudioConfig
): ProviderAdapter {
  if (mode === 'openai') {
    return createOpenAIRealtimeAdapter(config);
  }
  return createGeminiLiveAdapter(config);
}
