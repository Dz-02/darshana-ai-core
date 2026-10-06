/**
 * Agent Management — the data model.
 *
 * Two tables and nothing else. An `Agent` is a configuration a person creates:
 * which module it belongs to, which tools it may call, what it is for. An
 * `AgentRun` is one execution of that configuration, written once and never
 * edited — it is the audit record, so it carries the *caller's* identity, not
 * the agent's. There is no agent identity anywhere in this model on purpose:
 * an agent can only ever do what the person who pressed Run is allowed to do.
 */

/** Module keys are strings so a new module needs a registry entry, not a type change. */
export type AgentModuleKey = string;

export type AgentStatus = 'draft' | 'active' | 'paused' | 'archived';

export type AgentTrigger = 'manual' | 'scheduled';

export interface Agent {
  /** `agt_` + 12 hex chars. Shown in mono. */
  id: string;
  name: string;
  description: string;
  /** Which module owns this agent — decides its tool catalogue and RBAC key. */
  module: AgentModuleKey;
  /** `sub_institute_id` of the creating session. Every read is scoped by it. */
  tenant_id: string;
  /** Tool keys from the module's catalogue. The server rejects anything else. */
  tools_allowed: string[];
  /** What the agent is for, in the operator's words. Becomes the system prompt later. */
  instructions: string;
  /** v1 agents run when a person presses Run; `scheduled` is reserved. */
  trigger: AgentTrigger;
  status: AgentStatus;
  created_by: string;
  created_by_name: string;
  created_at: string;
  updated_at: string;
}

export type AgentRunStatus = 'success' | 'failure' | 'denied';

export type AgentRunTrigger = 'manual' | 'scheduled' | 'api';

export interface AgentRun {
  /** `run_` + 12 hex chars. */
  id: string;
  agent_id: string;
  /** Denormalised so the log reads without a join, and survives a rename. */
  agent_name: string;
  module: AgentModuleKey;
  tenant_id: string;
  started_at: string;
  finished_at: string;
  duration_ms: number;
  /** The person who ran it — the LMS user id from the session, never a service account. */
  acting_user_id: string;
  acting_user_name: string;
  /** The caller's role at the moment of the run, for the audit reader. */
  acting_profile_id: string;
  acting_profile_name: string;
  trigger: AgentRunTrigger;
  input: Record<string, unknown>;
  output: Record<string, unknown> | null;
  /** The tools actually called — always a subset of the agent's `tools_allowed`. */
  tools_used: string[];
  status: AgentRunStatus;
  error: string | null;
}

/** What a caller supplies to create an agent. Everything else the engine fills in. */
export interface CreateAgentInput {
  name: string;
  description?: string;
  module: AgentModuleKey;
  tools_allowed: string[];
  instructions?: string;
  status?: Extract<AgentStatus, 'draft' | 'active'>;
}

/** What a caller supplies to run an agent: one tool from its allow-list, plus arguments. */
export interface RunAgentInput {
  /** Omit to run the first available tool on the agent's allow-list. */
  tool?: string;
  arguments?: Record<string, unknown>;
}

/** The person on whose authority an engine call happens. Read from the session, never from the body. */
export interface ActingUser {
  tenant_id: string;
  user_id: string;
  user_name: string;
  profile_id: string;
  profile_name: string;
}
