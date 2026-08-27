# ONNX instrumentation strategy

The visualization described in the
[instrumentation plan](./instrumentation-plan.md) requires post-RoPE query
tensors that the current ONNX model computes but does not return. This document
tracks the options for exposing those tensors.

## Shared transformation

Both options require the same logical ONNX transformation: promote the
post-RoPE query tensor from each of the 28 transformer layers to a graph output.
This requires 28 additional outputs, not 448, because each layer tensor contains
all 16 query heads.

Promote the existing tensor names directly:

```text
/model/layers.0/attn/q_rotary/RotaryEmbedding/output_0
/model/layers.1/attn/q_rotary/RotaryEmbedding/output_0
...
/model/layers.27/attn/q_rotary/RotaryEmbedding/output_0
```

Keep a manifest that maps the upstream tensor names to layer indices. Giving
them new names would require adding alias operators. The initial transformation
should only add graph outputs and must not alter weights, operators, or existing
tensor connections.

During development, optionally promote each layer's
`GroupQueryAttention/output_0` as another 28 outputs. These context tensors let
us validate that attention reconstructed from Q, K, and V matches the fused
operator. They can be omitted after validation.

## Instrumentation tool

The repository contains `tools/onnx/instrument_model.py`, which performs this
transformation using only the official ONNX Python library. It discovers the
layer count from the graph and copies each tensor's actual type and shape, so
the same command supports FP16, Q4, Q4F16, and INT8 model artifacts.

Create the project-local Python environment once:

```sh
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements-instrumentation.txt
```

Instrument a model with:

```sh
pnpm instrument:model -- models/Qwen3-0.6B-ONNX/onnx/model_q4f16.onnx
```

For a source named `model_<dtype>.onnx`, the default destination is
`instrumented_<dtype>.onnx` in the same directory, matching the filename used
by the visualizer. Pass `--output <path>` to choose another destination. Add
`--validation-outputs` when the fused GroupQueryAttention context outputs are
needed by `pnpm validate:instrumentation`.

Run the instrumenter unit tests with:

```sh
pnpm instrument:test
```

The `.venv` directory and model artifacts are local, generated files and are
not committed.

## Option 1: modify and store the artifact

Create a persistent instrumented copy of the official ONNX model:

```text
Official model_q4f16.onnx
          │
          │ one-time transformation
          ▼
Generated instrumented_q4f16.onnx
```

The official artifact remains immutable. Store the generated model in a
gitignored cache directory and load it for inference.

The transformation process should:

1. Locate or download the official model.
2. Verify its revision or checksum.
3. Parse the ONNX protobuf.
4. Add the required query tensors to `graph.output`.
5. Optionally add the attention-context validation outputs.
6. Validate the result with an ONNX checker.
7. Write the instrumented artifact atomically.
8. Record a manifest containing the source revision, source checksum,
   instrumentation version, and layer-to-output mapping.

Cache the result by source checksum and instrumentation version so the 570 MB
model is parsed and rewritten only once. Fail clearly if expected tensor names
are missing or the model geometry has changed.

### Advantages

- Simple and explicit runtime behavior
- Transformation cost paid only once
- Easy to inspect and validate independently
- Does not depend on patched inference-library internals
- Original Hugging Face artifact remains unchanged

### Disadvantages

- Stores another large model file
- Requires artifact lifecycle and cache invalidation logic
- Inference must target the generated file instead of the original file

## Option 2: patch Transformers.js

Use `pnpm patch` to add supported application-level hooks to the installed
Transformers.js package while continuing to reference the regular Hugging Face
model and dtype.

The patch would add two options.

### Model transformation hook

Add a callback invoked after loading model bytes and before creating the ONNX
Runtime session:

```ts
type ModelTransform = (
  model: Uint8Array,
  context: {
    modelId: string;
    fileName: string;
    dtype: string;
    device: string;
  },
) => Uint8Array | Promise<Uint8Array>;
```

The callback performs the shared ONNX transformation in memory. In Node.js,
the patched loader must request model bytes rather than passing a filesystem
path to ONNX Runtime whenever this callback is present.

The transformed bytes should be cached by model revision, source checksum, and
instrumentation version. Otherwise the large protobuf would be parsed and
rewritten on every model load.

### Generation-step callback

Add a callback immediately after each model forward pass and before temporary
output tensors are disposed:

```ts
type GenerationStepCallback = (
  outputs: Record<string, Tensor>,
  context: {
    step: number;
    inputIds: bigint[][];
  },
) => void | Promise<void>;
```

This exposes logits, K/V cache outputs, and the newly promoted query outputs
during prompt prefill and incremental decoding. The callback must copy, reduce,
or otherwise retain any data it needs before the generation loop disposes the
temporary tensors.

Because the package ships prebuilt bundles, the patch must cover the ESM Node
bundle used by scripts, the web bundle used by the application, and the public
TypeScript declarations. Editing only the package's `src` directory is not
sufficient.

### Advantages

- Continues using the normal Hugging Face model ID and artifact selection
- Preserves existing model loading and generation APIs
- Query data can be delivered during the existing generation loop
- The on-disk source model remains unchanged

### Disadvantages

- Still performs an ONNX graph transformation, although in memory
- Requires maintaining a dependency patch across Transformers.js upgrades
- Needs careful caching to avoid repeated transformation cost
- Temporarily requires enough memory for the original and transformed model
  representations
- The patch touches prebuilt package bundles, which are less maintainable than
  source-level changes

## Option 3: patch ONNX Runtime

Patch ONNX Runtime so a session option can promote existing internal graph
values to graph outputs while the model is being loaded. The original ONNX file
and its serialized bytes remain unchanged.

For example, add a runtime option such as:

```ts
type InstrumentedSessionOptions = InferenceSession.SessionOptions & {
  extraOutputNames?: readonly string[];
};
```

Transformers.js already accepts `session_options` when loading a model and
passes them to `InferenceSession.create`. The application could therefore load
the regular artifact with:

```ts
const generator = await pipeline('text-generation', modelId, {
  dtype: 'q4f16',
  session_options: {
    extraOutputNames: queryOutputNames,
  },
});
```

The ONNX Runtime patch should apply the option after the original model has
been deserialized but before graph resolution and optimization. For every
requested name, it should:

1. Find the existing graph value (`NodeArg`).
2. Fail clearly if the value does not exist or cannot be returned.
3. Append that value to the graph outputs without changing its name, type,
   shape, producer, or consumers.
4. Preserve the model's existing outputs and reject duplicate requests.

After that small graph mutation, normal graph resolution, optimization, and
session initialization continue. The promoted values then appear in the
session's output metadata and are returned by normal inference calls.

ONNX Runtime also provides a Model Editor C API in recent releases. It can
augment an existing model before finalizing an inference session and may allow
the feature to be implemented mostly in the JavaScript bindings rather than in
the core graph loader. The JavaScript packages do not currently expose that
API, and promoting internal values may still be simpler as a small core change.
Both implementation paths should be evaluated in the initial Node prototype.

### Integration scope

The installed Transformers.js version passes session options through and does
not select a restricted list of outputs when it calls the runtime, so it should
not require a model-loading patch for this option. Its public TypeScript types
may need a small extension or local augmentation for the new runtime option.

The generation-step callback described in Option 2 is still required if the
application uses the built-in `generate` loop. The additional output tensors
are present in each forward result, but that result is internal to the loop.
The callback must process, copy, or reduce the query tensors before their
lifetime ends. As an alternative, the application could own the generation
loop and call the model's forward method directly.

For WebGPU, the integration must also decide whether query outputs remain in
GPU buffers or are copied to the CPU. GPU-resident outputs require appropriate
`preferredOutputLocation` handling and explicit per-step disposal after the
instrumentation calculation.

### Memory behavior

This avoids holding an original serialized model, a JavaScript protobuf object
tree, and a second serialized model at the same time. In Node.js, ONNX Runtime
can continue loading the original model by filesystem path. ONNX Runtime still
incurs its normal model-loading memory, but the load-time graph mutation itself
only adds output metadata.

The promoted tensors have their own runtime cost. The 28 float16 query outputs
contain approximately:

```text
28 layers × sequence length × 16 heads × 128 values × 2 bytes
= 112 KiB per token
```

That is about 112 MiB for a 1,024-token prefill and about 112 KiB for each
single-token decoding step, excluding tensor metadata, alignment, and any
device-to-host copy. Consumers should process each step promptly rather than
retain every raw query tensor.

### Distribution and maintenance

The Node.js binding ships ONNX Runtime as a compiled native addon, and the web
binding ships compiled WebAssembly assets. A source-level package-manager patch
is therefore not sufficient for the runtime change. The project must build and
distribute patched runtime packages for each supported Node platform and a
patched ONNX Runtime Web build. Transformers.js can be directed to those builds
with package-manager overrides or compatible replacement packages.

A sensible rollout is:

1. Implement and validate the option in the Node CPU runtime.
2. Confirm output metadata, tensor shapes, unchanged logits, and reconstructed
   attention values.
3. Add the generation-step callback and explicit tensor lifetime handling.
4. Port the runtime option to ONNX Runtime Web and validate WebAssembly and
   WebGPU execution separately.

### Advantages

- Does not rewrite or duplicate the serialized ONNX artifact
- Avoids the peak memory cost of parsing and reserializing the model in
  JavaScript
- Continues using the normal model ID, dtype selection, and source artifact
- Reuses ONNX Runtime's parsed graph and existing tensor type information
- Makes extra internal outputs a reusable runtime capability rather than a
  model-specific byte transformation

### Disadvantages

- Requires maintaining custom native and WebAssembly runtime builds
- Must be ported and tested separately for Node and browser runtimes
- Still requires a generation callback or application-owned generation loop
- Additional graph outputs consume memory and may cause device-to-host copies
- Promoting internal values can inhibit buffer reuse or graph optimizations and
  must be benchmarked
- Depends on ONNX Runtime internals or a JavaScript exposure of the Model Editor
  API

## Decision status

No option has been selected yet. Option 1 has the fewest runtime integration
risks. Option 2 preserves the existing runtime dependency but transforms the
model in application memory. Option 3 has the lowest transformation-memory and
artifact-storage cost, but requires distributing custom ONNX Runtime builds.
The output manifest and numerical validation work are shared, so they can be
developed before making the final integration decision.
