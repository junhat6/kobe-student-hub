import { useCallback, useEffect, useState } from 'react';
import { proofAuthorization } from '../shared/auth-proof';

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
export interface AgentConnectionsState {
  connections: AgentConnection[];
  agentDraftIds: string[];
  hints: AgentDraftHints[];
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
  return {
    connections: connections.slice(0, 20),
    agentDraftIds: agentDraftIds.slice(0, 100),
    hints: hints.slice(0, 100),
  };
}

async function readJson(response: Response): Promise<unknown> {
  if (!/^application\/json/i.test(response.headers.get('Content-Type') ?? '')) return null;
  const body = await response.text();
  if (body.length > 256 * 1024) return null;
  return JSON.parse(body);
}

const BASE = '/api/private/agent-connections';
const READ: RequestInit = {
  credentials: 'same-origin',
  cache: 'no-store',
  redirect: 'error',
  headers: { Accept: 'application/json' },
};
/** Reading needs only the session cookie; changes also carry the CSRF proof. */
export async function listAgentConnections(
  fetcher: typeof fetch = fetch,
  signal?: AbortSignal,
): Promise<AgentConnectionsState | null> {
  const response = await fetcher(BASE, { ...READ, signal });
  return response.ok ? parseState(await readJson(response)) : null;
}

export function createAgentConnectionsClient(csrfToken: string, fetcher: typeof fetch = fetch) {
  const base = BASE;
  const write = (method: string, body?: unknown): RequestInit => ({
    method,
    credentials: 'same-origin',
    cache: 'no-store',
    redirect: 'error',
    headers: {
      Accept: 'application/json',
      Authorization: proofAuthorization('csrf', csrfToken),
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const read = READ;
  return {
    list: (signal?: AbortSignal) => listAgentConnections(fetcher, signal),
    async revoke(id: string): Promise<boolean> {
      if (!uuid.test(id)) return false;
      const response = await fetcher(base + '/' + id, write('DELETE'));
      return response.ok;
    },
    async readRequest(
      requestId: string,
      signal?: AbortSignal,
    ): Promise<ConsentRequest | 'signed-out' | 'unavailable'> {
      if (!/^[A-Za-z0-9_-]{43}$/.test(requestId)) return 'unavailable';
      const response = await fetcher(base + '/requests/' + requestId, { ...read, signal });
      if (response.status === 401) return 'signed-out';
      if (!response.ok) return 'unavailable';
      const v = (await readJson(response)) as Record<string, unknown> | null;
      return v && text(v.clientName, 100) && text(v.destination, 300) && text(v.scope, 40)
        ? { clientName: v.clientName, destination: v.destination, scope: v.scope }
        : 'unavailable';
    },
    async decide(
      requestId: string,
      decision: 'allow' | 'deny',
    ): Promise<{ redirectTo: string } | 'too-many' | 'unavailable'> {
      if (!/^[A-Za-z0-9_-]{43}$/.test(requestId)) return 'unavailable';
      const response = await fetcher(base + '/requests/' + requestId, write('POST', { decision }));
      if (response.status === 409) return 'too-many';
      if (!response.ok) return 'unavailable';
      const v = (await readJson(response)) as Record<string, unknown> | null;
      if (!v || typeof v.redirectTo !== 'string') return 'unavailable';
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
  return state;
}
