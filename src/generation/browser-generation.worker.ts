import {
  AutoModelForCausalLM,
  AutoTokenizer,
  env,
  type ProgressInfo,
} from '@huggingface/transformers';

import {
  BROWSER_MODEL_PATH,
  CONTRIBUTION_METRIC,
  DATASET_SCHEMA_VERSION,
  HEAD_DIMENSION,
  INSTRUMENTED_MODEL_NAME,
  KV_HEAD_COUNT,
  LAYER_COUNT,
  MODEL_DTYPE,
  MODEL_ID,
  QUERY_HEAD_COUNT,
} from './config.ts';
import {
  disposeTokenizedPrompt,
  generateSummedContributionDataset,
  tokenizePrompt,
  throwIfGenerationAborted,
  type GenerateContributionDatasetOptions,
} from './generate.ts';
import { validatePrompts } from './prompts.ts';
import type {
  CausalLanguageModel,
  ContributionManifest,
  DatasetToken,
  Tokenizer,
  ValidatedPromptConfiguration,
} from './types.ts';
import type {
  BrowserGenerationPrompt,
  BrowserGenerationRequest,
  BrowserGenerationResponse,
} from './browser-generation-protocol.ts';

type LoadedModel = {
  model: CausalLanguageModel;
  tokenizer: Tokenizer;
};

type WorkerScope = {
  postMessage: (message: BrowserGenerationResponse) => void;
  onmessage: ((event: MessageEvent<BrowserGenerationRequest>) => void) | null;
};

const workerScope = globalThis as unknown as WorkerScope;
let modelPromise: Promise<LoadedModel> | undefined;
let activeController: AbortController | undefined;
let activeRun: Promise<void> | undefined;

function post(message: BrowserGenerationResponse) {
  workerScope.postMessage(message);
}

function postProgress(info: ProgressInfo) {
  if (info.status === 'ready') {
    post({ type: 'model-progress', status: 'ready' });
    return;
  }
  if (info.status === 'progress_total') {
    post({
      type: 'model-progress',
      status: 'progress',
      progress: info.progress,
      loaded: info.loaded,
      total: info.total,
    });
    return;
  }
  if (
    info.status === 'initiate' ||
    info.status === 'download' ||
    info.status === 'progress' ||
    info.status === 'done'
  ) {
    post({
      type: 'model-progress',
      status: info.status,
      file: info.file,
      ...(info.status === 'progress'
        ? {
            progress: info.progress,
            loaded: info.loaded,
            total: info.total,
          }
        : {}),
    });
  }
}

async function loadModel(): Promise<LoadedModel> {
  if (modelPromise) return modelPromise;

  // The model is served from the repository's ignored models/ directory via
  // public/models. Transformers.js will cache these responses in the browser,
  // so subsequent runs do not download the ~570 MB weights again.
  env.allowLocalModels = true;
  env.allowRemoteModels = false;
  env.localModelPath = new URL('/models/', globalThis.location.origin).href;

  const progress_callback = (info: ProgressInfo) => postProgress(info);
  const loading = (async () => {
    // Tokenizer auto-discovery in Transformers.js 4.2 does not recognize an
    // absolute localModelPath. Keep its small files on the root-relative path,
    // and finish loading them before starting the much larger model request.
    const tokenizer = await AutoTokenizer.from_pretrained(BROWSER_MODEL_PATH, {
      local_files_only: true,
      progress_callback,
    });
    const model = await AutoModelForCausalLM.from_pretrained(MODEL_ID, {
      dtype: MODEL_DTYPE,
      local_files_only: true,
      model_file_name: INSTRUMENTED_MODEL_NAME,
      progress_callback,
    });
    return {
      tokenizer: tokenizer as unknown as Tokenizer,
      model: model as unknown as CausalLanguageModel,
    };
  })();

  modelPromise = loading.catch((error: unknown) => {
    modelPromise = undefined;
    throw error;
  });
  return modelPromise;
}

function numericTokenId(token: bigint) {
  const id = Number(token);
  if (!Number.isSafeInteger(id)) {
    throw new Error(`Token ID ${token} cannot be represented safely`);
  }
  return id;
}

function decodeToken(tokenizer: Tokenizer, token: bigint) {
  return tokenizer.decode([token], {
    skip_special_tokens: false,
    clean_up_tokenization_spaces: false,
  });
}

function emptyContributions(promptTokenCount: number) {
  return {
    schemaVersion: DATASET_SCHEMA_VERSION,
    metric: CONTRIBUTION_METRIC,
    aggregation: 'sum' as const,
    layerCount: LAYER_COUNT,
    targetTokenStart: promptTokenCount,
    rows: [] as number[][],
  };
}

function promptManifest(
  prompt: ValidatedPromptConfiguration,
  tokenizer: Tokenizer,
): ContributionManifest {
  const encoded = tokenizePrompt(tokenizer, prompt);
  try {
    const tokens: DatasetToken[] = encoded.tokenIds.map((token) => ({
      id: numericTokenId(token),
      text: decodeToken(tokenizer, token),
    }));
    return {
      schemaVersion: DATASET_SCHEMA_VERSION,
      metric: CONTRIBUTION_METRIC,
      model: {
        id: MODEL_ID,
        dtype: MODEL_DTYPE,
        instrumentation: INSTRUMENTED_MODEL_NAME,
      },
      prompt: prompt.prompt,
      ...(prompt.systemPrompt === undefined
        ? {}
        : { systemPrompt: prompt.systemPrompt }),
      ...(prompt.assistantPrefix === undefined
        ? {}
        : { assistantPrefix: prompt.assistantPrefix }),
      generatedText: '',
      promptTokenCount: encoded.tokenIds.length,
      tokens,
      geometry: {
        layers: LAYER_COUNT,
        queryHeads: QUERY_HEAD_COUNT,
        kvHeads: KV_HEAD_COUNT,
        headDimension: HEAD_DIMENSION,
      },
      generation: {
        method: 'sampling',
        maxNewTokens: prompt.maxNewTokens,
        stopReason: 'max_new_tokens',
        enableThinking: prompt.enableThinking,
        seed: prompt.seed,
        temperature: prompt.temperature,
        topK: prompt.topK,
        topP: prompt.topP,
      },
    };
  } finally {
    disposeTokenizedPrompt(encoded);
  }
}

function validatedPrompt(values: BrowserGenerationPrompt) {
  return validatePrompts([
    {
      id: 'browser-generation',
      prompt: values.prompt,
      systemPrompt: values.systemPrompt,
      assistantPrefix: values.assistantPrefix,
      maxNewTokens: values.maxNewTokens,
      contributionFormats: ['summed'],
      enableThinking: values.enableThinking,
      seed: values.seed,
      temperature: values.temperature,
      topK: values.topK,
      topP: values.topP,
    },
  ])[0];
}

async function run(promptValues: BrowserGenerationPrompt) {
  const controller = new AbortController();
  activeController = controller;
  post({
    type: 'status',
    status: 'loading-model',
    message: 'Loading the instrumented model…',
  });

  try {
    const prompt = validatedPrompt(promptValues);
    const { model, tokenizer } = await loadModel();
    throwIfGenerationAborted(controller.signal);
    const manifest = promptManifest(prompt, tokenizer);
    post({
      type: 'prompt-ready',
      manifest,
      contributions: emptyContributions(manifest.promptTokenCount),
    });
    post({
      type: 'status',
      status: 'generating',
      message: 'Running the instrumented model…',
    });

    const generatedTokenIds: bigint[] = [];
    const options: GenerateContributionDatasetOptions = {
      model,
      tokenizer,
      prompt,
      signal: controller.signal,
      // A cooperative yield after each layer keeps the worker cancellable and
      // lets the browser paint streamed updates between model steps.
      onProgress: () => undefined,
      onGeneratedToken(token) {
        generatedTokenIds.push(token);
        const tokenValue: DatasetToken = {
          id: numericTokenId(token),
          text: decodeToken(tokenizer, token),
        };
        post({
          type: 'token',
          token: tokenValue,
          generatedText: tokenizer.decode(generatedTokenIds, {
            skip_special_tokens: true,
            clean_up_tokenization_spaces: false,
          }),
          generatedTokenCount: generatedTokenIds.length,
        });
      },
      onSummedContributionRowUpdate(rowIndex, row) {
        post({ type: 'contribution-row', rowIndex, row });
      },
    };
    const dataset = await generateSummedContributionDataset(options);
    post({
      type: 'complete',
      manifest: dataset.manifest,
      contributions: dataset.contributions,
    });
    // Keep the final manifest and rows authoritative. In particular, this
    // updates the stop reason when the model emitted an EOS token.
    post({ type: 'status', status: 'complete' });
  } catch (error: unknown) {
    if (
      controller.signal.aborted ||
      (error instanceof Error && error.name === 'AbortError')
    ) {
      post({
        type: 'status',
        status: 'cancelled',
        message: 'Generation cancelled.',
      });
    } else {
      post({
        type: 'error',
        message: error instanceof Error ? error.message : String(error),
      });
    }
  } finally {
    if (activeController === controller) activeController = undefined;
  }
}

workerScope.onmessage = (event) => {
  const request = event.data;
  if (request.type === 'cancel') {
    if (activeController) {
      post({
        type: 'status',
        status: 'cancelling',
        message: 'Finishing the current model step…',
      });
      activeController.abort();
    }
    return;
  }
  if (activeRun) return;
  activeRun = run(request.prompt).finally(() => {
    activeRun = undefined;
  });
};
