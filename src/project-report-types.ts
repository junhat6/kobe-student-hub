import type { PublicProject } from './project-types';
import type { Profile } from './types';
export interface ProjectReportInput {
  reason: string;
  detail: string;
}
export interface ProjectReportReceipt {
  received: boolean;
}
export type ProjectReviewStatus = 'published' | 'hidden' | 'deleted';
export interface ProjectReportCaseSummary {
  projectId: string;
  title: string;
  status: ProjectReviewStatus;
  latestReportAt: number;
}
export interface ProjectReportCase {
  project: PublicProject;
  author: Profile;
  status: ProjectReviewStatus;
  reports: { reason: string; detail: string; receivedAt: number }[];
  reportsTruncated: boolean;
}
