import {
  AutoModelForCausalLM,
  AutoTokenizer,
  env,
  type ProgressInfo,
} from '@huggingface/transformers';

import {
  BROWSER_MODEL_ROOT,
  browserModelPath,
  browserModelProfile,
  CONTRIBUTION_METRIC,
  DATASET_SCHEMA_VERSION,
  type BrowserModelSelection,
  type ModelProfile,
} from './config.ts';
import {
  generateSummedContributionDataset,
  throwIfGenerationAborted,
  type GenerateContributionDatasetOptions,
} from './generate.ts';
import { validatePrompts } from './prompts.ts';
import type { CausalLanguageModel, DatasetToken, Tokenizer } from './types.ts';
import type {
  BrowserGenerationPrompt,
  BrowserGenerationRequest,
  BrowserGenerationResponse,
} from './browser-generation-protocol.ts';

type LoadedModel = {
  key: string;
  model: CausalLanguageModel;
  tokenizer: Tokenizer;
};

type WorkerScope = {
  postMessage: (message: BrowserGenerationResponse) => void;
  onmessage: ((event: MessageEvent<BrowserGenerationRequest>) => void) | null;
};

const workerScope = globalThis as unknown as WorkerScope;
let loadedModel: LoadedModel | undefined;
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

function selectionKey(selection: BrowserModelSelection) {
  return `${selection.device}:${selection.modelKey}:${selection.dtype}`;
}

async function loadModel(
  selection: BrowserModelSelection,
  profile: ModelProfile,
): Promise<LoadedModel> {
  const key = selectionKey(selection);
  if (loadedModel?.key === key) return loadedModel;
  if (modelPromise) return modelPromise;

  if (loadedModel) {
    await loadedModel.model.dispose();
    loadedModel = undefined;
  }

  // The model is served from the repository's ignored models/ directory via
  // public/models. Transformers.js will cache these responses in the browser,
  // so subsequent runs do not download the large weights again.
  env.allowLocalModels = true;
  env.allowRemoteModels = false;
  env.localModelPath = new URL(
    BROWSER_MODEL_ROOT,
    globalThis.location.origin,
  ).href;

  const progress_callback = (info: ProgressInfo) => postProgress(info);
  const loading = (async () => {
    const modelPath = browserModelPath(selection);
    // Tokenizer auto-discovery in Transformers.js 4.2 does not recognize an
    // absolute localModelPath. Keep its small files on the root-relative path,
    // and finish loading them before starting the much larger model request.
    const tokenizer = await AutoTokenizer.from_pretrained(modelPath, {
      local_files_only: true,
      progress_callback,
    });
    const model = await AutoModelForCausalLM.from_pretrained(profile.id, {
      dtype: profile.dtype,
      local_files_only: true,
      model_file_name: profile.instrumentation,
      progress_callback,
    });
    return {
      key,
      tokenizer: tokenizer as unknown as Tokenizer,
      model: model as unknown as CausalLanguageModel,
    };
  })();

  modelPromise = loading
    .then((value) => {
      loadedModel = value;
      return value;
    })
    .finally(() => {
      modelPromise = undefined;
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

function emptyContributions(promptTokenCount: number, layerCount: number) {
  return {
    schemaVersion: DATASET_SCHEMA_VERSION,
    metric: CONTRIBUTION_METRIC,
    aggregation: 'sum' as const,
    layerCount,
    targetTokenStart: promptTokenCount,
    rows: [] as number[][],
  };
}

function validatedPrompt(
  values: BrowserGenerationPrompt,
  profile: ModelProfile,
) {
  return validatePrompts(
    [
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
    ],
    profile.generation,
  )[0];
}

async function run(
  promptValues: BrowserGenerationPrompt,
  selection: BrowserModelSelection,
) {
  const controller = new AbortController();
  activeController = controller;
  post({
    type: 'status',
    status: 'loading-model',
  });

  try {
    const modelProfile = browserModelProfile(selection);
    const prompt = validatedPrompt(promptValues, modelProfile);
    const { model, tokenizer } = await loadModel(selection, modelProfile);
    throwIfGenerationAborted(controller.signal);
    post({
      type: 'status',
      status: 'generating',
    });

    const generatedTokenIds: bigint[] = [];
    const contributionRows = new Map<number, number[]>();
    const options: GenerateContributionDatasetOptions = {
      modelProfile,
      model,
      tokenizer,
      prompt,
      signal: controller.signal,
      onPromptReady(manifest) {
        post({
          type: 'prompt-ready',
          manifest,
          contributions: emptyContributions(
            manifest.promptTokenCount,
            modelProfile.geometry.layers,
          ),
        });
      },
      // A single macrotask between model passes keeps cancellation responsive
      // without paying the browser's timer-clamping cost once per layer.
      yieldControl: () =>
        new Promise<void>((resolve) => globalThis.setTimeout(resolve, 0)),
      onGeneratedToken(token) {
        generatedTokenIds.push(token);
        const rowIndex = generatedTokenIds.length - 1;
        const row = contributionRows.get(rowIndex);
        if (!row) {
          throw new Error(
            `Missing contribution row for generated token ${rowIndex}`,
          );
        }
        contributionRows.delete(rowIndex);
        const tokenValue: DatasetToken = {
          id: numericTokenId(token),
          text: decodeToken(tokenizer, token),
        };
        post({
          type: 'generation-step',
          token: tokenValue,
          rowIndex,
          row,
          generatedText: tokenizer.decode(generatedTokenIds, {
            skip_special_tokens: true,
            clean_up_tokenization_spaces: false,
          }),
        });
      },
      onSummedContributionRowUpdate(rowIndex, row) {
        contributionRows.set(rowIndex, row);
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
      });
      activeController.abort();
    }
    return;
  }
  if (activeRun) return;
  activeRun = run(request.prompt, request.selection).finally(() => {
    activeRun = undefined;
  });
};
