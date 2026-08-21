-- Hậu cứ durable cho mock customer store (khách tạo qua register/create-customer).
-- Trước đây in-memory → BFF restart mất khách → get-profile fallback fixture chung
-- = user thấy hồ sơ người khác (bug 2026-08-21). Đánh số APP-NNNNNN tiếp tục từ max.
CREATE TABLE "mock_customer_store" (
	"customer_id" varchar(32) PRIMARY KEY NOT NULL,
	"phone" varchar(20),
	"full_name" text NOT NULL,
	"classification" varchar(20) NOT NULL,
	"address" jsonb NOT NULL,
	"contact_info" jsonb,
	"status" varchar(20) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "mock_customer_phone_idx" ON "mock_customer_store" ("phone");
