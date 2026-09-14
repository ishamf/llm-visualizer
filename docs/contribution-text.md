# Contribution text

The **contribution text** visualization renders the prompt and the generated
response as plain text, and each token's opacity shows how strongly every
earlier token contributed to it. Hovering a generated token highlights its
strongest sources. It lives at `/attention`, is embedded on the homepage,
and is also published as the `xif-contribution-text` web component.

You can explore a pre-generated example, or type a prompt and generate a new
response: the model runs locally in a web worker, so the prompt never leaves
the browser. The file formats of the pre-generated examples are described in
[Contribution datasets](contribution-datasets.md).

## Setup

The general setup — installing dependencies and starting the dev server — is
in the [README](../README.md#setup). On top of it, the contribution-text
visualization needs the instrumented model and, for the pre-generated
examples, locally generated data.

### 1. Download the model

The app is pinned to Qwen3-0.6B with `int8` weights (`MODEL_CONFIGURATION` in
`src/generation/config.ts`) and, in development, loads the instrumented ONNX
file at `models/Qwen3-0.6B-ONNX/onnx/instrumented_int8.onnx` plus the
tokenizer and config files next to it. The visualizations read internal
attention tensors that stock ONNX models do not expose, so the weights must be
instrumented; any way of placing the files in `models/Qwen3-0.6B-ONNX` works.
For example, with the Hugging Face CLI and the pre-instrumented
[ishamf/Qwen3-0.6B-ONNX-Instrumented](https://huggingface.co/ishamf/Qwen3-0.6B-ONNX-Instrumented)
repository (≈630 MB):

```sh
hf download ishamf/Qwen3-0.6B-ONNX-Instrumented \
  onnx/instrumented_int8.onnx \
  config.json generation_config.json \
  tokenizer.json tokenizer_config.json \
  special_tokens_map.json added_tokens.json \
  vocab.json merges.txt chat_template.jinja \
  --local-dir models/Qwen3-0.6B-ONNX
```

Alternatively, download the original model from
[onnx-community/Qwen3-0.6B-ONNX](https://huggingface.co/onnx-community/Qwen3-0.6B-ONNX)
(same file list, with `onnx/model_int8.onnx` instead of
`onnx/instrumented_int8.onnx`) and run the instrumentation script after
installing its pip dependencies — see
[Model instrumentation](instrumentation.md).

`models/` is gitignored, so this is a local, one-time setup step.

### 2. Optional: generate the pre-generated prompts

The contribution-text pre-generated prompts load from `generated/`
(gitignored). The exporter runs the same model in Node for every configured
prompt:

```sh
pnpm generate:summed-contributions
pnpm generate:data-manifest
```

Dataset formats and exporter options are described in
[Contribution datasets](contribution-datasets.md), and the discovery
catalogs in [Generated data manifests](generated-data-manifests.md).

### 3. Try it out

Open <http://localhost:5173> and type a prompt. The model runs in a web worker
in your browser, so the prompt never leaves your machine. The first generation
fetches the ≈620 MB of weights from the dev server; the browser caches them,
so later runs start faster.

A fresh clone has no `generated/` data, so the pre-generated examples area
shows an error message; in-browser generation is unaffected. Generate the
prompts locally (previous step) or point `VITE_GENERATED_DATA_BASE_URL` at a
deployed data origin.

## How contribution is measured

The dataset metric is the **unprojected attention contribution magnitude**.
For layer `l`, query head `h`, destination token `i`, and source token `j`:

```text
A[l,h,i,j]       = softmax(QKᵀ / √128 + causal mask)
m[l,h,i,j]       = A[l,h,i,j] * ‖V[l,⌊h/2⌋,j]‖
aggregate[l,i,j] = √(Σ_h m[l,h,i,j]²)
```

- `Q` and `K` are the post-RoPE query and key vectors, and the causal mask
  prevents attention to future tokens.
- Qwen3 uses grouped-query attention: query head `h` reads the key/value head
  `⌊h/2⌋`, so each source contributes its value vector `V` to every query head
  that reads it.
- A head transfers the source's value vector scaled by the attention weight,
  and `m` is the magnitude of that transfer.
- The 16 query heads are aggregated with a root-sum-square, which is the L2
  norm of the concatenated per-head source contributions. This is exact before
  the attention output projection.

The contribution-text visualization sums `aggregate` across all 28 layers.
The opacity of a generated token therefore reflects how much value-vector
magnitude each earlier token supplied to the attention blocks that produced
its prediction.

This is not a measure of total causal influence on the final logits. The
attention output projection, residual connection, MLP, later layers, and the
language-model head can redirect or cancel it. A post-output-projection
metric is planned in
[the extended instrumentation plan](plans/extended-instrumentation-plan.md).
