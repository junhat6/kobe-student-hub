-- Delivery receipts are separate from immutable report/decision events.
-- No sender, recipient, grant, schedule or external delivery is configured here.
CREATE TABLE moderation_email_deliveries (
 outbox_id TEXT NOT NULL PRIMARY KEY REFERENCES article_report_outbox(id),
 state TEXT NOT NULL CHECK(state IN ('ready','leased','accepted','failed','unknown')),
 attempts INTEGER NOT NULL CHECK(typeof(attempts)='integer' AND attempts BETWEEN 1 AND 3),
 lease_token TEXT CHECK(lease_token IS NULL OR length(lease_token)=36),
 lease_until_ms INTEGER CHECK(lease_until_ms IS NULL OR (typeof(lease_until_ms)='integer' AND lease_until_ms BETWEEN 0 AND 253402300799999)),
 provider_message_id TEXT CHECK(provider_message_id IS NULL OR (length(provider_message_id) BETWEEN 1 AND 256 AND instr(provider_message_id,char(0))=0)),
 retry_command_id TEXT CHECK(retry_command_id IS NULL OR length(retry_command_id)=36),
 updated_at_ms INTEGER NOT NULL CHECK(typeof(updated_at_ms)='integer' AND updated_at_ms BETWEEN 0 AND 253402300799999),
 CHECK((state='leased' AND lease_token IS NOT NULL AND lease_until_ms IS NOT NULL) OR (state<>'leased' AND lease_token IS NULL AND lease_until_ms IS NULL)),
 CHECK((state='accepted' AND provider_message_id IS NOT NULL) OR (state<>'accepted' AND provider_message_id IS NULL))
);
CREATE INDEX moderation_email_state ON moderation_email_deliveries(state,updated_at_ms,outbox_id);
