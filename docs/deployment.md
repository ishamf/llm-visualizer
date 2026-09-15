# Deployment

LLM Visualizer is deployed as static files. The application bundle, browser
model, and pre-generated contribution data can be hosted separately, provided
their URLs and response headers are configured correctly.

## Combined deployment build

Production builds default to the local `/models/` static host. For deployments,
set `VITE_HF_MODEL_REPO` so the bundle downloads the model from a public
Hugging Face repository instead:

```sh
VITE_HF_MODEL_REPO=organization/instrumented-qwen3 \
VITE_HF_MODEL_REVISION=<commit-sha> \
  pnpm build
```

Omitting `VITE_HF_MODEL_REPO` is fine for trying out the build; it emits a
warning and compiles the local model host into the bundle.

The Cloudflare Pages-ready output is written to `dist/`. It contains both the
static application and the distributable web component:

```text
dist/
├── index.html
├── assets/
└── web-component/
    ├── contribution-text.js
    ├── coding-agent.js
    ├── workers/
    └── static/
```

Use `pnpm build` as the Cloudflare Pages build command and `dist` as its build
output directory.

To build only the static application, use the same configuration with:

```sh
VITE_HF_MODEL_REPO=organization/instrumented-qwen3 \
VITE_HF_MODEL_REVISION=<commit-sha> \
  pnpm build:site
```

As with `pnpm build`, omitting the model configuration is allowed for local
experiments and falls back to `/models/`.

The site-only output is also written to `dist/`.

The repository ID and revision are compiled into the client bundle. They are
public configuration rather than secrets, and the static application does not
support a Hugging Face access token.

`VITE_HF_MODEL_REVISION` defaults to `main`. A commit SHA is strongly
recommended so the deployment and Transformers.js browser cache always refer to
immutable model artifacts.

## Browser model hosting

When `VITE_HF_MODEL_REPO` is set, the Hugging Face repository must be public. Its root must contain the
Transformers.js configuration and tokenizer files, with the instrumented weights
at:

```text
onnx/instrumented_int8.onnx
```

The browser downloads these files directly from Hugging Face on first use and
then uses the Transformers.js browser cache. Model files are not copied into
`dist/`.

## Generated-data hosting

Pre-generated data defaults to `/generated/`. Set a different origin or base
path at build time with:

```sh
VITE_HF_MODEL_REPO=organization/instrumented-qwen3 \
VITE_HF_MODEL_REVISION=<commit-sha> \
VITE_GENERATED_DATA_BASE_URL=https://data.example.com/releases/v1/ \
  pnpm build
```

`VITE_GENERATED_DATA_BASE_URL` is public configuration and may be absolute or
relative to the application page.

A contribution format, model, and variant folder is a self-contained deployment
unit. For example:

```text
summed-contributions/qwen3-0.6b/int8/
```

When serving that folder beneath the configured generated-data root, preserve
its relative path so the application can discover:

```text
summed-contributions/qwen3-0.6b/int8/manifest.json
```

The layered or summed format may be omitted when it is not needed. See
[Generated data manifests](./generated-data-manifests.md) for the complete
layout and discovery behavior.

## Cross-origin isolation

Browser model execution requires the application documents and assets to use
cross-origin isolation:

```text
Cross-Origin-Embedder-Policy: require-corp
Cross-Origin-Opener-Policy: same-origin
```

The Vite development and preview servers already provide these headers.
Cloudflare Pages is configured through `public/_headers`; Vite copies that file
to the root of `dist/`. Other static hosts need equivalent configuration.

## Cross-origin generated data

When generated data is hosted on a different origin, its responses must include:

```text
Access-Control-Allow-Origin: https://app.example.com
Cross-Origin-Resource-Policy: cross-origin
```

Use `Access-Control-Allow-Origin: *` when the artifacts are intended to be
publicly reusable. `Cross-Origin-Resource-Policy: cross-origin` is required
because the application enables cross-origin isolation.

## Standalone web-component build

Build the distributable web component with the same optional Hugging Face model
configuration:

```sh
VITE_HF_MODEL_REPO=organization/instrumented-qwen3 \
VITE_HF_MODEL_REVISION=<commit-sha> \
  pnpm build:web-component
```

The standalone output is written to `dist-web-component/`. The combined
`pnpm build` command writes the same distribution beneath
`dist/web-component/` so it is deployed together with the application. The
entries share runtime chunks beneath `static/`, so the folder is deployed as
a unit; every entry resolves its chunks and workers relative to its own URL,
which keeps the distribution valid under an arbitrary URL prefix.

The distribution defines three elements:

- `xif-contribution-text` (`contribution-text.js`) — the contribution-text
  experience with in-browser generation. See
  [Contribution text](./contribution-text.md).
- `xif-coding-agent` (`coding-agent.js`) — the coding agent replay. It loads
  only the session JSONs and needs neither the model nor a worker, so it
  works without cross-origin isolation. Its `generated-data-base-url`,
  `session`, and `color-scheme` attributes behave like the contribution
  element's, with `session` selecting the replayed session (the analog of the
  page's `?session=` parameter).
- `xif-request-cost` (`request-cost.js`) — the coding agent page's
  cost-per-request chart for one session. Like `xif-coding-agent` it loads
  only session JSONs; `session` (default `coding-agent`),
  `generated-data-base-url`, and `color-scheme` behave like the coding agent
  element's.

When the contribution element omits its `model-base-url` attribute, it uses the Hugging
Face repository configured at build time. Setting `model-base-url` instead uses
the custom static-host layout:

```text
<model-base-url>/Qwen3-0.6B-ONNX/...
```

The component's `generated-data-base-url` attribute can override the generated
data location at runtime.
