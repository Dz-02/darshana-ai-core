/**
 * The chatbot contract: one interface, any number of engines.
 *
 * LMS K12 and G2G each keep the engine they already run. The shared chat UI and
 * every other consumer depend only on `ChatEngine`, so the engine behind it can
 * be swapped, or a new application can bring its own, without touching the UI.
 */
import type { AppContext } from './adapter';

export interface ChatRequest {
  message: string;
  conversationId?: string;
  module?: string;
  route?: string;
  /** Page context the UI wants the engine to see. Opaque to the contract. */
  payload?: Readonly<Record<string, unknown>>;
}

export type ChatActionType = 'navigate' | 'open' | 'execute' | 'confirm';

/** Something the UI may offer the user to do next. The UI renders it; the host app performs it. */
export interface ChatAction {
  type: ChatActionType;
  label: string;
  payload: Readonly<Record<string, unknown>>;
}

export interface ChatAnswer {
  text: string;
  actions?: ReadonlyArray<ChatAction>;
  suggestions?: ReadonlyArray<string>;
  /** Engine-defined rich blocks (tables, cards). The UI ignores kinds it does not know. */
  blocks?: ReadonlyArray<{ kind: string; data: unknown }>;
}

export interface ChatReply {
  appId: string;
  conversationId: string;
  answer: ChatAnswer;
}

export type ChatStreamEvent =
  | { type: 'delta'; text: string }
  | { type: 'action'; action: ChatAction }
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
