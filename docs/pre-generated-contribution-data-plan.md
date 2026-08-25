# Pre-generated contribution data plan

## Goal

Build the first visualization dataset offline in Node.js using the current
instrumented Qwen3 model. The browser will read pre-generated JSON rather than
load or run the model.

The initial dataset will contain one causal source-to-destination contribution
matrix per transformer layer. Contributions will be aggregated across query
heads before serialization. QK products, attention weights, value vectors, and
per-head contribution matrices will not be stored.

This is an intentionally simpler first metric than the post-output-projection
metric described in the
[extended instrumentation plan](./extended-instrumentation-plan.md). It can be
generated from the outputs the current instrumented model already exposes.

## Contribution metric

For layer `l`, query head `h`, destination token `i`, and source token `j`, the
per-head contribution magnitude is:

```text
m[l,h,i,j] = A[l,h,i,j] * L2(V[l,kv(h),j])
```

where:

```text
A[l,h,i,:] = softmax(QKᵀ / sqrt(128) + mask)
kv(h) = floor(h / 2)
```

Aggregate the 16 query heads using root-sum-square:

```text
aggregate[l,i,j] = sqrt(sum_h m[l,h,i,j]^2)
```

Root-sum-square is preferred over a plain sum because the unprojected head
contributions occupy separate slices of the concatenated attention context.
The aggregate is therefore the L2 norm of the concatenated per-head source
contribution:

```text
aggregate[l,i,j]
    = L2(concat_h(A[l,h,i,j] * V[l,kv(h),j]))
```

This interpretation is exact before the attention output projection. It does
not capture cancellation or amplification between heads introduced by that
projection.

## Interpretation and labeling

The visualization should label the value **unprojected attention contribution
magnitude** or, where space is limited, **attention contribution magnitude**
with an explanatory tooltip.

It measures the amount of value-vector magnitude a source supplies to an
attention block. It is not a measure of total causal influence on the final
logits. The attention output projection, residual connection, MLP, later layers,
and language-model head can redirect or cancel it.

## Code organization

Refactor reusable logic from `src/scripts/validate-instrumentation.ts` into
`src/generation/`:

```text
src/generation/
├── config.ts
├── model-output-names.ts
├── attention.ts
├── validation.ts
├── generate.ts
├── dataset.ts
├── types.ts
└── prompts.ts
```

Suggested responsibilities:

- `config.ts`: model geometry, tolerances, model ID, and generation ceiling
- `model-output-names.ts`: query, fused-context, and cache output-name helpers
- `attention.ts`: scaled attention, softmax, grouped-query mapping, value norms,
  and head aggregation
- `validation.ts`: tensor shapes, unchanged logits, and fused-context
  reconstruction checks
- `generate.ts`: application-owned greedy generation loop and tensor lifetime
  management
- `dataset.ts`: versioned JSON structures and serialization helpers
- `types.ts`: shared model-output, contribution, prompt, and manifest types
- `prompts.ts`: the editable list of prompts to pre-generate

The existing validation CLI should become a thin consumer of these modules so
the validator and dataset exporter use exactly the same tensor interpretation.

## Prompt configuration

Keep prompts in a separate source file so new examples can be added without
changing the exporter:

```ts
export const prompts = [
  {
    id: 'hello',
    prompt: 'Say hello.',
    assistantPrefix: 'Hello',
    maxNewTokens: 64,
  },
];
```

Each entry should contain:

- A stable, filesystem-safe ID
- The user prompt
- An optional system prompt
- An optional assistant-response prefix, appended after the chat template's
  assistant generation marker
- An optional per-prompt generated-token limit

Generation remains deterministic and greedy for reproducible data. The global
generated-token ceiling remains 1,000, but initial prompt entries should use
substantially smaller limits because contribution matrices grow quadratically.

Duplicate IDs, unsafe path characters, empty prompts, and limits outside the
allowed range should fail before model loading begins.

## Generation flow

The dataset script should load the tokenizer and instrumented model once, then
process prompts sequentially:

1. Apply the model's chat template.
2. Run prompt prefill directly through `model.forward()`.
3. Validate all promoted Q, K, V, and fused-context outputs.
4. Calculate contribution rows for every prompt token and layer.
5. Select the next token greedily from the final logits.
6. Run each generated token through a direct incremental forward pass.
7. Calculate its new contribution row for every layer.
8. Dispose the previous step's outputs after its K/V cache has been consumed.
9. Stop at EOS or the configured generated-token limit.
10. Write the completed prompt dataset atomically.

The final generated token must receive its own forward pass so it has a query
and contribution row, even though its logits are not needed when generation
stops at the limit.

Using an application-owned generation loop avoids the need for a patched
Transformers.js generation callback in this offline Node.js pipeline.

## Calculation flow

For each layer and forward-pass query row:

1. Read the post-RoPE query output.
2. Read the accumulated key and value cache.
3. Map each query head to `floor(h / 2)` key/value head.
4. Calculate scaled QK scores over causal source positions.
5. Apply stable softmax.
6. Calculate and cache each KV head/source value-vector norm for the step.
7. Calculate `attention * valueNorm` for each query head and source.
8. Accumulate the square of that magnitude into the source entry.
9. Take the square root after all 16 heads have been processed.

Only the final scalar row needs to survive the step. Q, K, V, attention scores,
and per-head magnitudes must not be retained in the dataset.

The first implementation may use straightforward typed-array loops, since this
is an offline generator. Performance should be measured before introducing a
native or ONNX calculation branch.

## Output layout

Write each prompt to its own directory and shard contribution data by layer:

```text
generated/contributions/hello/
├── manifest.json
├── layer-00.json
├── layer-01.json
├── ...
└── layer-27.json
```

The target directory should be configurable. Generated data should not be
committed accidentally unless a later decision explicitly places selected
datasets under application assets.

### Manifest

`manifest.json` should contain:

```json
{
  "schemaVersion": 1,
  "metric": "unprojected-attention-contribution-rss",
  "model": {
    "id": "Qwen3-0.6B-ONNX",
    "dtype": "q4f16",
    "instrumentation": "instrumented"
  },
  "prompt": "Say hello.",
  "assistantPrefix": "Hello",
  "generatedText": "Hello!",
  "promptTokenCount": 26,
  "tokens": [
    { "id": 151644, "text": "<|im_start|>" },
    { "id": 8948, "text": "Hello" }
  ],
  "geometry": {
    "layers": 28,
    "queryHeads": 16,
    "kvHeads": 8,
    "headDimension": 128
  },
  "generation": {
    "method": "greedy",
    "maxNewTokens": 64,
    "stopReason": "eos"
  },
  "validation": {
    "logitsMaxAbsoluteError": 0,
    "contextsMaxAbsoluteError": 0.01147
  }
}
```

The precise token IDs above are illustrative. JSON must serialize token IDs as
numbers rather than JavaScript `bigint` values.

### Layer files

Each layer file should contain one triangular matrix:

```json
{
  "schemaVersion": 1,
  "layer": 27,
  "metric": "unprojected-attention-contribution-rss",
  "rows": [[12.4], [3.1, 9.8], [1.2, 4.7, 8.5]]
}
```

Row `i` contains exactly `i + 1` values corresponding to causal source tokens
`0` through `i`. No future-token placeholders should be written.

The browser can load the manifest first and fetch only the currently selected
layer file.

## Atomic and repeatable output

For each prompt:

1. Write files into a uniquely named temporary sibling directory.
2. Validate the completed manifest and all 28 layer files.
3. Replace the destination directory only after every file succeeds.

The exporter should either reject an existing destination or require an
explicit overwrite flag. It must not leave a mixture of old and new layer files
after an interrupted run.

Stable prompt IDs, deterministic generation, and a schema version make outputs
repeatable. The manifest should eventually include the source model checksum
and instrumentation version so stale datasets can be detected.

## Validation

Before writing a dataset, retain the existing integration checks:

1. Adding graph outputs does not change prompt logits.
2. All 28 query outputs have shape `[1, query_length, 2048]`.
3. All K/V caches have shape `[1, 8, total_length, 128]`.
4. All promoted fused contexts have shape `[1, query_length, 2048]`.
5. Reconstructed contexts match the fused outputs within the established
   float16 tolerance during prefill and decoding.
6. Contribution rows contain finite, non-negative values.
7. Row lengths form a complete causal triangle across prompt and generated
   tokens.
8. The number of tokens in the manifest matches every layer matrix.

Failures should identify the prompt, phase, generation step, layer, and tensor
name where possible. A failed prompt must not produce a completed output
directory.

## Testing

Add unit tests with small synthetic tensors for:

- Stable softmax
- Causal source limits
- Grouped-query head mapping
- Value-vector norms
- Root-sum-square head aggregation
- Prefill and single-token decoding row indices
- Triangular serialization
- Prompt validation and safe output paths
- Manifest and layer-file consistency

Keep the real model validation as an explicit integration command because it
requires the large local ONNX artifact.

Suggested commands:

```text
pnpm validate:instrumentation "Say hello."
pnpm generate:contribution-data
```

The bulk-generation command should support selecting one prompt ID so datasets
can be tested without processing the entire prompt list.

## Storage considerations

Aggregation removes the 16-head dimension, leaving:

```text
28 * N * (N + 1) / 2 contribution values
```

Approximate value counts are:

```text
N = 128:      231,168 values
N = 256:      920,576 values
N = 1,000: 14,014,000 values
```

Plain JSON adds substantial textual overhead but is reasonable for initial
short examples. Layer sharding prevents the browser from loading all 28 layers
at once. If long examples become important, preserve the logical schema while
moving matrix values to compressed binary typed arrays.

## Implementation stages

1. Extract and unit-test the pure attention and aggregation functions.
2. Extract model loading, direct generation, cache handling, and validation.
3. Keep the current validation CLI working through the refactored modules.
4. Add prompt configuration and validation.
5. Define the versioned manifest and layer-file types.
6. Implement one-prompt contribution collection and atomic serialization.
7. Implement sequential bulk prompt processing and prompt selection.
8. Benchmark time, peak memory, and output size at increasing token counts.
9. Load one generated dataset in the browser before expanding the prompt set.

## Deferred work

The following are explicitly deferred from this first dataset format:

- Per-head matrices
- Raw or scaled QK products
- Stored attention-weight matrices
- Post-output-projection contribution magnitudes
- Residual-stream or MLP attribution
- Causal ablation metrics
- Browser-side model execution
- Binary matrix encoding

The schema's metric identifier must remain explicit so a later
post-output-projection dataset cannot be confused with this initial aggregate.

## Current implementation state

As of 2026-08-09, the offline contribution-data pipeline is implemented.

Reusable code now lives in `src/generation/`:

- `config.ts` defines the model identity, geometry, tolerances, schema version,
  metric identifier, and 1,000-token global ceiling.
- `model-output-names.ts` centralizes promoted query/context and K/V cache names.
- `attention.ts` implements stable scaled attention, grouped-query head mapping,
  value-vector norms, and root-sum-square contribution aggregation.
- `validation.ts` implements tensor-shape checks, logits comparison, and fused
  attention-context reconstruction.
- `generate.ts` owns prompt prefill, greedy incremental decoding, K/V cache and
  tensor lifetime handling, contribution collection, and manifest construction.
- `dataset.ts` validates complete causal triangles and writes a manifest plus 28
  layer shards through a temporary sibling directory. Existing destinations are
  rejected unless overwrite is explicitly enabled.
- `types.ts`, `prompts.ts`, and their tests define the shared data structures and
  validate prompt IDs, content, duplicate IDs, and generation limits.

The exporter is `src/scripts/generate-contributions.ts` and is exposed as:

```text
pnpm generate:contributions
pnpm generate:contributions --output <directory> --overwrite
```

It validates the prompt list before loading a model, loads the original model
once to capture reference prompt logits, then loads the instrumented model once
and processes configured prompts sequentially. Output defaults to
`generated/contributions/`, which is ignored by Git. The final generated token,
including EOS or the token at the configured limit, receives its own forward
pass and contribution row.

The instrumentation validator is now a thin consumer of the shared attention,
cache, generation-helper, and validation modules. Its displayed strongest-token
values consequently use the same root-sum-square metric as exported datasets.

Automated verification currently passes:

- 10 Vitest tests covering grouped-query mapping, RSS aggregation, prompt
  validation, causal-triangle validation, layer serialization, overwrite
  rejection, and the existing application test.
- TypeScript and Vite production build.
- ESLint and Prettier checks.
- A real-model export using the local original and instrumented q4f16 models.

The real-model smoke export generated 36 tokens and all 28 layer files. Every
sampled layer contained 36 rows with a 36-value final row, prompt logits matched
exactly (`max absolute error = 0`), and the worst reconstructed attention-context
error was `0.011465109036279841`, below the `0.025` tolerance. Generation stopped
at EOS and decoded to `Hello! How can I assist you today?`.

The following planned work remains:

- Add a command-line option to select a single configured prompt by ID.
- Expand the synthetic tests so stable softmax, value norms, prefill indices,
  and decoding indices each have dedicated cases rather than being covered only
  through combined math tests and real-model validation.
- Benchmark runtime, peak memory, and output size across increasing context
  lengths.
- Load and visualize a generated dataset in the browser.
- Add source-model checksum and instrumentation-version metadata to detect stale
  datasets.
