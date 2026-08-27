import type {
  ContributionManifest,
  DatasetToken,
  SummedContributions,
} from './types.ts';

/** Values accepted by the in-browser generation form. */
export type BrowserGenerationPrompt = {
  prompt: string;
  systemPrompt?: string;
  assistantPrefix?: string;
  maxNewTokens: number;
  enableThinking: boolean;
  seed: number;
  temperature: number;
  topK: number;
  topP: number;
};

export type BrowserGenerationRequest =
  { type: 'start'; prompt: BrowserGenerationPrompt } | { type: 'cancel' };

export type BrowserGenerationResponse =
  | {
      type: 'status';
      status:
        | 'loading-model'
        | 'generating'
        | 'cancelling'
        | 'complete'
        | 'cancelled';
      message?: string;
    }
  | {
      type: 'model-progress';
      status: 'initiate' | 'download' | 'progress' | 'done' | 'ready';
      file?: string;
      progress?: number;
      loaded?: number;
      total?: number;
    }
  | {
      type: 'prompt-ready';
      manifest: ContributionManifest;
      contributions: SummedContributions;
    }
  | {
      type: 'token';
      token: DatasetToken;
      generatedText: string;
      generatedTokenCount: number;
    }
  | {
      type: 'contributions';
      rows: number[][];
    }
  | {
      type: 'contribution-row';
      rowIndex: number;
      row: number[];
    }
  | {
      type: 'complete';
      manifest: ContributionManifest;
      contributions: SummedContributions;
    }
  | { type: 'error'; message: string };
