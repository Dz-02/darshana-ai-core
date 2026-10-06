/** The rich answer vocabulary passes the isolation guard untouched, and the guard still polices it. */
import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import type { AppContext } from './adapter';
import type { ChatEngine, ChatReply, ChatStreamEvent } from './chat';
import { CrossAppAccessError, guardChatEngine } from './isolation';

const ctx: AppContext = { appId: 'app_a', tenantId: 't', userId: 'u', attributes: {} };

const rich: ChatReply = {
  appId: 'app_a',
  conversationId: 'c1',
  turn: 2,
  reference: 'R-1',
  answer: {
    text: 'plain',
    headline: 'Headline',
    status: 'ok',
    sections: [
      { type: 'text', body: 'b' },
      { type: 'evidence', items: [{ summary: 's', source: 'computed', verified: false, generated: true }] },
      { type: 'future_kind', data: { x: 1 } },
    ],
    citations: [{ source: 'x', available: true }],
    approvals: [
      {
        id: 'a1',
        kind: 'k',
        title: 't',
        requiresApproval: true,
        status: 'pending',
        actions: [{ type: 'decision', label: 'Approve', payload: {}, intent: 'approve', decisionRef: { kind: 'rec', id: '1' } }],
      },
    ],
    handoff: { target: { route: '/r', query: { id: 1 } }, suppressedByPendingDecision: true },
    trace: [{ key: 's1', order: 1, layer: 'l', status: 'ran', summary: 'x' }],
    outcomes: [{ metricKey: 'm', status: 'pending' }],
  },
};

function engine(reply: ChatReply, events: ChatStreamEvent[] = []): ChatEngine {
  return {
    engineId: 'e',
    appId: 'app_a',
    capabilities: { streaming: events.length > 0, history: false },
    send: async () => reply,
    ...(events.length
      ? {
          async *stream() {
            yield* events;
          },
        }
      : {}),
  };
}

describe('rich chat contract through the guard', () => {
  it('returns a rich reply unchanged', async () => {
    assert.deepEqual(await guardChatEngine(engine(rich)).send(ctx, { message: 'q', navigation: { route: '/x' }, actionModule: 'm' }), rich);
  });

  it('passes progress and handoff stream events through and ends on done', async () => {
    const events: ChatStreamEvent[] = [
      { type: 'progress', step: { key: 's1', order: 1, layer: 'l', status: 'ran', summary: 'x' } },
      { type: 'handoff', handoff: { target: { route: '/r' } } },
      { type: 'done', reply: rich },
    ];
    const seen: string[] = [];
    for await (const e of guardChatEngine(engine(rich, events)).stream!(ctx, { message: 'q' })) seen.push(e.type);
    assert.deepEqual(seen, ['progress', 'handoff', 'done']);
  });

  it('still rejects a rich reply stamped with another application', async () => {
    await assert.rejects(() => guardChatEngine(engine({ ...rich, appId: 'app_b' })).send(ctx, { message: 'q' }), CrossAppAccessError);
  });
});
