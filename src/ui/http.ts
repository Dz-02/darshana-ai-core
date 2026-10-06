/**
 * The one HTTP client for an application's AI API.
 *
 * Both reference applications already speak the same envelope — `{success, message, data,
 * errors}` — and each carried its own copy of this client. This is that client with every
 * environmental decision moved behind `AiTransportPort`: the core builds `apiBase + path`,
 * attaches whatever headers the adapter returns, and unwraps the envelope. It names no
 * host, header, tenant or storage key of its own.
 */
import type { AiTransportPort } from './ports';

export interface AiEnvelope<T> {
  success: boolean;
  message: string;
  data: T | null;
  errors?: Record<string, string[]> | null;
}

/** A failed AI API call. `fieldErrors` carries per-field validator messages for forms. */
export class AiApiError extends Error {
  readonly status: number;
  readonly fieldErrors: Record<string, string[]>;

  constructor(message: string, status: number, fieldErrors: Record<string, string[]> = {}) {
    super(message);
    this.name = 'AiApiError';
    this.status = status;
    this.fieldErrors = fieldErrors;
  }
}

export type AiHttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export interface AiHttpClient {
  request<T>(path: string, method?: AiHttpMethod, body?: unknown): Promise<T>;
}

/** The part of `fetch` the client uses, so the core needs no DOM lib and tests can fake it. */
export interface AiFetchInit {
  method: string;
  cache?: 'no-store';
  headers: Record<string, string>;
  body?: string;
}

export type FetchLike = (input: string, init?: AiFetchInit) => Promise<{ ok: boolean; status: number; text(): Promise<string> }>;

export function createAiHttpClient(transport: AiTransportPort, fetchImpl?: FetchLike): AiHttpClient {
  return {
    async request<T>(path: string, method: AiHttpMethod = 'GET', body?: unknown): Promise<T> {
      const session = transport.session();

      if (!session?.token) throw new AiApiError('Sign in to use AI & Intelligence.', 401);

      const send = fetchImpl ?? ((input, init) => fetch(input, init as never));
      const hasBody = body !== undefined;
      const response = await send(`${transport.apiBase('ai', session.baseUrlHint)}${path}`, {
        method,
        cache: 'no-store',
        headers: { Accept: 'application/json', ...transport.headers(session, { json: hasBody }) },
        ...(hasBody ? { body: JSON.stringify(body) } : {}),
      });

      const text = await response.text();
      let payload: AiEnvelope<T>;

      try {
        payload = (text.trim() ? JSON.parse(text) : {}) as AiEnvelope<T>;
      } catch {
        throw new AiApiError('The AI service returned a non-JSON response.', response.status);
      }

      if (!response.ok || payload.success === false) {
        throw new AiApiError(
          payload.message || `The request failed (${response.status}).`,
          response.status,
          payload.errors ?? {},
        );
      }

      return payload.data as T;
    },
  };
}

/** The most useful sentence an error carries: the first field error, else the message. */
export function describeAiError(cause: unknown, fallback = 'The request failed.'): string {
  if (cause instanceof AiApiError) {
    const first = Object.values(cause.fieldErrors ?? {}).flat()[0];

    return first || cause.message || fallback;
  }

  return cause instanceof Error ? cause.message : fallback;
}
