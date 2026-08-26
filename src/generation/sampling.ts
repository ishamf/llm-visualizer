import type { NumericArray } from './types.ts';

type Candidate = { token: number; logit: number; weight?: number };

export type SamplingOptions = {
  temperature: number;
  topK: number;
  topP: number;
  random: () => number;
};

export function sampleToken(
  logits: NumericArray,
  { temperature, topK, topP, random }: SamplingOptions,
) {
  if (!Number.isFinite(temperature) || temperature <= 0) {
    throw new Error('Sampling temperature must be positive');
  }
  if (!Number.isSafeInteger(topK) || topK < 1) {
    throw new Error('Sampling topK must be a positive integer');
  }
  if (!Number.isFinite(topP) || topP <= 0 || topP > 1) {
    throw new Error('Sampling topP must be in (0, 1]');
  }

  const candidates: Candidate[] = [];
  for (let token = 0; token < logits.length; ++token) {
    const logit = Number(logits[token]);
    if (candidates.length < topK) {
      candidates.push({ token, logit });
      continue;
    }
    let weakest = 0;
    for (let index = 1; index < candidates.length; ++index) {
      if (candidates[index].logit < candidates[weakest].logit) weakest = index;
    }
    if (logit > candidates[weakest].logit) {
      candidates[weakest] = { token, logit };
    }
  }
  candidates.sort((left, right) => right.logit - left.logit);

  const maximum = candidates[0]?.logit;
  if (maximum === undefined) throw new Error('Cannot sample empty logits');
  let total = 0;
  for (const candidate of candidates) {
    candidate.weight = Math.exp((candidate.logit - maximum) / temperature);
    total += candidate.weight;
  }

  let nucleusTotal = 0;
  let nucleusSize = 0;
  for (const candidate of candidates) {
    nucleusTotal += candidate.weight!;
    ++nucleusSize;
    if (nucleusTotal / total >= topP) break;
  }

  let selection = random() * nucleusTotal;
  for (let index = 0; index < nucleusSize; ++index) {
    selection -= candidates[index].weight!;
    if (selection < 0) return BigInt(candidates[index].token);
  }
  return BigInt(candidates[nucleusSize - 1].token);
}
