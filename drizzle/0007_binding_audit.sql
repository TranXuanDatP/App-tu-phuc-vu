-- binding_audit: append-only forensic audit cho mọi binding mutation (SPEC-A4-A1 §A1.5).
-- user_id RAW (joinable forensics — hash chỉ dùng cho LOG lines); detail = reason code
-- máy đọc được (verify_failed | foreign_ref_rejected | lockout:… | factor:…).
CREATE TABLE IF NOT EXISTS "binding_audit" (
	"id" varchar(36) PRIMARY KEY NOT NULL,
	"user_id" varchar(256) NOT NULL,
	"customer_ref" varchar(128),
	"action" varchar(32) NOT NULL,
	"success" boolean NOT NULL,
	"detail" varchar(256),
	"ip" varchar(64),
	"device_info" varchar(512),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_binding_audit_user_id" ON "binding_audit" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_binding_audit_created_at" ON "binding_audit" USING btree ("created_at");
