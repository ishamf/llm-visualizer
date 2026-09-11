import { describe, expect, it } from 'vitest';

import {
  PACKED_SESSION_FORMAT,
  PACKED_SESSION_SCHEMA_VERSION,
  parsePackedSession,
} from './packed-session.ts';
import { makeTestSession } from './test-fixtures.ts';

describe('parsePackedSession', () => {
  it('parses a valid packed session', () => {
    const session = parsePackedSession(makeTestSession());
    expect(session.schemaVersion).toBe(PACKED_SESSION_SCHEMA_VERSION);
    expect(session.format).toBe(PACKED_SESSION_FORMAT);
    expect(session.session.cwd).toBe('/project');
    expect(session.prompt.messages).toHaveLength(4);
    expect(session.prompt.tools?.map(({ name }) => name)).toEqual([
      'bash',
      'read',
    ]);
    expect(session.requests).toHaveLength(2);
    expect(session.requests[0].data.response.usage.output).toBe(100);
    expect(session.requests[0].response?.content[0].type).toBe('thinking');
  });

  it('rejects unsupported format or schema version', () => {
    expect(() =>
      parsePackedSession({ ...makeTestSession(), format: 'something-else' }),
    ).toThrow(/unsupported format/i);
    expect(() =>
      parsePackedSession({ ...makeTestSession(), schemaVersion: 99 }),
    ).toThrow(/unsupported format/i);
  });

  it('rejects missing prompt messages or empty requests', () => {
    const { prompt, ...rest } = makeTestSession();
    expect(() => parsePackedSession(rest)).toThrow(/prompt\.messages/);
    expect(() =>
      parsePackedSession({ ...makeTestSession(), requests: [] }),
    ).toThrow(/no requests/i);
    void prompt;
  });

  it('rejects message counts outside the transcript', () => {
    const session = makeTestSession();
    session.requests[1].messageCount = 99;
    expect(() => parsePackedSession(session)).toThrow(/messageCount/);

    const decreasing = makeTestSession();
    decreasing.requests[1].messageCount = 0;
    expect(() => parsePackedSession(decreasing)).toThrow(/messageCount/);
  });

  it('rejects tool result messages without a tool call id', () => {
    const session = makeTestSession();
    const toolResult = session.prompt.messages[2];
    delete (toolResult as { toolCallId?: string }).toolCallId;
    expect(() => parsePackedSession(session)).toThrow(/toolCallId/);
  });

  it('rejects unsupported message parts', () => {
    const session = makeTestSession();
    session.prompt.messages[0].parts = [{ type: 'wat' } as never];
    expect(() => parsePackedSession(session)).toThrow(/unsupported shape/i);
  });
});
