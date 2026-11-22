import type { Profile } from './types';
export interface ProfileReportInput {
  reason: string;
  detail: string;
}
export interface ProfileReportReceipt {
  received: boolean;
}
export interface ProfileReportCaseSummary {
  profileId: string;
  displayName: string;
  reportCount: number;
  latestReportAt: number;
}
/** Operator-only view. `reported` is the public text each reporter saw, not the current profile. */
export interface ProfileReportCase {
  profile: Profile;
  reports: {
    reason: string;
    detail: string;
    receivedAt: number;
    reported: { name: string; department: string; year: string; bio: string };
  }[];
  reportsTruncated: boolean;
}
