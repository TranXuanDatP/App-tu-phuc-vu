-- Chat outbox (store-and-forward — Pc chốt 2026-08-19: tin phải được nhận kể cả khi
-- omnichannel_be chết). Persist-first trong POST /call-center/message; forwarder nền
-- đẩy row chưa forwarded (idempotent theo message_id — receiver dedupe); get-conversation
-- merge outbox + thread omnichannel (dedup theo message_id).
CREATE TABLE "chat_outbox" (
	"message_id" uuid PRIMARY KEY NOT NULL,
	"user_id" varchar(64) NOT NULL,
	"text" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"forwarded_at" timestamp with time zone
);
--> statement-breakpoint
CREATE INDEX "chat_outbox_user_idx" ON "chat_outbox" ("user_id");
