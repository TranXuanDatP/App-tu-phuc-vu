-- Đóng Single Source of Truth (sau PR #1/#2/#3 merge — 0 reader, 0 writer còn sống).
-- 1) Backfill TRƯỚC: mọi row profile_status='complete' hiện có đều là artifact proof-less
--    của check-reg phone-match cũ (verified: writer duy nhất từng tồn tại). Reset về
--    'incomplete' — event path (chưa build) mới là writer thật. Enum value 'complete'
--    ĐƯỢC GIỮ (event path tương lai dùng; ALTER TYPE DROP VALUE là irreversible).
-- 2) DROP cột users.customer_id (legacy phone-match, không index/FK phụ thuộc — verified).
UPDATE "users" SET "profile_status" = 'incomplete' WHERE "profile_status" = 'complete';--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN IF EXISTS "customer_id";
