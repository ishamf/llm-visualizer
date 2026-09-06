# LLM Visualizer

A Vite/React application for exploring how transformer language models read
information from their context. Pre-generated visualizations load as static
JSON from a separately deployable origin, and new responses can be generated
privately in the browser with an instrumented ONNX model.

## Contribution text

The main visualization is **contribution text**. The prompt and the generated
response are rendered as plain text, and each token's opacity shows how
strongly every earlier token contributed to it. Hovering a generated token
highlights its strongest sources.

You can explore a pre-generated example, or type a prompt and generate a new
response: the model runs locally in a web worker, so the prompt never leaves
the browser.

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
[the extended instrumentation plan](docs/plans/extended-instrumentation-plan.md).

## Experimental visualizations

The app also ships smaller experiments, reachable from the dev-only picker at
`/dev/visualizations`:

- **Attention contributions** (contribution grid): which earlier token value
  vectors contribute to each destination token, per transformer layer, using
  layered datasets. Its design is described in
  [the instrumentation plan](docs/plans/instrumentation-plan.md).

## Development

```sh
pnpm install
pnpm dev
```

During development, the browser model continues to load from `/models/`.
Pre-generated data defaults to `/generated/`.

## Regenerating datasets

The data pipeline has three steps:

1. Instrument a downloaded ONNX model — see
   [Model instrumentation](docs/instrumentation.md).
2. Export datasets from the instrumented model — see
   [Contribution datasets](docs/contribution-datasets.md).
3. Refresh the discovery catalogs with:

```sh
pnpm generate:data-manifest
```

## Verification

```sh
pnpm test
pnpm lint
```

## Documentation

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
