import { readBoundedJson } from '../shared/http-client';
import type { ProjectReportInput, ProjectReportReceipt } from '../project-report-types';
import { projectUUID } from './project-client';
import { publicKeys, publicText } from './public-author-client';
export class ProjectReportClientError extends Error {
  constructor() {
    super('作品通報の確認結果を取得できませんでした。');
    this.name = 'ProjectReportClientError';
  }
}
export function validProjectReportInput(v: unknown): v is ProjectReportInput {
  return (
    publicKeys(v, ['reason', 'detail']) &&
    publicText(v.reason, 200) &&
    Boolean(v.reason.trim()) &&
    publicText(v.detail, 2000) &&
    new TextEncoder().encode(v.detail).length <= 8000
  );
}
/** Existing-cookie bounded transport; callers bind it to the verified session consumption guard. */
export async function projectReportRequest(
  path: string,
  fetcher: typeof fetch,
  signal?: AbortSignal,
  input?: ProjectReportInput,
  csrf?: string,
): Promise<unknown> {
  try {
    return await readBoundedJson(path, {
      fetcher,
      credentials: 'same-origin',
      method: input ? 'POST' : 'GET',
      status: input ? 201 : 200,
      maxBytes: 262144,
      signal,
      ...(input ? { body: input, csrf } : {}),
    });
  } catch {
    throw new ProjectReportClientError();
  }
}
export function createProjectReportClient(csrf: string, fetcher: typeof fetch = fetch) {
  const path = (id: string) => {
    if (!projectUUID(id)) throw new ProjectReportClientError();
    return '/api/private/project-reports/' + id;
  };
  return {
    async received(id: string, signal?: AbortSignal): Promise<ProjectReportReceipt> {
      const v = await projectReportRequest(path(id), fetcher, signal);
      if (!publicKeys(v, ['received']) || typeof v.received !== 'boolean')
        throw new ProjectReportClientError();
      return { received: v.received };
    },
    async report(
      id: string,
      input: ProjectReportInput,
      confirmed: boolean,
      signal?: AbortSignal,
    ): Promise<void> {
      if (!confirmed || !validProjectReportInput(input) || !/^[A-Za-z0-9_-]{43}$/.test(csrf))
        throw new ProjectReportClientError();
      const v = await projectReportRequest(path(id), fetcher, signal, input, csrf);
      if (!publicKeys(v, ['received']) || v.received !== true) throw new ProjectReportClientError();
    },
  };
}
