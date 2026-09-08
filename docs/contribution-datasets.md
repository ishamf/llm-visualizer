# Contribution datasets

Pre-generated contribution datasets are produced offline from the instrumented
model and served as static JSON. The browser never runs the model to display
pre-generated examples. The metric that produced these values is described in
the [README](../README.md#how-contribution-is-measured).

Every dataset identifies its metric as
`unprojected-attention-contribution-rss` and uses schema version 1, so a
future metric cannot be mistaken for this one.

## Formats

There are two formats, each written by its own exporter:

- **Layered** (`pnpm generate:contributions`) stores one triangular
  contribution matrix per transformer layer. It backs the experimental
  contribution-grid visualization and lets the contribution-text
  visualization re-sum any range of layers. Because each matrix covers every
  destination token, most of its rows are unused by the text view, which only
  explains generated tokens.
- **Summed** (`pnpm generate:summed-contributions`) stores the sum of all
  layer matrices, which is what the contribution-text visualization shows. It
  retains only the rows for generated tokens, so it stores approximately
  `G × P + G² / 2` values instead of `layers × (P + G)² / 2` for `P` prompt
  tokens and `G` generated tokens.

The contribution-text visualization renders the summed file first and only
downloads layered files when a layer range other than "all layers" is
selected with its layer control. Layer downloads are cached per session, so
adjusting the range reuses the matrices that are already in memory.

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
```

The `manifest.json` at the model-variant root is a discovery catalog. See
[Generated data manifests](./generated-data-manifests.md) for the catalog
format and runtime discovery.

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
contexts (with `--validate`), finite non-negative contribution values, and
complete causal triangles consistent with the manifest token count. A failed
dataset never produces a completed output directory.

Generation is seeded and deterministic, so re-running an exporter reproduces
the same dataset.
