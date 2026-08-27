import unittest
from pathlib import Path

from onnx import TensorProto, helper

from tools.onnx.instrument_model import (
    _value_info_by_name,
    discover_outputs,
    output_path_for,
    output_value_info,
)


def make_model(output_type: int, include_output_metadata: bool = True):
    input_name = "/model/layers.0/attn/q_norm/output_0"
    output_name = "/model/layers.0/attn/q_rotary/RotaryEmbedding/output_0"
    node = helper.make_node(
        "RotaryEmbedding",
        [input_name, "position_ids", "cos_cache", "sin_cache"],
        [output_name],
        name="/model/layers.0/attn/q_rotary/RotaryEmbedding",
        domain="com.microsoft",
    )
    value_info = []
    if include_output_metadata:
        value_info.append(
            helper.make_tensor_value_info(output_name, output_type, ["batch", "seq", 8])
        )
    graph = helper.make_graph(
        [node],
        "test",
        [helper.make_tensor_value_info(input_name, output_type, ["batch", "seq", 8])],
        [],
        value_info=value_info,
    )
    return helper.make_model(graph), output_name


class InstrumentModelTests(unittest.TestCase):
    def test_uses_exported_tensor_type(self):
        for tensor_type in (TensorProto.FLOAT, TensorProto.FLOAT16, TensorProto.INT8):
            with self.subTest(tensor_type=tensor_type):
                model, expected_name = make_model(tensor_type)
                names, producers = discover_outputs(model)
                promoted = output_value_info(
                    names[0], producers[names[0]], _value_info_by_name(model)
                )

                self.assertEqual(names, [expected_name])
                self.assertEqual(promoted.type.tensor_type.elem_type, tensor_type)

    def test_rotary_output_falls_back_to_input_metadata(self):
        model, expected_name = make_model(
            TensorProto.FLOAT16, include_output_metadata=False
        )
        names, producers = discover_outputs(model)
        promoted = output_value_info(
            names[0], producers[names[0]], _value_info_by_name(model)
        )

        self.assertEqual(promoted.name, expected_name)
        self.assertEqual(promoted.type.tensor_type.elem_type, TensorProto.FLOAT16)
        self.assertEqual(len(promoted.type.tensor_type.shape.dim), 3)

    def test_discovers_layer_count_from_nodes(self):
        first, _ = make_model(TensorProto.FLOAT)
        second, _ = make_model(TensorProto.FLOAT16)
        second_node = second.graph.node[0]
        second_node.name = second_node.name.replace("layers.0", "layers.7")
        second_node.output[0] = second_node.output[0].replace("layers.0", "layers.7")
        first.graph.node.append(second_node)

        names, _ = discover_outputs(first)

        self.assertEqual(len(names), 2)
        self.assertIn("/model/layers.7/", names[1])

    def test_visualizer_output_name(self):
        self.assertEqual(
            output_path_for(Path("models/example/onnx/model_int8.onnx")),
            Path("models/example/onnx/instrumented_int8.onnx"),
        )


if __name__ == "__main__":
    unittest.main()
