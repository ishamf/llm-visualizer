# ONNX instrumentation plan

## Visualization goal

The primary visualization should show how strongly each token attends to every
other token during generation. The core view is a token-to-token attention map,
selectable by transformer layer and attention head.

Attention is useful as a view of where a head reads information from, but it is
not a complete measure of causal influence. We may later supplement it with the
magnitude and direction of the value transferred between tokens.

## Model geometry

The current model is Qwen3-0.6B using the `q4f16` ONNX artifact. It has:

- 28 transformer layers
- 16 query heads per layer
- 8 key/value heads per layer
- A head dimension of 128
- 448 query heads in total (`28 layers × 16 heads`)

Qwen3 uses grouped-query attention. Each pair of query heads shares one
key/value head:

```text
Query heads 0–1   → KV head 0
Query heads 2–3   → KV head 1
...
Query heads 14–15 → KV head 7
```

For query head `h`, its key/value head is therefore `floor(h / 2)`.

## Values needed for the visualization

For layer `l`, query head `h`, destination token `i`, and source token `j`, the
attention weights are:

```text
scores[l,h,i,j] = dot(Q[l,h,i], K[l,floor(h / 2),j]) / sqrt(128) + mask[i,j]
A[l,h,i,:]      = softmax(scores[l,h,i,:])
```

The causal mask prevents a token from attending to future tokens.

The query and key tensors used here must be the values after Q/K normalization
and rotary positional embeddings. Raw projection outputs are not sufficient.

Once attention weights are available, the per-token value contribution is:

```text
C[l,h,i,j] = A[l,h,i,j] * V[l,floor(h / 2),j]
```

A simple scalar contribution magnitude is:

```text
magnitude[l,h,i,j] = L2(C[l,h,i,j])
                    = A[l,h,i,j] * L2(V[l,floor(h / 2),j])
```

The first version should focus on attention weights. Contribution magnitude,
signed alignment, and residual-stream contribution can be added later.

## Current ONNX graph

The downloaded `model_q4f16.onnx` graph has been inspected directly. Each of
its 28 layers contains explicit post-RoPE query and key tensors with names such
as:

```text
/model/layers.0/attn/q_rotary/RotaryEmbedding/output_0
/model/layers.0/attn/k_rotary/RotaryEmbedding/output_0
```

It also contains a fused `GroupQueryAttention` operator per layer:

```text
/model/layers.0/attn/GroupQueryAttention/output_0
```

The graph currently exposes:

- Final logits
- Accumulated key caches for all 28 layers
- Accumulated value caches for all 28 layers

It does not currently expose:

- Query tensors
- Raw query/key scores
- Softmax attention weights

The fused `GroupQueryAttention` operator calculates scores and softmax
internally. Its attention matrix is not a separately addressable graph tensor.
Its output is the combined attention context, followed by the model's output
projection.

## Instrumentation

The ONNX graph must expose the 28 post-RoPE query tensors needed for these
calculations. The implementation options and their tradeoffs are documented in
the [instrumentation strategy](./instrumentation-strategy.md).

A proposed extension that calculates source-token contribution magnitudes after
each attention output projection is documented in the
[extended instrumentation plan](./extended-instrumentation-plan.md).

The nearer-term Node.js dataset pipeline using head-aggregated, unprojected
contribution magnitudes is documented in the
[pre-generated contribution data plan](./pre-generated-contribution-data-plan.md).

## Generation-time data flow

Generation has two relevant phases:

1. **Prompt prefill:** each query output contains queries for all prompt tokens.
   The key/value outputs contain the prompt's accumulated cache.
2. **Incremental decoding:** each query output contains the query for the new
   token. The key/value outputs contain the accumulated cache for the prompt and
   all generated tokens so far.

For each forward pass and layer:

1. Read the instrumented query output.
2. Read the corresponding accumulated key and value cache.
3. Map each of the 16 query heads to one of the 8 KV heads.
4. Calculate scaled query/key dot products.
5. Apply the causal mask and softmax.
6. Store or stream the resulting token-to-token attention rows.
7. Optionally calculate attention-weighted value contributions.

The calculation can be performed by a small optimized tensor graph or kernel;
it should not use deeply nested JavaScript loops for production-sized contexts.

## Validation

Before building the visualization, verify that the instrumentation and derived
attention values reproduce the original model behavior:

1. Confirm that adding outputs does not change generated logits.
2. Confirm the runtime shapes and axis order of Q, K, and V.
3. Reconstruct each head's attention output as `softmax(QKᵀ / sqrt(128))V`.
4. Concatenate the 16 reconstructed head outputs.
5. Compare the result against the promoted fused
   `GroupQueryAttention/output_0` tensor.
6. Test both prompt prefill and single-token decoding.
7. Establish numerical tolerances appropriate for float16 computation.

Small differences from the fused kernel are expected because of operation
ordering and float16 rounding. Large differences indicate an incorrect axis
order, KV-head mapping, positional treatment, mask, or scaling factor.

## Interpretation limits

Attention weights show where a particular head reads from. They do not by
themselves prove how much a source token causally changed the final prediction.
Value vectors, output projections, residual connections, MLP blocks, and later
layers can amplify, redirect, or cancel information.

The UI should label the initial metric as **attention weight**, not generic
token influence. If contribution magnitude or causal-ablation metrics are added
later, they should be presented as separate views.
