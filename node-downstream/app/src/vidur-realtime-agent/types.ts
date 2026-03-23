export type AgentMode = 'echo' | 'openai' | 'gemini';

export interface AudioConfig {
  sampleRate: number;
  channels: number;
}

export interface ProviderAdapter {
  readonly provider: Exclude<AgentMode, 'echo'>;
  readonly url: string;
  readonly headers?: Record<string, string>;
  setupMessages(): string[];
  audioMessage(chunk: Buffer): string;
  audioStreamEndMessage?(): string;
  stopMessages(): string[];
  parseIncomingText(
    text: string
  ): { audio?: Buffer[]; event?: Record<string, unknown>; providerError?: string };
}
