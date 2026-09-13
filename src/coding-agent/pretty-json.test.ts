import { describe, expect, it } from 'vitest';

import { prettyJson, splitTextBlocks } from './pretty-json.ts';

const BLOCK_START = '\u0002';
const BLOCK_END = '\u0003';

describe('prettyJson', () => {
  it('matches JSON.stringify for values without multi-line strings', () => {
    const value = {
      system: 'plain',
      tools: [{ name: 'bash', parameters: { command: 'ls' } }],
      messages: [],
      count: 3,
      ratio: 1.5,
      ok: true,
      missing: null,
    };
    expect(prettyJson(value)).toBe(JSON.stringify(value, null, 2));
  });

  it('omits undefined properties like JSON.stringify', () => {
    expect(prettyJson({ a: undefined, b: 1 })).toBe(
      JSON.stringify({ a: undefined, b: 1 }, null, 2),
    );
  });

  it('renders empty containers inline', () => {
    expect(prettyJson({ empty: [], blank: {} })).toBe(
      '{\n  "empty": [],\n  "blank": {}\n}',
    );
  });

  it('renders multi-line strings as flush-left triple-quoted blocks', () => {
    expect(prettyJson({ text: 'Hello\nWorld' })).toBe(
      '{\n' +
        '  "text": ' +
        BLOCK_START +
        "'''\n" +
        'Hello\n' +
        'World\n' +
        "'''" +
        BLOCK_END +
        '\n}',
    );
  });

  it('keeps block content flush-left at any nesting depth', () => {
    const rendered = prettyJson({ outer: { inner: 'one\ntwo' } });
    expect(rendered).toContain("'''\none\ntwo\n'''");
  });

  it('dedents lines sharing common leading indentation', () => {
    const rendered = prettyJson({ text: '    a\n    b\n\n    c' });
    expect(rendered).toContain("'''\na\nb\n\nc\n'''");
  });

  it('does not dedent when lines lack common indentation', () => {
    expect(prettyJson({ text: '  a\nb' })).toContain("'''\n  a\nb\n'''");
  });

  it('treats tabs and spaces as different indentation', () => {
    expect(prettyJson({ text: '\ta\n  b' })).toContain("'''\n\ta\n  b\n'''");
  });

  it('shows a trailing newline as a blank line before the closing fence', () => {
    const rendered = prettyJson({ text: 'only\n' });
    expect(rendered).toContain("'''\nonly\n\n'''");
  });

  it('does not escape JSON characters inside blocks', () => {
    const rendered = prettyJson({ text: 'He said "hi"\n\\done' });
    expect(rendered).toContain('He said "hi"\n\\done');
    expect(rendered).not.toContain('\\"');
  });

  it('keeps single-line strings escaped as JSON', () => {
    expect(prettyJson({ text: 'a b' })).toBe('{\n  "text": "a b"\n}');
  });

  it('always renders tool descriptions as blocks', () => {
    const rendered = prettyJson({
      tools: [
        {
          name: 'bash',
          description: 'Runs a shell command',
          parameters: { type: 'object' },
        },
      ],
    });
    expect(rendered).toContain("'''\nRuns a shell command\n'''");
  });

  it('does not force descriptions outside tool definitions', () => {
    const rendered = prettyJson({
      tools: [
        {
          name: 'bash',
          parameters: { type: 'object', description: 'schema text' },
        },
      ],
      meta: { description: 'not a tool' },
    });
    expect(rendered).toContain('"description": "schema text"');
    expect(rendered).toContain('"description": "not a tool"');
  });

  it('always renders text and thinking parts as blocks', () => {
    const rendered = prettyJson({
      messages: [
        { role: 'user', parts: [{ type: 'text', text: 'plain words' }] },
        {
          role: 'assistant',
          parts: [{ type: 'thinking', thinking: 'pondering' }],
        },
      ],
    });
    expect(rendered).toContain("'''\nplain words\n'''");
    expect(rendered).toContain("'''\npondering\n'''");
  });

  it('keeps empty forced fields as JSON strings', () => {
    const rendered = prettyJson({
      messages: [{ role: 'user', parts: [{ type: 'text', text: '' }] }],
    });
    expect(rendered).toContain('"text": ""');
  });

  it('renders parameter-schema descriptions over 100 chars as blocks', () => {
    const long = 'd'.repeat(101);
    const rendered = prettyJson({
      tools: [
        {
          name: 'bash',
          parameters: {
            type: 'object',
            description: long,
            properties: {
              command: { type: 'string', description: long },
            },
          },
        },
      ],
    });
    expect(rendered).toContain(`'''\n${long}\n'''`);
  });

  it('keeps schema descriptions of 100 chars or fewer as JSON', () => {
    const rendered = prettyJson({
      tools: [
        {
          name: 'bash',
          parameters: {
            type: 'object',
            description: 'x'.repeat(100),
            properties: {
              command: { type: 'string', description: 'short' },
            },
          },
        },
      ],
    });
    expect(rendered).toContain(`"description": "${'x'.repeat(100)}"`);
    expect(rendered).toContain('"description": "short"');
  });

  it('does not apply the length rule outside tool parameters', () => {
    const long = 'y'.repeat(101);
    const rendered = prettyJson({ meta: { description: long } });
    expect(rendered).toContain(`"description": "${long}"`);
  });
});

describe('splitTextBlocks', () => {
  it('splits rendered output into text and block parts in order', () => {
    const rendered = prettyJson({
      before: 1,
      text: 'line1\nline2',
      after: 'x',
    });
    expect(splitTextBlocks(rendered)).toEqual([
      { text: '{\n  "before": 1,\n  "text": ' },
      { block: "'''\nline1\nline2\n'''" },
      { text: ',\n  "after": "x"\n}' },
    ]);
  });

  it('reproduces the rendered output when concatenated', () => {
    const rendered = prettyJson({
      messages: [{ role: 'user', parts: [{ type: 'text', text: 'a\nb' }] }],
    });
    expect(
      splitTextBlocks(rendered)
        .map((part) => ('block' in part ? part.block : part.text))
        .join(''),
    ).toBe(rendered.replaceAll(BLOCK_START, '').replaceAll(BLOCK_END, ''));
  });
});
