import { useCallback, useEffect, useState } from 'react';
import {
  boundedReadFailure,
  readBoundedJson,
  type BoundedReadFailure,
} from '../shared/http-client';

/** The student's own AI agent connections. Server identity and ownership stay authoritative. */
export interface AgentConnection {
  id: string;
  clientName: string;
  createdAt: number;
  lastUsedAt: number;
  expiresAt: number;
}
export interface AgentDraftHints {
  draftId: string;
  summary: string;
  tags: string[];
}
/** The owner's project an agent attached to a not-yet-published draft (#285). Owner only. */
export interface AgentDraftProject {
  draftId: string;
  projectId: string;
  projectTitle: string;
}
export interface AgentConnectionsState {
  connections: AgentConnection[];
  agentDraftIds: string[];
  hints: AgentDraftHints[];
  draftProjects: AgentDraftProject[];
}
export interface ConsentRequest {
  clientName: string;
  destination: string;
  scope: string;
}

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const time = (v: unknown): v is number =>
  typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;
const text = (v: unknown, max: number): v is string => typeof v === 'string' && v.length <= max;

function parseState(value: unknown): AgentConnectionsState | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as Record<string, unknown>;
  if (!Array.isArray(v.connections) || !Array.isArray(v.agentDraftIds) || !Array.isArray(v.hints))
    return null;
  const connections = v.connections.filter(
    (c): c is AgentConnection =>
      c &&
      typeof c === 'object' &&
      typeof c.id === 'string' &&
      uuid.test(c.id) &&
      text(c.clientName, 100) &&
      time(c.createdAt) &&
      time(c.lastUsedAt) &&
      time(c.expiresAt),
  );
  const agentDraftIds = v.agentDraftIds.filter(
    (id): id is string => typeof id === 'string' && uuid.test(id),
  );
  const hints = v.hints.filter(
    (h): h is AgentDraftHints =>
      h &&
      typeof h === 'object' &&
      typeof h.draftId === 'string' &&
      uuid.test(h.draftId) &&
      text(h.summary, 300) &&
      Array.isArray(h.tags) &&
      h.tags.length <= 5 &&
      h.tags.every((t: unknown) => text(t, 24)),
  );
  // Older Workers do not send it; an absent list means nothing is attached.
  const draftProjects = (Array.isArray(v.draftProjects) ? v.draftProjects : []).filter(
    (p): p is AgentDraftProject =>
      p &&
      typeof p === 'object' &&
      typeof p.draftId === 'string' &&
      uuid.test(p.draftId) &&
      typeof p.projectId === 'string' &&
      uuid.test(p.projectId) &&
      text(p.projectTitle, 200),
  );
  return {
    connections: connections.slice(0, 20),
    agentDraftIds: agentDraftIds.slice(0, 100),
    hints: hints.slice(0, 100),
    draftProjects: draftProjects.slice(0, 100),
  };
}

const BASE = '/api/private/agent-connections';
/** Every answer here is a small private DTO; the list is capped at 20 + 100 + 100 + 100 rows. */
const MAX_BYTES = 262144;
const requestId = /^[A-Za-z0-9_-]{43}$/;

/**
 * The bounded transport (src/shared/http-client.ts): session cookie, no-store, no redirect,
 * exact 200, JSON only, size and time caps. Changes also carry the CSRF proof and are never
 * retried. Failures come back as a kind only, never with a body, URL or identity.
 */
async function call(
  path: string,
  fetcher: typeof fetch,
  options: { method?: 'DELETE' | 'POST'; body?: unknown; csrf?: string; signal?: AbortSignal },
): Promise<{ value: unknown } | { failure: BoundedReadFailure }> {
  try {
    return {
      value: await readBoundedJson(path, {
        fetcher,
        credentials: 'same-origin',
        method: options.method ?? 'GET',
        ...(options.body === undefined ? {} : { body: options.body }),
        ...(options.csrf === undefined ? {} : { csrf: options.csrf }),
        maxBytes: MAX_BYTES,
        signal: options.signal,
      }),
    };
  } catch (error) {
    return { failure: boundedReadFailure(error) };
  }
}

/** Reading needs only the session cookie; changes also carry the CSRF proof. */
export async function listAgentConnections(
  fetcher: typeof fetch = fetch,
  signal?: AbortSignal,
): Promise<AgentConnectionsState | null> {
  const result = await call(BASE, fetcher, { signal });
  return 'value' in result ? parseState(result.value) : null;
}

export function createAgentConnectionsClient(csrfToken: string, fetcher: typeof fetch = fetch) {
  return {
    list: (signal?: AbortSignal) => listAgentConnections(fetcher, signal),
    async revoke(id: string): Promise<boolean> {
      if (!uuid.test(id)) return false;
      const result = await call(BASE + '/' + id, fetcher, { method: 'DELETE', csrf: csrfToken });
      if (!('value' in result)) return false;
      const v = result.value as Record<string, unknown> | null;
      return Boolean(v && typeof v === 'object' && v.revoked === true);
    },
    /** Removes the project an agent attached to the owner's draft (#285). Never retried. */
    async unlinkDraftProject(draftId: string): Promise<boolean> {
      if (!uuid.test(draftId)) return false;
      const result = await call(BASE + '/draft-projects/' + draftId, fetcher, {
        method: 'DELETE',
        csrf: csrfToken,
      });
      if (!('value' in result)) return false;
      const v = result.value as Record<string, unknown> | null;
      return Boolean(v && typeof v === 'object' && v.removed === true);
    },
    async readRequest(
      id: string,
      signal?: AbortSignal,
    ): Promise<ConsentRequest | 'signed-out' | 'unavailable'> {
      if (!requestId.test(id)) return 'unavailable';
      const result = await call(BASE + '/requests/' + id, fetcher, { signal });
      if (!('value' in result))
        return result.failure === 'signed-out' ? 'signed-out' : 'unavailable';
      const v = result.value as Record<string, unknown> | null;
      return v &&
        typeof v === 'object' &&
        text(v.clientName, 100) &&
        text(v.destination, 300) &&
        text(v.scope, 40)
        ? { clientName: v.clientName, destination: v.destination, scope: v.scope }
        : 'unavailable';
    },
    async decide(
      id: string,
      decision: 'allow' | 'deny',
    ): Promise<{ redirectTo: string } | 'too-many' | 'unavailable'> {
      if (!requestId.test(id)) return 'unavailable';
      const result = await call(BASE + '/requests/' + id, fetcher, {
        method: 'POST',
        body: { decision },
        csrf: csrfToken,
      });
      if (!('value' in result)) return result.failure === 'conflict' ? 'too-many' : 'unavailable';
      const v = result.value as Record<string, unknown> | null;
      if (!v || typeof v !== 'object' || typeof v.redirectTo !== 'string') return 'unavailable';
      try {
        const url = new URL(v.redirectTo);
        return url.protocol === 'https:' || url.protocol === 'http:'
          ? { redirectTo: url.toString() }
          : 'unavailable';
      } catch {
        return 'unavailable';
      }
    },
  };
}

/** Which drafts an agent made, and the summary/tag suggestions it left. Empty when closed. */
export function useAgentDrafts(enabled: boolean, fetcher: typeof fetch, refreshKey: unknown) {
  const [state, setState] = useState<AgentConnectionsState | null>(null);
  const load = useCallback(
    (signal?: AbortSignal) => {
      if (!enabled) return;
      listAgentConnections(fetcher, signal)
        .then((value) => {
          if (!signal?.aborted) setState(value);
        })
        .catch(() => {});
    },
    [enabled, fetcher],
  );
  useEffect(() => {
    const controller = new AbortController();
    load(controller.signal);
    return () => controller.abort();
  }, [load, refreshKey]);
  /** After the server confirmed the removal, the draft shows no project until the next read. */
  const dropDraftProject = useCallback(
    (draftId: string) =>
      setState((s) =>
        s ? { ...s, draftProjects: s.draftProjects.filter((p) => p.draftId !== draftId) } : s,
      ),
    [],
  );
  return [state, dropDraftProject] as const;
}
