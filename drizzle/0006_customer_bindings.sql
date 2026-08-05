-- customer_bindings: verified BINDING between a better-auth user and a customer record.
-- Second step of identity (OTP auth != binding proof). A user with no status='verified'
-- row is DENIED customer-data ports (BindingVerifiedGuard). customerId is AES-256-GCM
-- ciphertext (PiiEncryptionService), NULL until verify passes.
CREATE TABLE IF NOT EXISTS "customer_bindings" (
	"id" varchar(36) PRIMARY KEY NOT NULL,
	"user_id" varchar(256) NOT NULL,
	"customer_ref" varchar(128) NOT NULL,
	"customer_id" varchar(512),
	"status" varchar(20) DEFAULT 'pending' NOT NULL,
	"factor_used" varchar(50),
	"verified_at" timestamp with time zone,
	"device_info" varchar(512),
	"bound_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"revoked_reason" varchar(256),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_customer_bindings_customer_ref" ON "customer_bindings" USING btree ("customer_ref");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_customer_bindings_user_id" ON "customer_bindings" USING btree ("user_id");--> statement-breakpoint
-- At most one VERIFIED binding per (user, customer). Pending/revoked rows don't block re-bind.
CREATE UNIQUE INDEX IF NOT EXISTS "idx_customer_bindings_verified_unique" ON "customer_bindings" ("user_id", "customer_ref") WHERE "status" = 'verified';
