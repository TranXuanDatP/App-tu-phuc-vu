CREATE TYPE "public"."user_profile_status" AS ENUM('incomplete', 'complete', 'no_match');--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "full_name" varchar(255);--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "address" varchar(512);--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "cccd" varchar(512);--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "cccd_hash" varchar(64);--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "profile_status" "user_profile_status" DEFAULT 'incomplete';--> statement-breakpoint
CREATE UNIQUE INDEX "idx_users_cccd_hash" ON "users" USING btree ("cccd_hash");