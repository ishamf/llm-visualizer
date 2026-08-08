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

## Option 1: modify and store the artifact

Create a persistent instrumented copy of the official ONNX model:

```text
Official model_q4f16.onnx
          │
          │ one-time transformation
          ▼
Generated model_q4f16.instrumented.onnx
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

## Decision status

No option has been selected yet. Option 1 has fewer runtime integration risks;
option 2 provides a more seamless loading and generation API. The ONNX
transformation and numerical validation work are shared, so they can be
developed before making the final integration decision.
