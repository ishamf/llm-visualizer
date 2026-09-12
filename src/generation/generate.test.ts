import { describe, expect, it, vi } from 'vitest';

import {
  addSummedContributionRows,
  disposeTokenizedPrompt,
  generateSummedContributionDataset,
  throwIfGenerationAborted,
  tokenizePrompt,
} from './generate.ts';
import {
  presentKeyOutputName,
  presentValueOutputName,
  queryOutputName,
} from './model-output-names.ts';
import {
  HEAD_DIMENSION,
  KV_HEAD_COUNT,
  LAYER_COUNT,
  QUERY_HEAD_COUNT,
  UI_MODEL_PROFILE,
} from './config.ts';
import type {
  ModelTensor,
  Tokenizer,
  ValidatedPromptConfiguration,
} from './types.ts';

describe('prompt tokenization', () => {
  it('appends an assistant prefix after the generation marker before tokenizing', () => {
    const applyChatTemplate = vi.fn(() => '<assistant>');
    const encode = vi.fn(() => [10, 20, 30]);
    const tokenizer = {
      eos_token_id: 0,
      apply_chat_template: applyChatTemplate,
      encode,
      decode: vi.fn(),
    } as unknown as Tokenizer;

    const encoded = tokenizePrompt(tokenizer, {
      id: 'calculation',
      prompt: 'Calculate 2*3',
      assistantPrefix: '2 * 3 =',
      maxNewTokens: 8,
      contributionFormats: ['layered', 'summed'],
      enableThinking: false,
      seed: 42,
      temperature: 0.6,
      topK: 20,
      topP: 0.95,
    });

    try {
      expect(applyChatTemplate).toHaveBeenCalledWith(
        [{ role: 'user', content: 'Calculate 2*3' }],
        {
          tokenize: false,
          add_generation_prompt: true,
          enable_thinking: false,
        },
      );
      expect(encode).toHaveBeenCalledWith('<assistant>2 * 3 =', {
        add_special_tokens: false,
      });
      expect(encoded.tokenIds).toEqual([10n, 20n, 30n]);
      expect(encoded.inputIds.dims).toEqual([1, 3]);
      expect(encoded.attentionMask.data).toEqual(
        new BigInt64Array([1n, 1n, 1n]),
      );
    } finally {
      disposeTokenizedPrompt(encoded);
    }
  });
});

describe('summed contribution collection', () => {
  const tokenizer = {
    eos_token_id: null,
    apply_chat_template: () => '<prompt>',
    encode: () => [10],
    decode: (tokens: Array<number | bigint>) => {
      if (tokens.length === 0) {
        throw new Error('token_ids must be a non-empty array of integers');
      }
      return Number(tokens[0]) === 10 ? 'prompt' : ' answer';
    },
  } as unknown as Tokenizer;

  function constantModel() {
    return {
      forward: vi.fn(async () => {
        const outputs = {
          logits: {
            data: new Float32Array([0, 1]),
            dims: [1, 1, 2],
            type: 'float32',
          },
        } as Record<
          string,
          { data: Float32Array; dims: number[]; type: string }
        >;
        for (let layer = 0; layer < LAYER_COUNT; layer += 1) {
          outputs[queryOutputName(layer)] = {
            data: new Float32Array(QUERY_HEAD_COUNT * HEAD_DIMENSION).fill(1),
            dims: [1, 1, QUERY_HEAD_COUNT * HEAD_DIMENSION],
            type: 'float32',
          };
          outputs[presentKeyOutputName(layer)] = {
            data: new Float32Array(KV_HEAD_COUNT * HEAD_DIMENSION).fill(1),
            dims: [1, KV_HEAD_COUNT, 1, HEAD_DIMENSION],
            type: 'float32',
          };
          outputs[presentValueOutputName(layer)] = {
            data: new Float32Array(KV_HEAD_COUNT * HEAD_DIMENSION).fill(1),
            dims: [1, KV_HEAD_COUNT, 1, HEAD_DIMENSION],
            type: 'float32',
          };
        }
        return outputs;
      }),
      dispose: vi.fn(async () => undefined),
    };
  }

  it('adds corresponding causal rows without retaining layers', () => {
    const totals: number[][] = [];
    addSummedContributionRows(totals, 0, [[1], [2, 3]]);
    addSummedContributionRows(totals, 0, [[0.5], [4, 5]]);
    addSummedContributionRows(totals, 2, [[6, 7, 8]]);

    expect(totals).toEqual([[1.5], [6, 8], [6, 7, 8]]);
  });

  it('streams each completed summed destination row', async () => {
    const model = constantModel();
    const prompt: ValidatedPromptConfiguration = {
      id: 'stream',
      title: 'Streaming Example',
      prompt: 'Prompt',
      maxNewTokens: 1,
      contributionFormats: ['summed'],
      enableThinking: false,
      seed: 42,
      temperature: 0.6,
      topK: 20,
      topP: 0.95,
    };
    const rowUpdates: Array<[number, number[]]> = [];
    const promptManifests: Array<{ tokens: unknown[]; generatedText: string }> =
      [];
    const streamEvents: string[] = [];
    const yieldControl = vi.fn(async () => undefined);

    const dataset = await generateSummedContributionDataset({
      modelProfile: UI_MODEL_PROFILE,
      model,
      tokenizer,
      prompt,
      yieldControl,
      onPromptReady(manifest) {
        promptManifests.push(manifest);
        streamEvents.push('prompt');
      },
      onSummedContributionRowUpdate(index, row) {
        rowUpdates.push([index, row]);
        streamEvents.push(`row:${index}`);
      },
      onGeneratedToken() {
        streamEvents.push('token');
      },
    });

    expect(promptManifests).toMatchObject([
      { tokens: [{ id: 10, text: 'prompt' }], generatedText: '' },
    ]);
    expect(rowUpdates).toEqual([[0, dataset.contributions.rows[0]]]);
    expect(streamEvents).toEqual(['prompt', 'row:0', 'token']);
    expect(yieldControl).toHaveBeenCalledOnce();
    expect(dataset.manifest.generatedText).toBe(' answer');
    expect(dataset.manifest.title).toBe('Streaming Example');
    expect(dataset.manifest.model).toEqual({
      id: 'Qwen3-0.6B-ONNX',
      dtype: 'int8',
      instrumentation: 'instrumented',
    });
    // Layer matrices are only collected when the export asks for them.
    expect(dataset.layers).toBeUndefined();
    expect(dataset.manifest.layeredGeneratedContributions).toBeUndefined();
  });

  it('collects per-layer generated-token rows from the same run', async () => {
    const model = constantModel();
    const prompt: ValidatedPromptConfiguration = {
      id: 'collect',
      prompt: 'Prompt',
      maxNewTokens: 2,
      contributionFormats: ['summed'],
      enableThinking: false,
      seed: 42,
      temperature: 0.6,
      topK: 20,
      topP: 0.95,
    };

    const dataset = await generateSummedContributionDataset({
      modelProfile: UI_MODEL_PROFILE,
      model,
      tokenizer,
      prompt,
      collectLayerRows: true,
    });

    const generatedTokenCount =
      dataset.manifest.tokens.length - dataset.manifest.promptTokenCount;
    expect(generatedTokenCount).toBe(2);
    expect(dataset.manifest.layeredGeneratedContributions).toBe(true);
    expect(dataset.layers).toHaveLength(LAYER_COUNT);
    for (const [layerIndex, layer] of dataset.layers!.entries()) {
      expect(layer.layer).toBe(layerIndex);
      expect(layer.targetTokenStart).toBe(dataset.manifest.promptTokenCount);
      expect(layer.rows).toHaveLength(generatedTokenCount);
      // Each layer row describes the same destination as the summed row.
      for (const [rowIndex, row] of layer.rows.entries()) {
        expect(row).toHaveLength(dataset.contributions.rows[rowIndex].length);
      }
    }
    // One run backs both outputs: the layers sum exactly to the summed rows.
    for (const [rowIndex, summedRow] of dataset.contributions.rows.entries()) {
      for (const [source, summedValue] of summedRow.entries()) {
        let total = 0;
        for (const layer of dataset.layers!)
          total += layer.rows[rowIndex][source];
        expect(total).toBe(summedValue);
      }
    }
  });

  it('throws a cooperative abort error before running the model', () => {
    const controller = new AbortController();
    controller.abort();
    expect(() => throwIfGenerationAborted(controller.signal)).toThrow(
      'Generation cancelled',
    );
  });

  it('stops gracefully when a cancel lands between model passes', async () => {
    const tokenizer = {
      eos_token_id: null,
      apply_chat_template: () => '<prompt>',
      encode: () => [10],
      decode: (tokens: Array<number | bigint>) => {
        if (tokens.length === 0) {
          throw new Error('token_ids must be a non-empty array of integers');
        }
        return Number(tokens[0]) === 10 ? 'prompt' : ' answer';
      },
    } as unknown as Tokenizer;

    type TrackedTensor = ModelTensor & { dispose: () => void };
    const trackedTensors: TrackedTensor[] = [];
    function trackedTensor(data: Float32Array, dims: number[]): TrackedTensor {
      const tensor = { data, dims, type: 'float32', dispose: vi.fn() };
      trackedTensors.push(tensor);
      return tensor;
    }
    const model = {
      forward: vi.fn(async () => {
        const outputs: Record<string, TrackedTensor> = {
          logits: trackedTensor(new Float32Array([0, 1]), [1, 1, 2]),
        };
        for (let layer = 0; layer < LAYER_COUNT; layer += 1) {
          outputs[queryOutputName(layer)] = trackedTensor(
            new Float32Array(QUERY_HEAD_COUNT * HEAD_DIMENSION).fill(1),
            [1, 1, QUERY_HEAD_COUNT * HEAD_DIMENSION],
          );
          outputs[presentKeyOutputName(layer)] = trackedTensor(
            new Float32Array(KV_HEAD_COUNT * HEAD_DIMENSION).fill(1),
            [1, KV_HEAD_COUNT, 1, HEAD_DIMENSION],
          );
          outputs[presentValueOutputName(layer)] = trackedTensor(
            new Float32Array(KV_HEAD_COUNT * HEAD_DIMENSION).fill(1),
            [1, KV_HEAD_COUNT, 1, HEAD_DIMENSION],
          );
        }
        return outputs;
      }),
      dispose: vi.fn(async () => undefined),
    };
    const prompt: ValidatedPromptConfiguration = {
      id: 'cancel',
      prompt: 'Prompt',
      maxNewTokens: 8,
      contributionFormats: ['summed'],
      enableThinking: false,
      seed: 42,
      temperature: 0.6,
      topK: 20,
      topP: 0.95,
    };

    const controller = new AbortController();
    let yields = 0;
    const yieldControl = vi.fn(async () => {
      // Emulates the worker processing a queued 'cancel' message in the
      // macrotask opened between model passes.
      yields += 1;
      if (yields === 2) controller.abort();
    });
    const generatedTokens: bigint[] = [];
    const streamedRows: number[] = [];

    const run = generateSummedContributionDataset({
      modelProfile: UI_MODEL_PROFILE,
      model,
      tokenizer,
      prompt,
      signal: controller.signal,
      yieldControl,
      onGeneratedToken(token) {
        generatedTokens.push(token);
      },
      onSummedContributionRowUpdate(index) {
        streamedRows.push(index);
      },
    });

    await expect(run).rejects.toMatchObject({
      name: 'AbortError',
      message: 'Generation cancelled',
    });

    // The run stops at the first checkpoint after the cancel instead of
    // continuing to the configured token limit.
    expect(model.forward).toHaveBeenCalledTimes(2);
    expect(generatedTokens).toHaveLength(1);
    // Rows streamed before the cancel stay complete and in order.
    expect(streamedRows).toEqual([0, 1]);
    // No model outputs leak after the aborted run unwinds.
    for (const tensor of trackedTensors) {
      expect(tensor.dispose).toHaveBeenCalledTimes(1);
    }
  });
});
