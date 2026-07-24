-- OTP template seed for notification-be-rs (handoff to the platform team — NOT applied by the BFF).
-- Run against the `notification` Postgres DB as a new migration in
-- water-platform/platform-core/services/notification-be-rs/migrations/ (next number, e.g. 0018).
--
-- Schema (notification_template, per 0007 + 0011 category):
--   template_key PK, name, description, channels[], status, version, locales[],
--   content jsonb (per-channel Handlebars: email/sms/noti), provider jsonb,
--   category ('transactional'|'care'), updated_at, updated_by
--
-- BFF calls gRPC Send with: template_key='customer.otp', channels=['sms'],
-- recipients=[{ phone }], data_json='{"otp":"123456"}'.

INSERT INTO notification_template
  (template_key, name, description, channels, status, version, locales, content, provider, category, updated_at, updated_by)
VALUES (
  'customer.otp',
  'OTP xác thực đăng nhập',
  'Mã OTP đăng nhập app khách hàng (better-auth phoneNumber → notification-be-rs sms)',
  ARRAY['sms'],
  'approved',
  1,
  ARRAY['vi-VN'],
  '{"sms":{"text":"Ma xac thuc QUAWACO cua ban la {{otp}}. Co hieu luc trong 5 phut. Vui long khong chia se."}}'::jsonb,
  '{"sms":{"brandname":"HAWACO","approved":true}}'::jsonb,
  'transactional',
  now(),
  'system'
)
ON CONFLICT (template_key) DO NOTHING;
