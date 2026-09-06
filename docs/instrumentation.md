# Model instrumentation

The visualizations need internal attention tensors that the stock ONNX model
does not return: the post-RoPE query, key, and value tensors of every
transformer layer, plus the fused attention context for validation. The
instrumentation tool promotes these existing tensors to graph outputs without
changing weights, operators, or existing tensor connections.

The tool is `tools/onnx/instrument_model.py`, built on the official ONNX
Python library. It discovers the layer count from the graph and copies each
tensor's actual type and shape, so the same command supports the `int8`,
`uint8`, and `q4f16` model artifacts.

## Setup

Create the project-local Python environment once:

```sh
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements-instrumentation.txt
```

## Instrumenting a model

```sh
pnpm instrument:model --model 1.7b
pnpm instrument:model --model 1.7b --validation-outputs
pnpm instrument:model models/Qwen3-0.6B-ONNX/onnx/model_uint8.onnx
```

Provide exactly one of `--model` (a configured key such as `qwen3-1.7b` or the
short alias `1.7b`) or an explicit source path. For a source named
`model_<dtype>.onnx`, the destination is `instrumented_<dtype>.onnx` in the
same directory, which is the filename the exporters and the browser load. Pass
`--output <path>` to choose another destination.

`--validation-outputs` additionally promotes each layer's `GroupQueryAttention`
context output. These tensors are only needed by
`pnpm validate:instrumentation` and can be omitted otherwise.

## Verification

```sh
pnpm instrument:test
pnpm validate:instrumentation "Say hello."
```

`pnpm instrument:test` runs the instrumenter's unit tests.
`pnpm validate:instrumentation` loads the original and instrumented models and
checks that the added outputs do not change logits, that all promoted tensors
have the expected shapes, and that attention reconstructed from the promoted
Q, K, and V tensors matches the fused context.

The instrumented artifacts are local generated files and are not committed.
For background on why the artifact-modification approach was chosen over
patching Transformers.js or ONNX Runtime, see
[the instrumentation strategy notes](./plans/instrumentation-strategy.md).
