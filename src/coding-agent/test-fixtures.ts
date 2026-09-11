import type { PackedRequest, PackedSession } from './packed-session.ts';

export const TEST_USER_TEXT = 'Fix the bug';
export const TEST_SECOND_USER_TEXT = 'Now summarize what you changed';
export const TEST_THINKING_TEXT = 'T';
export const TEST_ASSISTANT_TEXT = 'All done';
export const TEST_TOOL_RESULT_TEXT = 'file.txt';

/**
 * Two-request packed session used by the parser and timeline tests:
 *
 * - Request 1 (100 output tokens): user turn, then a thinking block and a
 *   `bash` tool call with real-time streaming segments.
 * - Request 2 (50 output tokens): a second user turn, then a final text
 *   response that stops the turn.
 */
export function makeTestSession(): PackedSession {
  const requests: PackedRequest[] = [
    {
      id: '0001',
      kind: 'turn',
      messageCount: 1,
      data: {
        schemaVersion: 1,
        id: '0001',
        kind: 'turn',
        request: { provider: 'test-provider', model: 'test-model' },
        response: {
          status: 200,
          usage: {
            input: 10,
            output: 100,
            cacheRead: 5,
            cacheWrite: 0,
            cost: { total: 0.01 },
          },
          stopReason: 'toolUse',
        },
        timing: {
          sentAt: 1000,
          segments: [
            { type: 'thinking', contentIndex: 0, startDtMs: 0, endDtMs: 50 },
            { type: 'toolCall', contentIndex: 1, startDtMs: 50, endDtMs: 250 },
          ],
        },
      },
      response: {
        role: 'assistant',
        content: [
          { type: 'thinking', thinking: TEST_THINKING_TEXT },
          {
            type: 'toolCall',
            id: 'call_1',
            name: 'bash',
            arguments: { command: 'ls' },
          },
        ],
        stopReason: 'toolUse',
      },
    },
    {
      id: '0002',
      kind: 'turn',
      messageCount: 4,
      data: {
        schemaVersion: 1,
        id: '0002',
        kind: 'turn',
        request: { provider: 'test-provider', model: 'test-model' },
        response: {
          status: 200,
          usage: {
            input: 20,
            output: 50,
            cacheRead: 0,
            cacheWrite: 0,
            cost: { total: 0.02 },
          },
          stopReason: 'stop',
        },
        timing: {
          sentAt: 2000,
          segments: [
            { type: 'text', contentIndex: 0, startDtMs: 0, endDtMs: 100 },
          ],
        },
      },
      response: {
        role: 'assistant',
        content: [{ type: 'text', text: TEST_ASSISTANT_TEXT }],
        stopReason: 'stop',
      },
    },
  ];

  return {
    schemaVersion: 1,
    format: 'pi-recorder-packed-session',
    session: { id: 'session-1', cwd: '/project' },
    prompt: {
      system: 'You are a coding agent.',
      tools: [{ name: 'bash' }, { name: 'read' }],
      messages: [
        {
          index: 0,
          role: 'user',
          parts: [{ type: 'text', text: TEST_USER_TEXT }],
        },
        {
          index: 1,
          role: 'assistant',
          parts: [
            { type: 'thinking', thinking: TEST_THINKING_TEXT },
            { type: 'toolCall', id: 'call_1', name: 'bash', arguments: {} },
          ],
        },
        {
          index: 2,
          role: 'toolResult',
          toolCallId: 'call_1',
          toolName: 'bash',
          isError: false,
          parts: [{ type: 'text', text: TEST_TOOL_RESULT_TEXT }],
        },
        {
          index: 3,
          role: 'user',
          parts: [{ type: 'text', text: TEST_SECOND_USER_TEXT }],
        },
      ],
    },
    requests,
  };
}
