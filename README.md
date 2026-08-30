# LLM Visualizer

A Vite/React application for exploring token contributions from instrumented
ONNX language models. Generation runs locally in a browser worker; pre-generated
visualizations are loaded as static JSON from a separately deployable origin.

## Development

```sh
pnpm install
pnpm dev
```

During development, the browser model continues to load from `/models/`.
Pre-generated data defaults to `/generated/`.

## Static production build

Production builds require a public Hugging Face model repository:

```sh
VITE_HF_MODEL_REPO=organization/instrumented-qwen3 \
VITE_HF_MODEL_REVISION=<commit-sha> \
  pnpm build
```

The repository ID and revision are compiled into the client bundle. The browser
downloads the files directly from Hugging Face on first use and then uses the
Transformers.js browser cache. No model files are copied into `dist/`.

`VITE_HF_MODEL_REVISION` defaults to `main`, but a commit SHA is strongly
recommended so a deployment and its browser cache always refer to immutable
artifacts. The repository must be public; these variables are not secrets and
the static app does not support a Hugging Face access token.

The repository root must contain the Transformers.js configuration and
tokenizer files, plus the instrumented weights at:

```text
onnx/instrumented_int8.onnx
```

The pre-generated data origin can also be changed at static build time:

```sh
VITE_GENERATED_DATA_BASE_URL=https://data.example.com/releases/v1/ \
  pnpm build
```

`VITE_GENERATED_DATA_BASE_URL` is likewise public configuration. It may be
absolute or relative to the page.

The production static host must send these headers on the app documents and
assets, as the Vite development and preview servers already do:

```text
Cross-Origin-Embedder-Policy: require-corp
Cross-Origin-Opener-Policy: same-origin
```

For the web-component build, omitting `model-base-url` uses the build-time
Hugging Face repository. Setting the attribute retains the custom static-host
layout `<model-base-url>/Qwen3-0.6B-ONNX/...`.

## Generated-data discovery manifest

Generated artifacts use this layout:

```text
generated/
  contributions/<model-key>/<model-variant>/<dataset-id>/manifest.json
  contributions/<model-key>/<model-variant>/<dataset-id>/layer-00.json
  summed-contributions/<model-key>/<model-variant>/<dataset-id>/manifest.json
  summed-contributions/<model-key>/<model-variant>/<dataset-id>/contributions.json
```

Compile `generated/manifest.json` after generating or changing datasets:

```sh
pnpm generate:data-manifest
```

The compiler validates every dataset manifest, checks that all expected data
files exist, and writes a stable catalog containing metadata and relative
artifact paths. The app fetches this file at runtime instead of using Vite glob
imports, then lazily fetches the selected contribution files.

Deploy the entire contents of `generated/` at the configured data base URL. If
that URL has a different origin from the app, its responses must include:

```text
Access-Control-Allow-Origin: https://app.example.com
Cross-Origin-Resource-Policy: cross-origin
```

Use `Access-Control-Allow-Origin: *` instead when the artifacts are intended to
be publicly reusable. The CORP header is required because the app enables
cross-origin isolation for browser model execution.

## Verification

```sh
pnpm test
pnpm lint
pnpm build
```
