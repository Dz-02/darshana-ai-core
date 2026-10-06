/**
 * Ports the shared AI UI and client code need from the host application.
 *
 * The core never reads `process.env`, the page hostname, `localStorage`, a router or an
 * app module. Anything environmental or app-specific arrives through one of these
 * interfaces, supplied by the application's adapter. That is what lets one build of the
 * core run unchanged against an app's local and live environments: the app decides what
 * "this environment" means, the core only asks.
 *
 * Module registries and UI slots (the AI Stack descriptors, tool catalogues, the HTML
 * editor) are added once their shapes are extracted from the reference implementation.
 */
import type { ChatAction, ChatAnswer, ChatRecord, NavTarget } from '../chat';
import type { EntityRef } from '../adapter';

/** Who is signed in, in the application's own terms but a shape the core can carry. */
export interface AiSession {
  /** Bearer credential. Never logged, never stored by the core. */
  token: string;
  /**
   * The application's tenancy key (organisation, institute, ...). It is a selection the
   * server validates, never a parameter the core may default: there is no fallback tenant.
   */
  tenantId: string;
  userId: string;
  userName?: string;
  profileId?: string;
  profileName?: string;
  /** Application-defined period (academic year, financial year, ...), opaque to the core. */
  period?: Readonly<Record<string, string>>;
  /** A host hint from the login payload; only the adapter's `apiBase` interprets it. */
  baseUrlHint?: string;
}

export type AiBaseKind = 'ai' | 'mcp' | 'permissions';

/** Identity and transport. Everything environment-specific lives behind these three. */
export interface AiTransportPort {
  /** The signed-in session, or null when signed out. Re-read on every call. */
  session(): AiSession | null;
  /**
   * The root every route of this kind hangs off, with no trailing slash and including any
   * prefix (for example `https://host/api/ai`). Resolving local versus live, an explicit AI
   * host override, or a same-origin proxy is the adapter's rule; the core only appends a path.
   */
  apiBase(kind: AiBaseKind, hint?: string | null): string;
  /** Auth and tenant headers for one request, including any app-specific header names. */
  headers(session: AiSession, options?: { json?: boolean }): Record<string, string>;
}

export type PermissionAction = 'view' | 'create' | 'update' | 'delete';

/** Advisory UI gating. The server stays the authority and may still refuse. */
export interface AiPermissionsPort {
  can(module: string, action: PermissionAction): boolean;
  /** The permission key an agent in this module is gated on. */
  rbacKey(module: string): string;
}

export interface AiNavigationPort {
  push(href: string): void;
  routes: {
    /** The centralized AI & Intelligence console, optionally one capability of it. */
    console(slug?: string): string;
    /** One module's own AI Stack. Kept separate from `console` on purpose. */
    moduleAiStack(module: string): string;
    report(id: string | number): string;
  };
}

/** Wording and formatting that differs between applications. */
export interface AiBranding {
  /** What the application calls its tenant: "school", "organisation". */
  tenantNoun: string;
  tenantNounPlural: string;
  /** What it calls the people it serves, when the UI needs a noun. */
  memberNoun?: string;
  locale: string;
  currency: { code: string; format(value: number): string };
}

/** What the shared chat panel needs from the page and the app around it. */
export interface ChatHostPort {
  currentContext(): { route: string; module?: string; entity?: EntityRef; attributes?: Readonly<Record<string, unknown>> };
  subscribeContext?(listener: () => void): () => void;
  navigate(target: NavTarget): void;
  /** Turn an utterance into a destination without calling the engine, when the app can. */
  resolveNavigation?(utterance: string): NavTarget | null;
  /** Turn an answer into a handoff the app knows how to open. */
  resolveHandoff?(answer: ChatAnswer): NavTarget | null;
  /** What to ask when a row in a records section is clicked. App-specific wording lives here. */
  rowAction?(module: string | undefined, row: ChatRecord): string | null;
  /** Perform an action that is not a chat message (open a record, run something). */
  performAction(action: ChatAction): Promise<void>;
  permissions(): { canSeeTrace: boolean; canUseVoice?: boolean };
  storage(): {
    namespace: string;
    get(key: string): string | null;
    set(key: string, value: string): void;
    remove(key: string): void;
  };
  starterPrompts(context: { route: string; module?: string }): Promise<ReadonlyArray<string>> | ReadonlyArray<string>;
  branding: { name: string; tagline?: string; placeholder?: string; accent?: string };
}
