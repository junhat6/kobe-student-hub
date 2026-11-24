import type { ProjectStage } from '../project-types';
import Icon from './Icon';
import './project-stage.css';

export const PROJECT_STAGE_LABELS: Record<ProjectStage, string> = {
  in_progress: '制作中',
  complete: '完成',
};

/**
 * 制作中 is marked with a small icon (the accessible name is the label). 完成 is the default every
 * project had before #275, so it draws nothing and existing pages look exactly as before.
 */
export default function ProjectStageMark({ stage }: { stage?: ProjectStage }) {
  if (stage !== 'in_progress') return null;
  const label = PROJECT_STAGE_LABELS[stage];
  return (
    <span
      className="project-stage-mark"
      data-stage={stage}
      role="img"
      aria-label={label}
      title={label}
    >
      <Icon name="sprout" size={14} />
    </span>
  );
}
