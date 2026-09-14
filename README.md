# LLM Visualizer

A Vite/React application for exploring language-model internals. It has two
main visualizations: **contribution text** and a **coding agent replay**.
Pre-generated data loads as static JSON from a separately deployable origin,
and contribution text can also generate new responses privately in the
browser with an instrumented ONNX model.

## Visualizations

### Contribution text

The prompt and the generated response are rendered as plain text, and each
token's opacity shows how strongly every earlier token contributed to it.
Hovering a generated token highlights its strongest sources. You can explore
a pre-generated example at `/attention`, or type a prompt and generate a new
response: the model runs locally in a web worker, so the prompt never leaves
the browser.

How the contribution is measured and rendered is described in
[Contribution text](docs/contribution-text.md).

### Coding agent replay

A recorded coding agent session is replayed as it happened at
`/coding-agent`: user prompts, the assistant's streaming thinking and text,
tool calls with their results, and the provider requests that produced all
of it, with token counts, payload sizes, and prices.

It is described in [Coding agent replay](docs/coding-agent.md), with
implementation details in
[Coding agent visualization](docs/coding-agent-visualization.md).

## Experimental visualizations

The app also ships smaller experiments, reachable from the dev-only picker at
`/dev/visualizations`:

- **Attention contributions** (contribution grid): which earlier token value
  vectors contribute to each destination token, per transformer layer, using
  layered datasets. Its design is described in
  [the instrumentation plan](docs/plans/instrumentation-plan.md).

## Setup

### 1. Install dependencies

```sh
pnpm install
```

### 2. Download the model

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
[Model instrumentation](docs/instrumentation.md).

`models/` is gitignored, so this is a local, one-time setup step.

### 3. Optional: generate the pre-generated prompts

The contribution-text pre-generated prompts load from `generated/`
(gitignored). The exporter runs the same model in Node for every configured
prompt:

```sh
pnpm generate:summed-contributions
pnpm generate:data-manifest
```

Dataset formats and exporter options are described in
[Contribution datasets](docs/contribution-datasets.md), and the discovery
catalogs in [Generated data manifests](docs/generated-data-manifests.md).

### 4. Start the dev server

```sh
pnpm dev
```

Open <http://localhost:5173> and type a prompt. The model runs in a web worker
in your browser, so the prompt never leaves your machine. The first generation
fetches the ≈620 MB of weights from the dev server; the browser caches them,
so later runs start faster.

A fresh clone has no `generated/` data, so the pre-generated examples area
shows an error message; in-browser generation is unaffected. Generate the
prompts locally (previous step) or point `VITE_GENERATED_DATA_BASE_URL` at a
deployed data origin.

You can check the setup with `pnpm test` and `pnpm lint`; neither needs the
model.

## Documentation

- [Contribution text](docs/contribution-text.md) — the contribution-text
  visualization
- [Coding agent replay](docs/coding-agent.md) — the coding agent
  visualization
- [Coding agent visualization](docs/coding-agent-visualization.md) —
  implementation details for the replay
- [Deployment](docs/deployment.md) — production builds, model and
  generated-data hosting, response headers, web-component build
- [Contribution datasets](docs/contribution-datasets.md) — dataset formats,
  manifest and file schemas, exporter commands, atomic output
- [Model instrumentation](docs/instrumentation.md) — promoting attention
  tensors to ONNX graph outputs
- [Generated data manifests](docs/generated-data-manifests.md) —
  discovery-catalog layout, ordering, validation, runtime discovery
- [Plans](docs/plans/) — design and planning documents for shipped and future
  work
