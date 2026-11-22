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
  /** Current icon (versioned public path), so the operator removes exactly what they saw. */
  avatar: string | null;
  reports: {
    reason: string;
    detail: string;
    receivedAt: number;
    reported: { name: string; department: string; year: string; bio: string };
  }[];
  reportsTruncated: boolean;
}
export interface ProfileAvatarRemovalInput {
  /** The 16-hex version the operator reviewed; a newer icon is not removed by mistake. */
  avatar: string;
  reason: string;
}
