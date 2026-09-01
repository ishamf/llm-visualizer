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

## Deployment

See the [deployment guide](docs/deployment.md) for production builds, model and
generated-data hosting, required response headers, and the web-component build.

## Generated data

Refresh the discovery manifests after generating or changing datasets:

```sh
pnpm generate:data-manifest
```

See [Generated data manifests](docs/generated-data-manifests.md) for the data
layout, catalog generation, ordering rules, validation, and runtime discovery.

## Verification

```sh
pnpm test
pnpm lint
```
