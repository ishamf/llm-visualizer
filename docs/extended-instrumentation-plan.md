# Extended ONNX instrumentation plan

## Goal

Extend the instrumented Qwen3 ONNX model so it directly returns a scalar
source-to-destination contribution magnitude after each attention layer's
output projection.

For every layer and destination token, the generated dataset should answer:

> How large is each source token's contribution to the attention update after
> the query heads have been combined by the output projection?

The first dataset format will store this value aggregated across attention
heads. It will not store per-head QK products or per-head contribution values.

## Metric

For layer `l`, query head `h`, destination token `i`, and source token `j`, let:

```text
A[l,h,i,j] = softmax(QKᵀ / sqrt(head_dim))[l,h,i,j]
V[l,kv(h),j] = the value vector read by query head h
Wₒ[l,h] = the rows of the attention output-projection matrix belonging to h
```

The projected contribution from one head is:

```text
p[l,h,i,j] = A[l,h,i,j] * (V[l,kv(h),j] Wₒ[l,h])
```

The heads must be added as vectors before measuring their combined magnitude:

```text
c[l,i,j] = sum_h p[l,h,i,j]
magnitude[l,i,j] = L2(c[l,i,j])
```

This differs from summing per-head magnitudes. Taking the norm after the output
projection preserves cancellation and reinforcement between heads introduced
by that projection.

Because the output projection is linear, the source contributions have the
following exact decomposition:

```text
sum_j c[l,i,j]
    = Wₒ[l] concat_h(sum_j A[l,h,i,j] V[l,kv(h),j])
```

The right-hand side is the ordinary projected attention output for destination
token `i`, before residual addition.

## Interpretation

This metric is more informative than attention weight alone because it includes:

- The attention weight assigned to the source
- The magnitude and direction of the source's value vector
- Mixing, cancellation, and amplification across heads by the output projection

It remains a local decomposition of one attention block. It is not total causal
influence on the generated logits. Residual connections, MLP blocks, later
transformer layers, and the language-model head can alter or cancel the update.

The visualization should label it **projected attention contribution magnitude**.

## Why promoting an existing tensor is insufficient

The existing `GroupQueryAttention` output has already summed every source token
within each head. The following output projection consequently contains only
the total attention update:

```text
Wₒ sum_j c_before_projection[l,i,j]
```

Promoting that tensor is useful for validation, but it cannot recover a
per-source decomposition. The source-token axis no longer exists.

The extended model therefore needs a new side branch that reconstructs
attention and keeps the source axis until the scalar contribution magnitude has
been calculated.

## Proposed graph outputs

Add one output per transformer layer:

```text
projected_attention_contribution.0
projected_attention_contribution.1
...
projected_attention_contribution.27
```

Each output has shape:

```text
[batch_size, query_sequence_length, total_sequence_length]
```

The output contains only causal entries. Future positions during prefill should
be represented consistently either as zero or excluded by a separate causal
length convention. Zero-filled future entries are easier to express in a dense
ONNX tensor; the JSON exporter can omit them and write triangular rows.

During incremental decoding, `query_sequence_length` is one and the output is a
single contribution row over the accumulated prompt and generated-token cache.

During development, also promote the existing post-output-projection attention
tensor for each layer. These validation outputs can be removed once the derived
branch has been verified.

## Graph calculation

### Reference calculation

The most direct branch is:

1. Reconstruct scaled QK scores from the existing post-RoPE Q and accumulated K.
2. Apply the same causal and padding masks as `GroupQueryAttention`.
3. Apply softmax to obtain `A[h,i,j]`.
4. Multiply every source value vector by its corresponding attention weight.
5. Concatenate head contributions for each `(i,j)` pair.
6. Apply the existing layer output projection.
7. Reduce the projected hidden dimension with an L2 norm.

A literal implementation creates an intermediate shaped approximately:

```text
[batch, query, source, hidden_size]
```

This is useful as a small-context correctness prototype, but it is too large for
long prompt prefill and should not be the final implementation.

### Reduced-memory calculation

The final branch should avoid materializing a projected 1,024-element vector for
every source/destination pair.

For a layer and source token, first project the value for each head through that
head's slice of the output-projection matrix:

```text
P[j,h,:] = V[kv(h),j] Wₒ[h]
```

Then calculate a small head-to-head Gram matrix:

```text
G[j,h,g] = dot(P[j,h,:], P[j,g,:])
```

For the vector of attention weights `a = A[:,i,j]`, the squared projected
contribution magnitude is:

```text
magnitude[i,j]^2 = aᵀ G[j] a
```

The final magnitude is:

```text
magnitude[i,j] = sqrt(max(aᵀ G[j] a, 0))
```

The clamp protects against a very small negative value caused by floating-point
rounding.

This replaces the large `[query, source, hidden_size]` intermediate with:

```text
P: [source, query_heads, hidden_size]
G: [source, query_heads, query_heads]
output: [query, source]
```

The Gram matrix retains cross-head cancellation and reinforcement exactly,
subject to runtime precision.

## Quantized output projection

The `q4f16` model's output projection is quantized. The implementation should
reuse ONNX Runtime's existing quantized projection operator rather than
independently reproducing its packing, scales, zero points, and rounding unless
inspection shows that extracting head slices is straightforward.

The initial implementation spike must inspect each layer's output-projection
node and determine:

1. Its operator type and input/output axis order
2. How the 16 head slices map onto the packed projection input dimension
3. Whether the quantized operator can efficiently project a batch containing
   one isolated head per row
4. Whether graph transformation requires copied initializers or can reference
   the existing initializers directly
5. Whether graph optimization duplicates or dequantizes the projection weights
   after adding the side branch

If reusing the quantized operator inside the main model is impractical, a
fallback is to generate one auxiliary projection ONNX model per layer, sharing
or copying the required initializers. The Node.js exporter can run those models
while retaining only scalar results. This fallback should preserve the same
dataset schema.

## Masking and grouped-query attention

The derived branch must exactly match the fused operator:

- Query heads: 16
- Key/value heads: 8
- Query head `h` uses KV head `floor(h / 2)`
- Head dimension: 128
- Scale: `1 / sqrt(128)`
- Q and K values: after Q/K normalization and rotary positional embeddings
- Prefill: causal mask plus any supplied padding mask
- Decoding: one query token over the complete accumulated K/V cache

The branch must not assume batch size one even if the first Node.js dataset
generator processes prompts individually.

## Transformation artifact

This extension should create a new instrumentation version rather than silently
replacing the current query/context artifact. Its manifest should include:

- Source model revision and checksum
- Instrumentation schema version
- Metric name and formula version
- Model geometry
- Added output names and layer mapping
- Whether temporary validation outputs are included
- Numeric types used for attention, projection, Gram products, and reduction

The official model remains immutable. The transformed model should be written
atomically and cached using the source checksum and instrumentation version.

## Validation

Validation should cover prompt prefill and multiple incremental decoding steps.

### Existing checks

1. Instrumented logits match the official model.
2. Q, K, V, fused-context, and cache shapes match the documented geometry.
3. Reconstructed fused contexts match `GroupQueryAttention/output_0` within the
   established float16 tolerance.

### Projected-contribution checks

For each layer and query token:

1. Reconstruct every full projected contribution vector `c[i,j]` in a slow
   JavaScript or float32 reference implementation for a short context.
2. Compare `L2(c[i,j])` with the new scalar ONNX output.
3. Sum the full reference contribution vectors across source tokens.
4. Compare that sum with the promoted ordinary output-projection result.
5. Compare the direct reference calculation with the Gram-matrix calculation.
6. Confirm causal future positions are zero.
7. Confirm padding tokens receive zero contribution when padding is present.
8. Confirm the grouped-query head mapping is correct.

Record maximum, mean, and percentile absolute errors. Also report errors relative
to typical nonzero contribution magnitudes; relative error alone is unstable for
values near zero.

## Performance and memory validation

Benchmark the extended model separately for prefill and decoding at representative
sequence lengths. At minimum, record:

- Wall-clock inference time
- Peak resident memory
- Size and transfer time of additional outputs
- Effect on original logits and cache execution
- Whether graph optimization or buffer reuse changes after instrumentation

Suggested initial lengths are 32, 64, 128, 256, and 1,024 tokens. Stop increasing
the test length if memory growth is unsafe.

The scalar output itself still grows quadratically during prefill:

```text
28 layers * sequence_length^2 values
```

Incremental decoding returns only one new row per layer and should be processed
and released immediately. The Node.js generator should write triangular JSON
rows and avoid retaining raw Q, K, V, or intermediate projected vectors after a
step has been processed.

## Dataset impact

With this extension, the pre-generated visualization dataset needs only:

- Token IDs and display strings
- Prompt/generated token boundary
- Generation and model metadata
- One triangular projected-contribution matrix per layer
- Validation summary

It does not need to store QK products, attention weights, value vectors, or a
head dimension. This substantially reduces JSON size while preserving the
chosen aggregate metric.

## Implementation stages

1. Inspect and document the quantized output-projection nodes and weights.
2. Build a short-context reference implementation outside ONNX.
3. Add a direct, unoptimized derived branch for one layer.
4. Validate its scalar output and summed vectors against existing model outputs.
5. Implement the reduced-memory Gram calculation.
6. Compare the direct and Gram implementations.
7. Extend the branch to all 28 layers and add versioned output metadata.
8. Benchmark prefill and decoding memory before adopting the artifact for bulk
   dataset generation.
9. Remove temporary validation outputs when the implementation is stable.

## Open questions

- Can the packed quantized projection be efficiently reused for isolated head
  inputs, or should the transformation create auxiliary projection graphs?
- Should Gram products accumulate in float32 even when Q, K, V, and projection
  outputs use float16?
- Does returning 28 contribution matrices inhibit important ONNX Runtime graph
  optimizations or buffer reuse?
- What maximum prefill length is practical before JSON size or runtime memory
  warrants a binary dataset format?
