/**
 * The data-isolation boundary.
 *
 * `guardAdapter` / `guardChatEngine` wrap an implementation so that nothing
 * belonging to another application or tenant can pass through, even if the
 * implementation is buggy. A violation throws `CrossAppAccessError`; it is never
 * silently filtered, because a leak that is filtered is a leak nobody notices.
 */
import {
  CORE_CONTRACT_VERSION,
  type ActionRequest,
  type ActionResult,
  type AppAdapter,
  type AppContext,
  type Capability,
  type ContextInput,
  type DataRequest,
  type DataResult,
  type EntityQuery,
  type EntityRef,
  type PermissionSet,
} from './adapter';
import type { ChatEngine, ChatReply, ChatRequest, ChatStreamEvent } from './chat';

export class CrossAppAccessError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CrossAppAccessError';
  }
}

function major(version: string): string {
  return version.split('.')[0] ?? '';
}

function assertApp(expected: string, actual: string | undefined, what: string): void {
  if (actual !== expected) {
    throw new CrossAppAccessError(
      `${what} belongs to app "${actual ?? 'unknown'}" but this boundary serves "${expected}"`,
    );
  }
}

function assertTenant(expected: string, actual: string | undefined, what: string): void {
  if (actual !== expected) {
    throw new CrossAppAccessError(`${what} belongs to another tenant than the calling context`);
  }
}

/** Wraps an adapter so its inputs and outputs are checked against its own `appId` and the caller's tenant. */
export function guardAdapter(adapter: AppAdapter): AppAdapter {
  if (!adapter.appId) throw new CrossAppAccessError('adapter has no appId');
  if (major(adapter.contractVersion) !== major(CORE_CONTRACT_VERSION)) {
    throw new CrossAppAccessError(
      `adapter "${adapter.appId}" implements contract ${adapter.contractVersion}; core is ${CORE_CONTRACT_VERSION}`,
    );
  }
  const appId = adapter.appId;
  const own = (ctx: AppContext) => assertApp(appId, ctx.appId, 'context');

  return {
    appId,
    contractVersion: adapter.contractVersion,

    async getContext(input: ContextInput): Promise<AppContext> {
      const ctx = await adapter.getContext(input);
      own(ctx);
      return ctx;
    },
    async resolveEntity(ctx: AppContext, query: EntityQuery): Promise<EntityRef[]> {
      own(ctx);
      const refs = await adapter.resolveEntity(ctx, query);
      for (const ref of refs) assertApp(appId, ref.appId, 'entity');
      return refs;
    },
    async listCapabilities(ctx: AppContext): Promise<Capability[]> {
      own(ctx);
      return adapter.listCapabilities(ctx);
    },
    async getPermissions(ctx: AppContext): Promise<PermissionSet> {
      own(ctx);
      const set = await adapter.getPermissions(ctx);
      assertApp(appId, set.appId, 'permission set');
      assertTenant(ctx.tenantId, set.tenantId, 'permission set');
      return set;
    },
    async getData(ctx: AppContext, request: DataRequest): Promise<DataResult> {
      own(ctx);
      const result = await adapter.getData(ctx, request);
      assertApp(appId, result.appId, 'data');
      assertTenant(ctx.tenantId, result.tenantId, 'data');
      return result;
    },
    async executeAction(ctx: AppContext, request: ActionRequest): Promise<ActionResult> {
      own(ctx);
      const result = await adapter.executeAction(ctx, request);
      assertApp(appId, result.appId, 'action result');
      assertTenant(ctx.tenantId, result.tenantId, 'action result');
      return result;
    },
  };
}

function guardedReply(appId: string, reply: ChatReply): ChatReply {
  assertApp(appId, reply.appId, 'chat reply');
  return reply;
}

/** Same guarantee for a chat engine: it may only be called with, and may only answer for, its own app. */
export function guardChatEngine(engine: ChatEngine): ChatEngine {
  const appId = engine.appId;
  const own = (ctx: AppContext) => assertApp(appId, ctx.appId, 'context');

  const guarded: ChatEngine = {
    engineId: engine.engineId,
    appId,
    capabilities: engine.capabilities,
    async send(ctx: AppContext, request: ChatRequest) {
      own(ctx);
      return guardedReply(appId, await engine.send(ctx, request));
    },
  };

  if (engine.stream) {
    const inner = engine.stream.bind(engine);
    guarded.stream = async function* (ctx: AppContext, request: ChatRequest): AsyncIterable<ChatStreamEvent> {
      own(ctx);
      for await (const event of inner(ctx, request)) {
        if (event.type === 'done') guardedReply(appId, event.reply);
        yield event;
      }
    };
  }
  if (engine.listConversations) {
    const inner = engine.listConversations.bind(engine);
    guarded.listConversations = async (ctx: AppContext) => {
      own(ctx);
      const rows = await inner(ctx);
      for (const row of rows) assertApp(appId, row.appId, 'conversation');
      return rows;
    };
  }
  return guarded;
}

/** Holds one guarded adapter per application and routes by the context's `appId`, never by guesswork. */
export class AdapterRegistry {
  private readonly adapters = new Map<string, AppAdapter>();
  private readonly engines = new Map<string, ChatEngine>();

  registerAdapter(adapter: AppAdapter): void {
    if (this.adapters.has(adapter.appId)) {
      throw new CrossAppAccessError(`an adapter for "${adapter.appId}" is already registered`);
    }
    this.adapters.set(adapter.appId, guardAdapter(adapter));
  }

  registerChatEngine(engine: ChatEngine): void {
    if (this.engines.has(engine.appId)) {
      throw new CrossAppAccessError(`a chat engine for "${engine.appId}" is already registered`);
    }
    this.engines.set(engine.appId, guardChatEngine(engine));
  }

  adapterFor(ctx: AppContext): AppAdapter {
    const adapter = this.adapters.get(ctx.appId);
    if (!adapter) throw new CrossAppAccessError(`no adapter registered for app "${ctx.appId}"`);
    return adapter;
  }

  chatEngineFor(ctx: AppContext): ChatEngine {
    const engine = this.engines.get(ctx.appId);
    if (!engine) throw new CrossAppAccessError(`no chat engine registered for app "${ctx.appId}"`);
    return engine;
  }
}
