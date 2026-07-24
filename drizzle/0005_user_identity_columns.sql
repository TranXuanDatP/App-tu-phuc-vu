DO $$ BEGIN
  CREATE TYPE "public"."user_profile_status" AS ENUM('incomplete', 'complete', 'no_match');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "customer_id" varchar(128);--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "full_name" varchar(255);--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "address" varchar(512);--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "cccd" varchar(512);--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "cccd_hash" varchar(64);--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "profile_status" "user_profile_status" DEFAULT 'incomplete';--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "idx_users_cccd_hash" ON "users" USING btree ("cccd_hash");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "idx_users_phone_hash" ON "users" USING btree ("phone_hash");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "idx_users_email_hash" ON "users" USING btree ("email_hash");
