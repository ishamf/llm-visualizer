import { describe, expect, it } from 'vitest';

import { emitRequestJump, onRequestJump } from './request-jump.ts';

describe('request-jump pub-sub', () => {
  it('delivers jumps to a subscribed listener', () => {
    const jumps: number[] = [];
    const unsubscribe = onRequestJump('coding-agent', ({ request }) => {
      jumps.push(request);
    });

    emitRequestJump('coding-agent', { request: 7 });

    expect(jumps).toEqual([7]);
    unsubscribe();
  });

  it('only delivers jumps for the session the listener subscribed to', () => {
    const jumps: number[] = [];
    const unsubscribe = onRequestJump('coding-agent', ({ request }) =>
      jumps.push(request),
    );

    emitRequestJump('other-session', { request: 3 });
    emitRequestJump('coding-agent', { request: 4 });

    expect(jumps).toEqual([4]);
    unsubscribe();
  });

  it('notifies every listener of the same session', () => {
    const first: number[] = [];
    const second: number[] = [];
    const unsubscribeFirst = onRequestJump('coding-agent', ({ request }) =>
      first.push(request),
    );
    const unsubscribeSecond = onRequestJump('coding-agent', ({ request }) =>
      second.push(request),
    );

    emitRequestJump('coding-agent', { request: 2 });

    expect(first).toEqual([2]);
    expect(second).toEqual([2]);
    unsubscribeFirst();
    unsubscribeSecond();
  });

  it('stops delivering after unsubscribe', () => {
    const jumps: number[] = [];
    const unsubscribe = onRequestJump('coding-agent', ({ request }) =>
      jumps.push(request),
    );

    emitRequestJump('coding-agent', { request: 1 });
    unsubscribe();
    emitRequestJump('coding-agent', { request: 5 });

    expect(jumps).toEqual([1]);
  });

  it('lets a listener subscribe to another session after unsubscribing', () => {
    const jumps: number[] = [];
    const unsubscribe = onRequestJump('coding-agent', ({ request }) =>
      jumps.push(request),
    );
    unsubscribe();

    const unsubscribeOther = onRequestJump(
      'layer-settings-popup',
      ({ request }) => jumps.push(request),
    );
    emitRequestJump('layer-settings-popup', { request: 9 });

    expect(jumps).toEqual([9]);
    unsubscribeOther();
  });

  it('is safe to emit with no listeners', () => {
    expect(() => emitRequestJump('no-session', { request: 1 })).not.toThrow();
  });
});
