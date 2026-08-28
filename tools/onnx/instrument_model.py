#!/usr/bin/env python3
"""Expose every layer's post-RoPE query tensor as an ONNX graph output."""

from __future__ import annotations

import argparse
import copy
import os
import tempfile
import warnings
from pathlib import Path
from typing import Iterable, Sequence

import onnx
from onnx import ModelProto, NodeProto, ValueInfoProto


MODEL_IDS = {
    "qwen3-0.6b": "Qwen3-0.6B-ONNX",
    "qwen3-1.7b": "Qwen3-1.7B-ONNX",
}
MODEL_ALIASES = {
    "0.6b": "qwen3-0.6b",
    "1.7b": "qwen3-1.7b",
    **{key: key for key in MODEL_IDS},
}
DEFAULT_DTYPE = "int8"
REPOSITORY_ROOT = Path(__file__).resolve().parents[2]


def _node_matches(node: NodeProto, op_type: str, name_fragment: str) -> bool:
    """Match exporter nodes without depending on a particular layer count."""
    return node.op_type == op_type and (
        name_fragment in node.name
        or any(name_fragment in output for output in node.output)
    )


def _first_outputs(
    nodes: Iterable[NodeProto], op_type: str, name_fragment: str
) -> list[str]:
    return [
        node.output[0]
        for node in nodes
        if node.output and _node_matches(node, op_type, name_fragment)
    ]


def discover_outputs(
    model: ModelProto, include_validation_outputs: bool = False
) -> tuple[list[str], dict[str, NodeProto]]:
    """Find instrumentation points from graph operators and return their producers."""
    nodes = list(model.graph.node)
    query_outputs = _first_outputs(nodes, "RotaryEmbedding", "/q_rotary/")
    if not query_outputs:
        raise ValueError(
            "model contains no q_rotary RotaryEmbedding outputs to instrument"
        )

    requested_outputs = list(query_outputs)
    if include_validation_outputs:
        validation_outputs = _first_outputs(
            nodes, "GroupQueryAttention", "/attn/GroupQueryAttention"
        )
        if not validation_outputs:
            raise ValueError(
                "model contains no GroupQueryAttention outputs for validation"
            )
        requested_outputs += validation_outputs

    producers = {
        output: node
        for node in nodes
        for output in node.output
        if output in requested_outputs
    }
    return requested_outputs, producers


def _value_info_by_name(model: ModelProto) -> dict[str, ValueInfoProto]:
    graph = model.graph
    return {
        value.name: value
        for values in (graph.input, graph.output, graph.value_info)
        for value in values
    }


def output_value_info(
    name: str,
    producer: NodeProto,
    value_info: dict[str, ValueInfoProto],
) -> ValueInfoProto:
    """Get an output's actual dtype/shape, with a safe RotaryEmbedding fallback."""
    if name in value_info:
        return copy.deepcopy(value_info[name])

    # RotaryEmbedding preserves the dtype and shape of its first input. Some
    # exporters omit intermediate ValueInfo, so copy that descriptor and only
    # change its name. This handles FLOAT, FLOAT16, and other tensor types
    # without hard-coding a quantization format.
    if producer.op_type == "RotaryEmbedding" and producer.input:
        source = value_info.get(producer.input[0])
        if source is not None:
            inferred = copy.deepcopy(source)
            inferred.name = name
            return inferred

    raise ValueError(
        f"tensor {name!r} has no type/shape metadata; cannot add a correctly "
        "typed graph output"
    )


def output_path_for(source: Path) -> Path:
    if source.stem.startswith("model_"):
        dtype = source.stem.removeprefix("model_")
        return source.with_name(f"instrumented_{dtype}.onnx")
    return source.with_name(f"{source.stem}-instrumented.onnx")


def instrument(
    source: Path,
    include_validation_outputs: bool = False,
    destination: Path | None = None,
) -> Path:
    if not source.is_file():
        raise FileNotFoundError(f"model does not exist: {source}")
    if source.suffix.lower() != ".onnx":
        raise ValueError(f"expected an .onnx model: {source}")

    destination = output_path_for(source) if destination is None else destination
    if destination.suffix.lower() != ".onnx":
        raise ValueError(f"expected an .onnx output path: {destination}")
    if source.resolve() == destination.resolve():
        raise ValueError("output path must not overwrite the source model")

    # Work on the original protobuf so operators, weights, and connections stay
    # untouched. No third-party graph transformation library is needed.
    proto = onnx.load_model(str(source), load_external_data=False)
    requested_outputs, producers = discover_outputs(
        proto, include_validation_outputs=include_validation_outputs
    )
    value_info = _value_info_by_name(proto)
    existing_outputs = {value.name for value in proto.graph.output}
    for name in requested_outputs:
        if name in existing_outputs:
            continue
        proto.graph.output.append(output_value_info(name, producers[name], value_info))
        existing_outputs.add(name)

    destination.parent.mkdir(parents=True, exist_ok=True)
    fd, temporary_name = tempfile.mkstemp(
        prefix=f".{destination.name}.", suffix=".tmp", dir=destination.parent
    )
    os.close(fd)
    temporary = Path(temporary_name)

    try:
        onnx.save_model(proto, str(temporary))
        try:
            onnx.checker.check_model(str(temporary))
        except onnx.checker.ValidationError as error:
            warnings.warn(
                f"ONNX validation failed; writing the instrumented model anyway: {error}",
                RuntimeWarning,
            )
        os.replace(temporary, destination)
    finally:
        temporary.unlink(missing_ok=True)

    return destination


def model_source(model: str) -> Path:
    key = MODEL_ALIASES.get(model.lower())
    if key is None:
        available = ", ".join(MODEL_IDS)
        raise ValueError(f"unknown model {model!r}; available models: {available}")
    return (
        REPOSITORY_ROOT
        / "models"
        / MODEL_IDS[key]
        / "onnx"
        / f"model_{DEFAULT_DTYPE}.onnx"
    )


def parse_args(arguments: Sequence[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "source",
        nargs="?",
        type=Path,
        help="explicit path to a source .onnx model",
    )
    parser.add_argument(
        "--model",
        help="configured model key or short alias (for example, qwen3-1.7b or 1.7b)",
    )
    parser.add_argument(
        "-o",
        "--output",
        type=Path,
        help=(
            "output path (default: instrumented_<dtype>.onnx beside a "
            "model_<dtype>.onnx source)"
        ),
    )
    parser.add_argument(
        "--validation-outputs",
        action=argparse.BooleanOptionalAction,
        default=False,
        help=(
            "also expose each layer's GroupQueryAttention output "
            "(default: disabled)"
        ),
    )
    args = parser.parse_args(arguments)
    if (args.source is None) == (args.model is None):
        parser.error("provide exactly one of an explicit source path or --model")
    return args


def main() -> None:
    args = parse_args()
    source = (
        args.source.expanduser().resolve()
        if args.source is not None
        else model_source(args.model)
    )
    destination = instrument(
        source,
        include_validation_outputs=args.validation_outputs,
        destination=args.output.expanduser().resolve() if args.output else None,
    )
    print(destination)


if __name__ == "__main__":
    main()
