-- Mock customer store: cột cho MockCustomerServiceClient (binding side) dùng chung bảng.
-- Binding mock giữ created-customers trong RAM → BFF restart quên → resolve trả 'none'
-- cho số ĐÃ đăng ký → app vào nhánh register lại → REF-NEW-000001 trùng → insert binding
-- vi phạm unique (userId, customerRef) verified = lỗi "không lưu được db" (Pc 2026-08-21).
-- Giờ binding mock hydrate từ bảng này lúc gọi đầu tiên; create() ghi kèm customer_ref.
ALTER TABLE "mock_customer_store" ADD COLUMN "customer_ref" varchar(24);
--> statement-breakpoint
ALTER TABLE "mock_customer_store" ADD COLUMN "address_prefix" text;
--> statement-breakpoint
ALTER TABLE "mock_customer_store" ADD COLUMN "last_invoice_amount" varchar(32) DEFAULT '';
--> statement-breakpoint
CREATE UNIQUE INDEX "mock_customer_ref_idx" ON "mock_customer_store" ("customer_ref") WHERE "customer_ref" IS NOT NULL;
