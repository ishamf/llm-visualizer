# Contribution text

The **contribution text** visualization renders the prompt and the generated
response as plain text, and each token's opacity shows how strongly every
earlier token contributed to it. Hovering a generated token highlights its
strongest sources. It lives at `/attention`, is embedded on the homepage,
and is also published as the `xif-contribution-text` web component.

You can explore a pre-generated example, or type a prompt and generate a new
response: the model runs locally in a web worker, so the prompt never leaves
the browser. The file formats of the pre-generated examples are described in
[Contribution datasets](contribution-datasets.md).

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
[the extended instrumentation plan](plans/extended-instrumentation-plan.md).
