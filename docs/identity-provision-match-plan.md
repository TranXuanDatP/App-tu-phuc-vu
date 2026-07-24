# Plan: Tạo mới + match định danh khách hàng (customerUserId) cho in-app/push

## Mục tiêu
Sau khi khách **xác thực (better-auth)** + **liên kết mã KH**, đảm bảo có một `customerUserId`
(định danh platform mà notification khóa inbox/push theo) + một **mapping bền vững ở BFF**,
để về sau gửi in-app/push **đúng người**.

**Giả định (kịch bản này):** Customer 360 **KHÔNG** trả sẵn `customerUserId` → phải **tạo mới**
(provision) + **match**. Áp **mock-first** (như PortRegistry): build được ngay với provisioner
giả, swap sang platform thật sau — luồng không đổi.

## Ranh giới
- Mapping thuộc **auth/account capability trong BFF** (nơi duy nhất được phép giữ state).
- **KHÔNG chặn** display + sms/email — chúng chạy ngay chỉ với mã KH + phone/email, không cần bước này.
- `customerUserId` là định danh nội bộ platform — **không lộ ra mobile/app**.

## Anchor: định danh theo NGƯỜI, không theo hợp đồng
`customerUserId` gắn 1:1 với **better-auth user** (người dùng app), **không** với mã KH.
Lý do: in-app/push gửi cho *người đang dùng app*, không phải *chủ hợp đồng*. Một người : N mã KH.

## Schema (BFF)
```
customer_identity
  better_auth_user_id   PK        -- người (anchor)
  customer_user_id      unique, nullable  -- định danh platform; null tới khi provision xong
  status                            -- pending | provisioned
  provisioned_at

customer_link
  better_auth_user_id
  ma_kh                             -- N mã KH per người
  linked_at
  (unique: better_auth_user_id + ma_kh)
```
phone/email lấy từ Customer 360 khi gửi — không nhất thiết lưu (PII, NĐ13).

## Port provisioner (mock-first — build ngay)
```ts
interface IdentityProvisioner {
  // idempotent theo better_auth_user_id: gọi lại trả cùng customerUserId
  ensureIdentity(input: { betterAuthUserId: string; phone?: string; email?: string }):
    Promise<{ customerUserId: string }>;
}
```
- **MockProvisioner** (giờ): sinh UUID **ổn định, deterministic** theo `betterAuthUserId` → build/test đầu-cuối ngay, không chờ platform.
- **PlatformProvisioner** (sau): gọi cơ chế provisioning của platform (Keycloak/registry) → nhận UUID thật, idempotent.
- Bind qua config `IDENTITY_PROVISIONER = mock | platform` — swap không đụng luồng.

## Luồng tạo-mới + match (tại `POST /account/link`)
1. (đã xác thực better-auth) khách nhập/quét mã KH.
2. BFF **verify mã KH** với Customer 360 → hồ sơ (tên, phone, email).
3. **Lấy/tạo identity** (đọc `customer_identity` theo `better_auth_user_id`):
   - Có `customer_user_id` → skip provision.
   - Chưa → `provisioner.ensureIdentity(...)` (mock giờ / platform sau) → nhận `customer_user_id` → lưu, `status=provisioned`.
4. **Match**: thêm `(better_auth_user_id, ma_kh)` vào `customer_link` (idempotent — trùng thì bỏ qua).
5. Trả app: "liên kết OK". **Không** trả `customerUserId` ra app.

## Gửi về sau (resolve khi có event nghiệp vụ)
Event mang **mã KH + phone/email**. Kênh in-app/push cần điền `customerUserId`:
```
mã KH → customer_link → [better_auth_user_id] → customer_identity → [customer_user_id]
```
- **Giai đoạn đầu**: để `customerUserId` trống trong event → in-app/push **off**, sms/email **vẫn chạy**. Bật in-app/push khi provisioner thật + resolver sẵn sàng.
- Vị trí resolver: ở **BFF** (một bước notification-resolve trước publish) hoặc domain service gọi BFF → **quyết định phải chốt**.

## Quyết định phải chốt (hỏi đội platform / team — KHÔNG tự giả định)
1. **Provisioning endpoint có tồn tại không?** Platform có cách tạo/lấy Keycloak identity cho khách đã verify mã KH? Nếu **không** → "tạo mới" bất khả ở BFF, phải bàn lại (đây là phụ thuộc cứng, chặn PlatformProvisioner).
2. **N người : 1 mã KH** (con + bố mẹ cùng liên kết): notification 1 recipient/event → cần **fan-out** (gửi theo từng `customer_user_id`) hay **chỉ chủ HĐ** nhận in-app?
3. **Ai resolve** mã KH → customerUserId (BFF / domain service / notification)?

## Rủi ro
- **Idempotency**: provision khóa theo `better_auth_user_id` — re-link / đổi máy **không** tạo trùng định danh.
- **Rò rỉ định danh**: `customer_user_id` không được trả ra mobile.
- **Fan-out N:1**: nếu chốt "mọi người liên kết đều nhận" thì resolver trả *nhiều* customerUserId → gửi nhiều lần.

## Xong khi
- Link mã KH → tạo row `customer_identity` (customer_user_id từ **mock**) + `customer_link`. `tsc` + test xanh.
- Swap `MockProvisioner → PlatformProvisioner` = **chỉ đổi binding config**, luồng/DB/resolver không đổi.
- sms/email gửi được **không phụ thuộc** bước này (kiểm tách riêng).

## Ngoài phạm vi (sau)
- Đăng ký Expo push token gắn `customer_user_id` (kênh push) — làm khi in-app đã thông.
- Đồng bộ consent/opt-out (toggles trong app) sang policy platform.
