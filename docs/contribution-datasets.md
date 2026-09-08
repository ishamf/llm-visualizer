# Contribution datasets

Pre-generated contribution datasets are produced offline from the instrumented
model and served as static JSON. The browser never runs the model to display
pre-generated examples. The metric that produced these values is described in
the [README](../README.md#how-contribution-is-measured).

Every dataset identifies its metric as
`unprojected-attention-contribution-rss` and uses schema version 1, so a
future metric cannot be mistaken for this one.

## Formats

There are two exporters:

- **Layered** (`pnpm generate:contributions`) stores one triangular
  contribution matrix per transformer layer, covering every destination token.
  It backs the experimental contribution-grid visualization. Because the text
  view only explains generated tokens, most of these rows go unused there.
- **Summed** (`pnpm generate:summed-contributions`) runs the model once and
  writes two consistent outputs into the same dataset folder:
  - `contributions.json`, the sum of all layer matrices, which is what the
    contribution-text visualization shows. It retains only the rows for
    generated tokens, so it stores approximately `G × P + G² / 2` values
    instead of `layers × (P + G)² / 2` for `P` prompt tokens and `G` generated
    tokens.
  - `layer-00.json` … `layer-NN.json`, per-layer matrices for the generated
    destinations only (`G × P + G² / 2` values per layer). They let the
    contribution-text visualization re-sum any range of layers with its layer
    control, including a single layer.

Both outputs come from the same generation run, and the exporter rejects a
dataset whose per-layer matrices do not sum exactly to `contributions.json`,
so the two representations can never drift apart. The visualization renders
the summed file first and downloads the per-layer files only when a layer
range other than "all layers" is selected; downloads are cached per session.
Datasets declare the extra files with `layeredGeneratedContributions: true` in
their manifest, so older datasets without them simply render without the
layer control.

## Layout

Each format, model, and model variant folder is self-contained:

```text
generated/
  contributions/<model-key>/<model-variant>/manifest.json
  contributions/<model-key>/<model-variant>/<dataset-id>/manifest.json
  contributions/<model-key>/<model-variant>/<dataset-id>/layer-00.json
  contributions/<model-key>/<model-variant>/<dataset-id>/layer-01.json
  ...
  summed-contributions/<model-key>/<model-variant>/manifest.json
  summed-contributions/<model-key>/<model-variant>/<dataset-id>/manifest.json
  summed-contributions/<model-key>/<model-variant>/<dataset-id>/contributions.json
  summed-contributions/<model-key>/<model-variant>/<dataset-id>/layer-00.json
  summed-contributions/<model-key>/<model-variant>/<dataset-id>/layer-01.json
  ...
```

The `manifest.json` at the model-variant root is a discovery catalog. See
[Generated data manifests](./generated-data-manifests.md) for the catalog
format and runtime discovery. Layered and summed layer files share the
`layer-XX.json` name but live in separate format folders and carry different
row sets, described below.

## Dataset manifest

Each dataset folder contains a `manifest.json` describing the generation:

```json
{
  "schemaVersion": 1,
  "metric": "unprojected-attention-contribution-rss",
  "model": {
    "id": "Qwen3-0.6B-ONNX",
    "dtype": "int8",
    "instrumentation": "instrumented"
  },
  "title": "Finding Contact Details",
  "prompt": "Could you turn the signature in this email into a contact record?",
  "systemPrompt": "You are a helpful assistant. Keep your answers concise.",
  "assistantPrefix": "Full name:",
  "generatedText": "Full name: Maya Chen ...",
  "promptTokenCount": 104,
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
    "method": "sampling",
    "maxNewTokens": 64,
    "stopReason": "eos",
    "enableThinking": false,
    "seed": 42,
    "temperature": 0.7,
    "topK": 20,
    "topP": 0.8
  },
  "validation": {
    "logitsMaxAbsoluteError": 0,
    "contextsMaxAbsoluteError": 0.01147
  }
}
```

- `title`, `systemPrompt`, `assistantPrefix`, and `validation` are optional.
  The prompt list in `src/generation/prompts.ts` controls them, and
  `validation` is only present when the exporter ran with `--validate`.
- `layeredGeneratedContributions` is optional and only written by the summed
  exporter; it marks the dataset as shipping the per-layer generated-token
  matrices described below. Older datasets omit it, and clients render them
  without the layer range control.
- `promptTokenCount` counts the chat-template and prompt tokens; the remaining
  entries of `tokens` are the generated tokens.
- Token IDs are JSON numbers, never `bigint`.

## Layered layer files

Each `layer-XX.json` contains one triangular matrix:

```json
{
  "schemaVersion": 1,
  "layer": 27,
  "metric": "unprojected-attention-contribution-rss",
  "rows": [[12.4], [3.1, 9.8], [1.2, 4.7, 8.5]]
}
```

Row `i` contains exactly `i + 1` values for causal source tokens `0` through
`i`. No future-token placeholders are written. The browser loads the manifest
first and fetches only the selected layer file.

## Summed contributions file

`contributions.json` contains the layer sum for generated tokens only:

```json
{
  "schemaVersion": 1,
  "metric": "unprojected-attention-contribution-rss",
  "aggregation": "sum",
  "layerCount": 28,
  "targetTokenStart": 104,
  "rows": [
    [1.2, 4.7],
    [0.3, 2.9, 8.5]
  ]
}
```

`targetTokenStart` equals the manifest's `promptTokenCount`, and row `r`
belongs to the generated token at position `targetTokenStart + r`: it holds
the attention contributions of the query position that predicted that token.
Row `r` therefore has `targetTokenStart + r` source values. The row for the
token that stopped generation (EOS or the configured limit) is not produced,
because that token never needs a forward pass.

## Layered generated-token layer files

When the manifest sets `layeredGeneratedContributions: true`, the summed
dataset folder also contains `layer-XX.json` files with one matrix per layer,
restricted to generated destinations:

```json
{
  "schemaVersion": 1,
  "layer": 27,
  "metric": "unprojected-attention-contribution-rss",
  "targetTokenStart": 104,
  "rows": [
    [1.2, 4.7],
    [0.3, 2.9, 8.5]
  ]
}
```

Rows use the same indexing as the summed file: row `r` holds the
contributions of the query position that predicted the token at
`targetTokenStart + r`, with `targetTokenStart + r` source values, and the
file has exactly `tokens.length - targetTokenStart` rows. Summing these rows
across all layers reproduces `contributions.json` exactly, and the exporter
verifies that before publishing. Unlike the layered format above, these files
never store prompt-destination rows, keeping each file proportional to the
generated tokens.

## Generating datasets

Instrument the downloaded model first (see
[Model instrumentation](./instrumentation.md)), then run an exporter:

```sh
pnpm generate:contributions --model 1.7b
pnpm generate:contributions --model 1.7b --id <dataset-id>
pnpm generate:summed-contributions --model 0.6b --variant uint8 --id <dataset-id>
pnpm generate:summed-contributions --model 1.7b --id <dataset-id> --validate
pnpm generate:summed-contributions --model 1.7b --id <dataset-id> --no-stream
pnpm generate:contributions --model 1.7b --output <directory> --overwrite
```

| Flag          | Meaning                                                                              |
| ------------- | ------------------------------------------------------------------------------------ |
| `--model`     | `0.6b` or `1.7b` (defaults to the central `MODEL_CONFIGURATION`)                     |
| `--variant`   | `int8`, `uint8`, or `q4f16`                                                          |
| `--id`        | Generate a single configured dataset instead of all of them                          |
| `--output`    | Override the output root (default `generated/<format>/`)                             |
| `--overwrite` | Replace an existing dataset directory                                                |
| `--validate`  | Also load the original model and compare logits and reconstructed attention contexts |
| `--no-stream` | Do not stream the generated text to stdout                                           |

Prompt configurations in `src/generation/prompts.ts` select which formats
each dataset is exported for; an explicitly selected incompatible `--id` is
rejected. Omitting `--id` processes every compatible dataset and refreshes the
discovery catalog afterward.

## Atomic and repeatable output

For each dataset the exporter:

1. Checks all selected destinations before loading any model, and rejects an
   existing destination unless `--overwrite` is supplied.
2. Writes into a uniquely named temporary sibling directory.
3. Validates the completed manifest and all data files.
4. Replaces the destination directory only after every file succeeds, never
   leaving a mixture of old and new files.

Validation covers tensor shapes, unchanged logits, reconstructed attention
contexts (with `--validate`), finite non-negative contribution values,
complete causal triangles consistent with the manifest token count, and — for
summed datasets with per-layer matrices — an exact check that the layer
matrices sum to `contributions.json`. A failed dataset never produces a
completed output directory.

Generation is seeded and deterministic, so re-running an exporter reproduces
the same dataset.
