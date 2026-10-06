/**
 * The chatbot contract: one interface, any number of engines.
 *
 * LMS K12 and G2G each keep the engine they already run. The shared chat UI and
 * every other consumer depend only on `ChatEngine`, so the engine behind it can
 * be swapped, or a new application can bring its own, without touching the UI.
 */
import type { AppContext, EntityRef } from './adapter';

/** One earlier turn, for engines that are handed the transcript rather than keeping it. */
export interface ChatTurn {
  role: 'user' | 'assistant';
  content: string;
}

export interface ChatRequest {
  message: string;
  conversationId?: string;
  /** Earlier turns, oldest first, excluding `message`. Engines that keep their own history ignore it. */
  history?: ReadonlyArray<ChatTurn>;
  module?: string;
  route?: string;
  /** Page context the UI wants the engine to see. Opaque to the contract. */
  payload?: Readonly<Record<string, unknown>>;
  /** A destination the client already resolved from the message, so the engine can short-circuit. */
  navigation?: NavTarget;
  /** The module that offered the action being clicked, when the message comes from an action. */
  actionModule?: string;
}

/**
 * `ask` sends `utterance` back to the engine as the next message; `decision` is an
 * approve / reject / defer that the engine resolves against `decisionRef`.
 */
export type ChatActionType = 'navigate' | 'open' | 'execute' | 'confirm' | 'ask' | 'decision';

/** Something the UI may offer the user to do next. The UI renders it; the host app performs it. */
export interface ChatAction {
  type: ChatActionType;
  label: string;
  payload: Readonly<Record<string, unknown>>;
  /** Stable id, so the UI can key and de-duplicate. */
  key?: string;
  /** For `ask` / `decision`: the text sent as the next message. */
  utterance?: string;
  /** Semantic id such as `approve`; the UI never interprets it beyond styling. */
  intent?: string;
  style?: 'default' | 'primary' | 'danger';
  /** Pins the record a decision applies to. Opaque ids: the core has no entity semantics. */
  decisionRef?: { kind: string; id: string };
}

// ── Rich answer vocabulary ────────────────────────────────────────────────────
// All optional and additive. Every one is a shape the UI can draw without knowing
// which application produced it; an engine fills only what it has.

export interface ChatRecord {
  id?: string;
  title: string;
  badge?: string;
  lines?: ReadonlyArray<string>;
  meta?: Readonly<Record<string, string>>;
  entity?: EntityRef;
  action?: ChatAction;
}

export interface ChatEvidence {
  id?: string;
  kind?: string;
  summary: string;
  value?: string;
  /** Where the fact came from, as the engine names it (a record reference or "computed"). */
  source: string;
  observedAt?: string;
  /** True only when the engine checked it against stored data. */
  verified: boolean;
  /** True when a model produced it rather than a lookup. */
  generated: boolean;
}

export interface ChatStep {
  key: string;
  label: string;
  status: 'pending' | 'running' | 'done' | 'failed' | 'skipped';
}

export type ChatSection =
  | { type: 'text'; title?: string; body: string }
  | { type: 'key_values'; title?: string; items: ReadonlyArray<{ label: string; value: string }> }
  | { type: 'records'; title?: string; items: ReadonlyArray<ChatRecord> }
  | { type: 'evidence'; title?: string; items: ReadonlyArray<ChatEvidence> }
  | { type: 'steps'; title?: string; items: ReadonlyArray<ChatStep> }
  | { type: 'comparison'; title?: string; items: ReadonlyArray<Readonly<Record<string, unknown>>> }
  /** A kind this version of the UI does not know. It is skipped, never an error. */
  | { type: string; title?: string; data: unknown };

export interface ChatCitation {
  source: string;
  label?: string;
  available: boolean;
  note?: string;
}

export interface ChatApproval {
  id: string;
  kind: string;
  title: string;
  rationale?: string;
  confidence?: number;
  risk?: 'low' | 'medium' | 'high';
  requiresApproval: boolean;
  status: 'pending' | 'approved' | 'rejected' | 'deferred' | 'expired' | 'executed';
  evidenceIds?: ReadonlyArray<string>;
  actions: ReadonlyArray<ChatAction>;
}

export interface NavTarget {
  route: string;
  query?: Readonly<Record<string, string | number>>;
  label?: string;
  title?: string;
  description?: string;
  entity?: EntityRef;
}

export interface ChatHandoff {
  target: NavTarget;
  /** True while a decision is pending, so the UI holds the handoff back until it is resolved. */
  suppressedByPendingDecision?: boolean;
}

export interface ChatModuleContext {
  key: string;
  label?: string;
  capabilities?: Readonly<Record<string, boolean>>;
  reachesAction?: boolean;
  depthReason?: string;
}

export type ProgressStatus = 'ran' | 'skipped' | 'blocked' | 'pending' | 'not_reached';

/** One stage of an engine's lifecycle. The number and names of stages belong to the engine. */
export interface ChatProgressStep {
  key: string;
  order: number;
  layer: string;
  status: ProgressStatus;
  summary: string;
  component?: string;
  surface?: string;
  durationMs?: number;
  note?: string;
  data?: Readonly<Record<string, unknown>>;
  records?: { source?: string; ids?: ReadonlyArray<string | number> };
}

export interface ChatOutcome {
  metricKey: string;
  label?: string;
  baseline?: number;
  target?: number;
  observed?: number;
  delta?: number;
  status: 'pending' | 'measuring' | 'improved' | 'unchanged' | 'worsened' | 'inconclusive';
}

export interface ChatAnswer {
  text: string;
  actions?: ReadonlyArray<ChatAction>;
  suggestions?: ReadonlyArray<string>;
  /** Engine-defined rich blocks (tables, cards). The UI ignores kinds it does not know. */
  blocks?: ReadonlyArray<{ kind: string; data: unknown }>;
  /** Engine-defined diagnostics (status, tools used). Passed through; the core never interprets it. */
  meta?: Readonly<Record<string, unknown>>;
  /** The one-line answer the UI draws above `sections`. `text` remains the plain-text fallback. */
  headline?: string;
  sections?: ReadonlyArray<ChatSection>;
  citations?: ReadonlyArray<ChatCitation>;
  approvals?: ReadonlyArray<ChatApproval>;
  handoff?: ChatHandoff;
  module?: ChatModuleContext;
  intent?: { key: string; label?: string; confidence?: number };
  /** The settled lifecycle, in the engine's own stages. */
  trace?: ReadonlyArray<ChatProgressStep>;
  outcomes?: ReadonlyArray<ChatOutcome>;
  status?: 'ok' | 'blocked' | 'streaming';
}

export interface ChatReply {
  appId: string;
  conversationId: string;
  answer: ChatAnswer;
  /** Position in the conversation and the engine's human-readable reference, when it has them. */
  turn?: number;
  reference?: string;
}

export type ChatStreamEvent =
  | { type: 'delta'; text: string }
  | { type: 'action'; action: ChatAction }
  | { type: 'progress'; step: ChatProgressStep }
  | { type: 'handoff'; handoff: ChatHandoff }
  | { type: 'done'; reply: ChatReply }
  | { type: 'error'; code: string; message: string };

export interface ConversationSummary {
  appId: string;
  conversationId: string;
  title: string;
  updatedAt: string;
}

export interface ChatEngine {
  /** Names the engine for diagnostics, e.g. `lms-lifecycle`, `g2g-grounded`. */
  readonly engineId: string;
  /** The app whose data this engine reads. Must equal `ctx.appId` on every call. */
  readonly appId: string;
  readonly capabilities: { readonly streaming: boolean; readonly history: boolean };

  send(ctx: AppContext, request: ChatRequest): Promise<ChatReply>;
  /** Present only when `capabilities.streaming` is true. */
  stream?(ctx: AppContext, request: ChatRequest): AsyncIterable<ChatStreamEvent>;
  /** Present only when `capabilities.history` is true. */
  listConversations?(ctx: AppContext): Promise<ConversationSummary[]>;
}
