import type { Profile } from './types';
import type { ProfileLink } from './shared/profile-links';
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
  /** Current links (#313), shown as text so the operator sees exactly what is stored. */
  links: ProfileLink[];
  reports: {
    reason: string;
    detail: string;
    receivedAt: number;
    /** links: what the profile linked to when reported; null = not recorded (before #313). */
    reported: {
      name: string;
      department: string;
      year: string;
      bio: string;
      links: ProfileLink[] | null;
    };
  }[];
  reportsTruncated: boolean;
}
export interface ProfileAvatarRemovalInput {
  /** The 16-hex version the operator reviewed; a newer icon is not removed by mistake. */
  avatar: string;
  reason: string;
}
