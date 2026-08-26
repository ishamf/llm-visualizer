import { describe, expect, it, vi } from 'vitest';

import {
  addSummedContributionRows,
  disposeTokenizedPrompt,
  tokenizePrompt,
} from './generate.ts';
import type { Tokenizer } from './types.ts';

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
  it('adds corresponding causal rows without retaining layers', () => {
    const totals: number[][] = [];
    addSummedContributionRows(totals, 0, [[1], [2, 3]]);
    addSummedContributionRows(totals, 0, [[0.5], [4, 5]]);
    addSummedContributionRows(totals, 2, [[6, 7, 8]]);

    expect(totals).toEqual([[1.5], [6, 8], [6, 7, 8]]);
  });
});
