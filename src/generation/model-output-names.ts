export const queryOutputName = (layer: number) =>
  `/model/layers.${layer}/attn/q_rotary/RotaryEmbedding/output_0`;

export const contextOutputName = (layer: number) =>
  `/model/layers.${layer}/attn/GroupQueryAttention/output_0`;

export const presentKeyOutputName = (layer: number) => `present.${layer}.key`;

export const presentValueOutputName = (layer: number) =>
  `present.${layer}.value`;

export const pastKeyInputName = (layer: number) =>
  `past_key_values.${layer}.key`;

export const pastValueInputName = (layer: number) =>
  `past_key_values.${layer}.value`;
