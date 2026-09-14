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

### 2. Start the dev server

```sh
pnpm dev
```

Open <http://localhost:5173>.

### 3. Set up a visualization

Each visualization loads its own data and needs additional setup:

- To set up **contribution text**, also follow
  [its setup guide](docs/contribution-text.md#setup): it needs the
  instrumented model, and the pre-generated examples need locally generated
  data.
- To set up **coding agent replay**, follow
  [its setup guide](docs/coding-agent.md#setup): it needs a recorded session.

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
