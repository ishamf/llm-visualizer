/**
 * Readable JSON formatting for the request pane's input/output views.
 *
 * Behaves like `JSON.stringify(value, null, 2)` except that free-form text
 * is rendered as Python-style triple-quoted blocks with real newlines,
 * which keeps prompts and tool output readable: any string containing a
 * newline becomes a block, and known text fields do too even without
 * newlines — tool descriptions, `text` parts, and `thinking` parts, plus
 * `description` fields in a tool's `parameters` JSON schema when they run
 * over 100 characters. Block
 * content is rendered flush-left — the pane is narrow, and the JSON
 * indentation would only grow with depth — and dedented when every
 * non-blank line shares common leading indentation. The output is
 * display-only and not valid JSON by design.
 *
 * Text blocks are delimited by sentinel characters so the UI can split the
 * rendered string and tint the blocks separately.
 */

/** Marks the start of a text block in rendered output. */
const BLOCK_START = '\u0002';
/** Marks the end of a text block in rendered output. */
const BLOCK_END = '\u0003';

const INDENT = '  ';

/**
 * A chunk of rendered output: plain rendered JSON text, or a text block
 * (the `'''` fences and its content) for separate styling.
 */
export type PrettyJsonPart = { text: string } | { block: string };

/** Multi-line strings become triple-quoted blocks; single-line stay JSON. */
function isTextBlock(text: string): boolean {
  return text.includes('\n');
}

/**
 * Fields whose string values are always shown as text blocks, even without
 * newlines: a tool definition forces its `description`, and `text`/`thinking`
 * content parts force their payload.
 */
function forcedFieldKey(record: Record<string, unknown>): string | undefined {
  if (record.type === 'text') return 'text';
  if (record.type === 'thinking') return 'thinking';
  return undefined;
}

/** Schema `description` values longer than this render as text blocks. */
const SCHEMA_DESCRIPTION_MIN = 100;

/**
 * The leading whitespace shared by every non-blank line, or `''` when the
 * lines have no common indentation. Blank lines don't constrain the
 * prefix, and tabs vs spaces count as different indentation.
 */
function commonIndent(lines: string[]): string {
  let prefix: string | undefined;
  for (const line of lines) {
    if (line.trim() === '') continue;
    const leading = /^[ \t]*/.exec(line)?.[0] ?? '';
    prefix =
      prefix === undefined
        ? leading
        : prefix.slice(0, sharedLength(prefix, leading));
    if (prefix === '') return '';
  }
  return prefix ?? '';
}

/** Length of the longest common character prefix of two strings. */
function sharedLength(a: string, b: string): number {
  const max = Math.min(a.length, b.length);
  let i = 0;
  while (i < max && a[i] === b[i]) i++;
  return i;
}

/** The triple-quoted rendering of a string, dedented. */
function textBlock(text: string): string {
  const lines = text
    .replaceAll('\r\n', '\n')
    .replaceAll(BLOCK_START, '')
    .replaceAll(BLOCK_END, '')
    .split('\n');
  const indent = commonIndent(lines);
  const body = lines
    .map((line) =>
      line.trim() === '' || indent === '' ? line : line.slice(indent.length),
    )
    .join('\n');
  // A newline right after the opening fence keeps the block clean, and the
  // fences sit flush with the content so the block claims the full pane
  // width regardless of how deeply the JSON is nested.
  return `${BLOCK_START}'''\n${body}\n'''${BLOCK_END}`;
}

function formatValue(
  value: unknown,
  indent: string,
  forceBlock = false,
  longBlock = false,
): string {
  if (typeof value === 'string') {
    // Forced blocks skip only the empty string, which reads better as `""`.
    return (forceBlock && value !== '') || isTextBlock(value)
      ? textBlock(value)
      : JSON.stringify(value);
  }
  if (
    value === null ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    if (value.length === 0) return '[]';
    const inner = indent + INDENT;
    const items = value.map(
      (item) => inner + formatValue(item, inner, forceBlock, longBlock),
    );
    return `[\n${items.join(',\n')}\n${indent}]`;
  }
  if (typeof value === 'object') {
    // `undefined` values are omitted, as `JSON.stringify` does.
    const inner = indent + INDENT;
    const record = value as Record<string, unknown>;
    const forcedKey = forcedFieldKey(record);
    const fields = Object.entries(record)
      .filter(([, item]) => item !== undefined)
      .map(([key, item]) => {
        // A `tools` array forces the tool definitions below it: their
        // `description` fields always become blocks, and their `parameters`
        // schema gets long-description forcing. `text`/`thinking` parts
        // force their payload.
        const force =
          key === 'tools' ||
          (forceBlock && key === 'description') ||
          (longBlock &&
            key === 'description' &&
            typeof item === 'string' &&
            item.length > SCHEMA_DESCRIPTION_MIN) ||
          key === forcedKey;
        // A tool's `parameters` JSON schema switches its subtree (including
        // nested schemas) to long-description forcing.
        const childLong = longBlock || (forceBlock && key === 'parameters');
        return `${inner}${JSON.stringify(key)}: ${formatValue(
          item,
          inner,
          force,
          childLong,
        )}`;
      });
    if (fields.length === 0) return '{}';
    return `{\n${fields.join(',\n')}\n${indent}}`;
  }
  return 'null';
}

/**
 * Pretty-prints a value as JSON, rendering free-form text — multi-line
 * strings and known text fields — as triple-quoted text blocks wrapped in
 * `BLOCK_START`/`BLOCK_END` sentinels.
 */
export function prettyJson(value: unknown): string {
  return formatValue(value, '');
}

/**
 * Splits rendered output into plain text and text-block parts, in order,
 * with the sentinel characters stripped. Concatenating the parts
 * reproduces the rendered output without the sentinels.
 */
export function splitTextBlocks(rendered: string): PrettyJsonPart[] {
  const parts: PrettyJsonPart[] = [];
  const push = (text: string) => {
    if (text !== '') parts.push({ text });
  };
  const chunks = rendered.split(BLOCK_START);
  push(chunks[0]);
  for (const chunk of chunks.slice(1)) {
    const end = chunk.indexOf(BLOCK_END);
    if (end === -1) {
      // Unbalanced sentinels cannot come from `prettyJson`; fall back to
      // treating the chunk as plain text.
      push(BLOCK_START + chunk);
      continue;
    }
    parts.push({ block: chunk.slice(0, end) });
    push(chunk.slice(end + BLOCK_END.length));
  }
  return parts;
}
