import { useState } from 'react';
import { Button } from '@base-ui/react/button';
import { createAgentConnectionsClient, type AgentDraftProject } from '../agent/connections-client';

/** The project's journal mark: a small notebook, decorative beside the words that say it. */
export function JournalIcon() {
  return (
    <svg
      className="agent-project-icon"
      aria-hidden="true"
      focusable="false"
      viewBox="0 0 16 16"
      width="14"
      height="14"
    >
      <path
        d="M4 1.5h8A1.5 1.5 0 0 1 13.5 3v10a1.5 1.5 0 0 1-1.5 1.5H4A1.5 1.5 0 0 1 2.5 13V3A1.5 1.5 0 0 1 4 1.5ZM5.5 1.5v13M7.5 5h4M7.5 7.5h4"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
      />
    </svg>
  );
}

export const projectName = (p: AgentDraftProject) => p.projectTitle || '無題の作品';

/**
 * Publishing confirmation (#285): an agent attached this draft to the owner's project, so the
 * first publication adds it to that project's journal. The owner can remove it before publishing.
 */
export function AgentProjectNotice({
  project,
  csrfToken,
  fetcher,
  disabled,
  onRemoved,
}: {
  project: AgentDraftProject;
  csrfToken: string;
  fetcher: typeof fetch;
  disabled: boolean;
  onRemoved: (draftId: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  async function remove() {
    setBusy(true);
    setFailed(false);
    const removed = await createAgentConnectionsClient(csrfToken, fetcher)
      .unlinkDraftProject(project.draftId)
      .catch(() => false);
    setBusy(false);
    if (removed) onRemoved(project.draftId);
    else setFailed(true);
  }
  return (
    <div className="agent-project-notice" role="note">
      <p>
        <JournalIcon />
        <span>
          公開すると、作品「{projectName(project)}
          」の制作日誌に入ります（AIエージェントが紐づけました）。
        </span>
      </p>
      <Button
        className="editor-link-button"
        disabled={disabled || busy}
        onClick={() => void remove()}
      >
        {busy ? '外しています…' : '制作日誌に入れない'}
      </Button>
      {failed && (
        <p className="agent-project-error" role="alert">
          紐づけを外せませんでした。時間をおいて、もう一度押してください。
        </p>
      )}
    </div>
  );
}
