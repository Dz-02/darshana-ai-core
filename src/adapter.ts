/**
 * The application adapter contract.
 *
 * The universal AI core never reads an application's tables, models or session
 * directly. It calls this interface; each application implements it against
 * its own data and nothing else. Every value that crosses the boundary is
 * stamped with the `appId` (and, for data, the `tenantId`) it came from, so the
 * boundary guard in `isolation.ts` can refuse anything that belongs elsewhere.
 */

/** Bumped on a breaking change to any contract in this package. Adapters declare the one they implement. */
export const CORE_CONTRACT_VERSION = '1.0.0';

/** What the host application hands the adapter so it can work out who is calling. Opaque to the core. */
export interface ContextInput {
  /** Whatever the app authenticates with (token, session). The core never inspects it. */
  credentials: unknown;
  /** Current route / module, when the caller is on a module screen. */
  route?: string;
  module?: string;
}

/** Who is calling and where. Produced only by an adapter. */
export interface AppContext {
  /** The application that produced this context, e.g. `lms_k12`, `g2g`. */
  appId: string;
  /** The application's own tenancy key, as an opaque string. Meaning is the adapter's business. */
  tenantId: string;
  userId: string;
  module?: string;
  route?: string;
  /** Adapter-defined extras (academic year, platform-owner flag, …). The core passes them through untouched. */
  attributes: Readonly<Record<string, unknown>>;
}

export interface EntityRef {
  appId: string;
  /** Adapter-defined kind, e.g. `student`, `employee`. */
  kind: string;
  id: string;
  label?: string;
}

export interface EntityQuery {
  kind?: string;
  /** Free text or id the caller typed. */
  text: string;
}

export type CapabilityKind = 'insight' | 'data' | 'action';

export interface Capability {
  key: string;
  label: string;
  kind: CapabilityKind;
  module?: string;
  description?: string;
}

export type PermissionVerb = 'view' | 'create' | 'edit' | 'delete' | 'execute';

export interface PermissionSet {
  appId: string;
  tenantId: string;
  userId: string;
  /** Capability key -> verbs the caller holds. A capability that is absent is not permitted. */
  grants: Readonly<Record<string, ReadonlyArray<PermissionVerb>>>;
  /** True for the application's own notion of administrator. */
  isAdmin: boolean;
}

export interface DataRequest {
  /** A source the adapter advertised; the core cannot name a table. */
  source: string;
  params?: Readonly<Record<string, unknown>>;
  limit?: number;
}

export interface DataResult {
  appId: string;
  tenantId: string;
  source: string;
  rows: ReadonlyArray<Readonly<Record<string, unknown>>>;
  total?: number;
  truncated?: boolean;
}

export interface ActionRequest {
  action: string;
  input?: Readonly<Record<string, unknown>>;
}

export interface ActionResult {
  appId: string;
  tenantId: string;
  action: string;
  ok: boolean;
  output?: unknown;
  /** Present when `ok` is false. A refusal is a result, never a thrown error. */
  error?: { code: string; message: string };
}

export interface AppAdapter {
  /** Stable, unique id of the application this adapter fronts. */
  readonly appId: string;
  /** The `CORE_CONTRACT_VERSION` this adapter was written against. */
  readonly contractVersion: string;

  getContext(input: ContextInput): Promise<AppContext>;
  resolveEntity(ctx: AppContext, query: EntityQuery): Promise<EntityRef[]>;
  listCapabilities(ctx: AppContext): Promise<Capability[]>;
  getPermissions(ctx: AppContext): Promise<PermissionSet>;
  getData(ctx: AppContext, request: DataRequest): Promise<DataResult>;
  executeAction(ctx: AppContext, request: ActionRequest): Promise<ActionResult>;
}
