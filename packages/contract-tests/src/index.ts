/**
 * Contract suites. An application proves its adapter / chat engine honours the
 * universal contract by calling one function from its own test file:
 *
 *   runAdapterContract('g2g', { create: () => new G2gAdapter(...), contextInput, dataSource });
 *
 * The suites run against the *guarded* implementation, so a leak between apps
 * or tenants fails the test exactly as it would fail in production.
 */
import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import {
  CORE_CONTRACT_VERSION,
  CrossAppAccessError,
  guardAdapter,
  guardChatEngine,
  type AppAdapter,
  type AppContext,
  type ChatEngine,
  type ContextInput,
} from '@ai-core/contracts';

export interface AdapterContractOptions {
  create: () => AppAdapter | Promise<AppAdapter>;
  /** A valid input for this application's own auth (a test user, not a mock of the data). */
  contextInput: ContextInput;
  /** A source the adapter advertises as a `data` capability; omit if it has none. */
  dataSource?: string;
}

export interface ChatEngineContractOptions {
  create: () => ChatEngine | Promise<ChatEngine>;
  /** Produces a context for this engine's own app. */
  context: () => AppContext | Promise<AppContext>;
  /** A message the engine can answer against its own data. */
  message: string;
}

/** A context that claims to come from some other application. */
function foreign(ctx: AppContext): AppContext {
  return { ...ctx, appId: `${ctx.appId}__other` };
}

export function runAdapterContract(name: string, opts: AdapterContractOptions): void {
  describe(`adapter contract: ${name}`, () => {
    it('declares an appId and a compatible contract version', async () => {
      const adapter = await opts.create();
      assert.ok(adapter.appId.length > 0, 'appId must be non-empty');
      assert.equal(adapter.contractVersion.split('.')[0], CORE_CONTRACT_VERSION.split('.')[0]);
    });

    it('getContext stamps its own appId and a tenant and user', async () => {
      const adapter = guardAdapter(await opts.create());
      const ctx = await adapter.getContext(opts.contextInput);
      assert.equal(ctx.appId, adapter.appId);
      assert.ok(ctx.tenantId.length > 0);
      assert.ok(ctx.userId.length > 0);
    });

    it('lists capabilities with unique keys', async () => {
      const adapter = guardAdapter(await opts.create());
      const ctx = await adapter.getContext(opts.contextInput);
      const caps = await adapter.listCapabilities(ctx);
      const keys = caps.map((c) => c.key);
      assert.equal(new Set(keys).size, keys.length, 'capability keys must be unique');
    });

    it('returns permissions for the same app, tenant and user as the context', async () => {
      const adapter = guardAdapter(await opts.create());
      const ctx = await adapter.getContext(opts.contextInput);
      const perms = await adapter.getPermissions(ctx);
      assert.equal(perms.appId, ctx.appId);
      assert.equal(perms.tenantId, ctx.tenantId);
      assert.equal(perms.userId, ctx.userId);
    });

    it('answers getData only for its own app and tenant', async () => {
      if (!opts.dataSource) return;
      const adapter = guardAdapter(await opts.create());
      const ctx = await adapter.getContext(opts.contextInput);
      const result = await adapter.getData(ctx, { source: opts.dataSource, limit: 5 });
      assert.equal(result.appId, ctx.appId);
      assert.equal(result.tenantId, ctx.tenantId);
      assert.ok(Array.isArray(result.rows));
    });

    it('refuses an unknown action as a result, not a throw', async () => {
      const adapter = guardAdapter(await opts.create());
      const ctx = await adapter.getContext(opts.contextInput);
      const result = await adapter.executeAction(ctx, { action: '__no_such_action__' });
      assert.equal(result.ok, false);
      assert.ok(result.error?.code);
    });

    it('rejects a context that belongs to another application', async () => {
      const adapter = guardAdapter(await opts.create());
      const ctx = await adapter.getContext(opts.contextInput);
      await assert.rejects(() => adapter.listCapabilities(foreign(ctx)), CrossAppAccessError);
      await assert.rejects(() => adapter.getPermissions(foreign(ctx)), CrossAppAccessError);
      await assert.rejects(
        () => adapter.getData(foreign(ctx), { source: opts.dataSource ?? 'x' }),
        CrossAppAccessError,
      );
    });
  });
}

export function runChatEngineContract(name: string, opts: ChatEngineContractOptions): void {
  describe(`chat engine contract: ${name}`, () => {
    it('declares an engine id and the app it serves', async () => {
      const engine = await opts.create();
      assert.ok(engine.engineId.length > 0);
      assert.ok(engine.appId.length > 0);
    });

    it('send answers for its own app with a conversation id and text', async () => {
      const engine = guardChatEngine(await opts.create());
      const ctx = await opts.context();
      const reply = await engine.send(ctx, { message: opts.message });
      assert.equal(reply.appId, engine.appId);
      assert.ok(reply.conversationId.length > 0);
      assert.equal(typeof reply.answer.text, 'string');
    });

    it('stream ends with a done event, only if it claims to stream', async () => {
      const engine = guardChatEngine(await opts.create());
      if (!engine.capabilities.streaming) {
        assert.equal(engine.stream, undefined, 'engine must not expose stream() without declaring it');
        return;
      }
      assert.ok(engine.stream, 'engine declares streaming but has no stream()');
      const ctx = await opts.context();
      const events = [];
      for await (const e of engine.stream!(ctx, { message: opts.message })) events.push(e);
      assert.equal(events.at(-1)?.type, 'done');
    });

    it('lists conversations only if it claims history, all for its own app', async () => {
      const engine = guardChatEngine(await opts.create());
      if (!engine.capabilities.history) {
        assert.equal(engine.listConversations, undefined);
        return;
      }
      const rows = await engine.listConversations!(await opts.context());
      for (const row of rows) assert.equal(row.appId, engine.appId);
    });

    it('rejects a context that belongs to another application', async () => {
      const engine = guardChatEngine(await opts.create());
      const ctx = await opts.context();
      await assert.rejects(() => engine.send(foreign(ctx), { message: opts.message }), CrossAppAccessError);
    });
  });
}
