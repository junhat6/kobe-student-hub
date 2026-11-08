export type EmailDeliveryState = 'pending' | 'ready' | 'leased' | 'accepted' | 'failed' | 'unknown';
export interface EmailDeliverySummary {
  outboxId: string;
  contentId: string;
  event: 'report_received' | 'temporarily_hidden';
  reportCount: number;
  createdAt: number;
  state: EmailDeliveryState;
  attempts: number;
  retryCommandId: string | null;
}
export interface OwnModerationNotice {
  id: string;
  contentId: string;
  title: string;
  kind: 'temporarily_hidden' | 'restored' | 'deleted';
  reason: string;
  createdAt: number;
}
