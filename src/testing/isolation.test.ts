/**
 * Self-tests for the isolation boundary. The fakes below exist only to be
 * tested here; nothing in the shipped packages contains fixture data.
 */
import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import {
  AdapterRegistry,
  CrossAppAccessError,
  guardAdapter,
  guardChatEngine,
  type AppAdapter,
  type AppContext,
  type ChatEngine,
} from '../index';
import { runAdapterContract, runChatEngineContract } from './index';

function fakeAdapter(appId: string, overrides: Partial<AppAdapter> = {}): AppAdapter {
  const base: AppAdapter = {
    appId,
    contractVersion: '1.0.0',
    async getContext() {
      return { appId, tenantId: 't1', userId: 'u1', attributes: {} };
    },
    async resolveEntity(ctx) {
      return [{ appId: ctx.appId, kind: 'thing', id: '1' }];
    },
    async listCapabilities() {
      return [{ key: 'overview', label: 'Overview', kind: 'data' }];
    },
    async getPermissions(ctx) {
      return { appId: ctx.appId, tenantId: ctx.tenantId, userId: ctx.userId, grants: {}, isAdmin: false };
    },
    async getData(ctx, req) {
      return { appId: ctx.appId, tenantId: ctx.tenantId, source: req.source, rows: [] };
    },
    async executeAction(ctx, req) {
      return {
        appId: ctx.appId,
        tenantId: ctx.tenantId,
        action: req.action,
        ok: false,
        error: { code: 'unknown_action', message: req.action },
      };
    },
  };
  return { ...base, ...overrides };
}

function fakeEngine(appId: string, overrides: Partial<ChatEngine> = {}): ChatEngine {
  return {
    engineId: `${appId}-fake`,
    appId,
    capabilities: { streaming: false, history: false },
    async send(ctx) {
      return { appId: ctx.appId, conversationId: 'c1', answer: { text: 'ok' } };
    },
    ...overrides,
  };
}

const ctxFor = (appId: string, tenantId = 't1'): AppContext => ({
  appId,
  tenantId,
  userId: 'u1',
  attributes: {},
});

// A well-behaved adapter passes the shared suite — this is what each app's own test file does.
runAdapterContract('well-behaved fake', {
  create: () => fakeAdapter('app_a'),
  contextInput: { credentials: 'x' },
  dataSource: 'overview',
});
runChatEngineContract('well-behaved fake', {
  create: () => fakeEngine('app_a'),
  context: () => ctxFor('app_a'),
  message: 'hello',
});

describe('isolation guard catches leaks', () => {
  it('blocks data stamped with another app', async () => {
    const leaky = fakeAdapter('app_a', {
      async getData(ctx, req) {
        return { appId: 'app_b', tenantId: ctx.tenantId, source: req.source, rows: [] };
      },
    });
    await assert.rejects(() => guardAdapter(leaky).getData(ctxFor('app_a'), { source: 's' }), CrossAppAccessError);
  });

  it('blocks data from another tenant of the same app', async () => {
    const leaky = fakeAdapter('app_a', {
      async getData(ctx, req) {
        return { appId: ctx.appId, tenantId: 'someone_else', source: req.source, rows: [] };
      },
    });
    await assert.rejects(() => guardAdapter(leaky).getData(ctxFor('app_a'), { source: 's' }), CrossAppAccessError);
  });

  it('blocks entities, permissions and action results stamped with another app', async () => {
    const leaky = fakeAdapter('app_a', {
      async resolveEntity() {
        return [{ appId: 'app_b', kind: 'x', id: '1' }];
      },
      async getPermissions(ctx) {
        return { appId: 'app_b', tenantId: ctx.tenantId, userId: ctx.userId, grants: {}, isAdmin: true };
      },
      async executeAction(ctx, req) {
        return { appId: 'app_b', tenantId: ctx.tenantId, action: req.action, ok: true };
      },
    });
    const g = guardAdapter(leaky);
    const ctx = ctxFor('app_a');
    await assert.rejects(() => g.resolveEntity(ctx, { text: 'x' }), CrossAppAccessError);
    await assert.rejects(() => g.getPermissions(ctx), CrossAppAccessError);
    await assert.rejects(() => g.executeAction(ctx, { action: 'a' }), CrossAppAccessError);
  });

  it('refuses an adapter built for an incompatible contract major', () => {
    assert.throws(() => guardAdapter(fakeAdapter('app_a', { contractVersion: '2.0.0' })), CrossAppAccessError);
  });

  it('blocks a chat reply, stream and conversation list stamped with another app', async () => {
    const leaky = fakeEngine('app_a', {
      capabilities: { streaming: true, history: true },
      async send() {
        return { appId: 'app_b', conversationId: 'c', answer: { text: 'x' } };
      },
      async *stream() {
        yield { type: 'done' as const, reply: { appId: 'app_b', conversationId: 'c', answer: { text: 'x' } } };
      },
      async listConversations() {
        return [{ appId: 'app_b', conversationId: 'c', title: 't', updatedAt: 'now' }];
      },
    });
    const g = guardChatEngine(leaky);
    const ctx = ctxFor('app_a');
    await assert.rejects(() => g.send(ctx, { message: 'm' }), CrossAppAccessError);
    await assert.rejects(async () => {
      for await (const _ of g.stream!(ctx, { message: 'm' })) void _;
    }, CrossAppAccessError);
    await assert.rejects(() => g.listConversations!(ctx), CrossAppAccessError);
  });
});

describe('registry routes strictly by appId', () => {
  it('serves two apps side by side without crossover', async () => {
    const registry = new AdapterRegistry();
    registry.registerAdapter(fakeAdapter('app_a'));
    registry.registerAdapter(fakeAdapter('app_b'));
    assert.equal(registry.adapterFor(ctxFor('app_a')).appId, 'app_a');
    assert.equal(registry.adapterFor(ctxFor('app_b')).appId, 'app_b');
  });

  it('refuses an unregistered app and a duplicate registration', () => {
    const registry = new AdapterRegistry();
    registry.registerAdapter(fakeAdapter('app_a'));
    assert.throws(() => registry.adapterFor(ctxFor('app_c')), CrossAppAccessError);
    assert.throws(() => registry.registerAdapter(fakeAdapter('app_a')), CrossAppAccessError);
  });

  it('a registered adapter cannot be driven with another app’s context', async () => {
    const registry = new AdapterRegistry();
    registry.registerAdapter(fakeAdapter('app_a'));
    registry.registerAdapter(fakeAdapter('app_b'));
    const adapterA = registry.adapterFor(ctxFor('app_a'));
    await assert.rejects(() => adapterA.listCapabilities(ctxFor('app_b')), CrossAppAccessError);
  });
});
