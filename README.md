# LLM Visualizer

A Vite/React application for exploring token contributions from instrumented
ONNX language models. Generation runs locally in a browser worker; pre-generated
visualizations are loaded as static JSON from a separately deployable origin.

## Development

```sh
pnpm install
pnpm dev
```

The browser model defaults to `/models/`. Pre-generated data defaults to
`/generated/`. The data origin can be changed at static build time:

```sh
VITE_GENERATED_DATA_BASE_URL=https://data.example.com/releases/v1/ \
  pnpm build
```

`VITE_GENERATED_DATA_BASE_URL` is compiled into the client bundle and therefore
must be a public URL, not a secret. It may be absolute or relative to the page.

## Generated-data discovery manifest

Generated artifacts use this layout:

```text
generated/
  contributions/<model-key>/<dataset-id>/manifest.json
  contributions/<model-key>/<dataset-id>/layer-00.json
  summed-contributions/<model-key>/<dataset-id>/manifest.json
  summed-contributions/<model-key>/<dataset-id>/contributions.json
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
