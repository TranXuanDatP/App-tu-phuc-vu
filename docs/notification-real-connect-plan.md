# Plan: Kết nối THẬT notification-be-rs (customerUserId có sẵn — không mock, không provision/match)

## Mục tiêu
Nối thật app → `notification-be-rs` (bỏ mock phía app). Giả định **`customerUserId` đã có sẵn**
(Customer 360 / identity trả về) → **không tạo mới, không match**, chỉ pass-through. Chứng minh
một thông báo đi thật đầu-cuối.

## Điều kiện đầu vào (giả định đã có)
- `customerUserId` sẵn cho mỗi khách (pass-through — không provision).
- `phone` / `email` từ Customer 360.
- `tenantId` (vd `hawaco`).

## "Nối thật" nghĩa là gì — làm rõ để không hiểu nhầm
- **Nối thật** = app nối thật tới notification-be-rs (RabbitMQ **hoặc** gRPC thật), bỏ mock phía app.
- notification-be-rs **vẫn có thể gửi qua mock provider** (`email.mock`/`sms.mock`) tới khi tenant cấu hình provider thật ở admin-portal. Đây là bình thường (staging, §10.5): **connection thật + provider mock** → xem kết quả ở admin-portal → Deliveries.
- ⇒ **"nối thật" và "SMS thật tới điện thoại" là HAI mốc khác nhau.** Mốc này chỉ chứng minh cái đầu.

## Phụ thuộc CỨNG phải có trước (coordination, KHÔNG phải code)
Đây là cái chặn thật — hỏi/xin đội platform trước khi viết code:
1. **Template đã đăng ký** cho `templateKey` của bạn (§10.2). **Không có template → gửi gì cũng không render.** Đây là phụ thuộc #1.
2. **Quyền truy cập transport:**
   - *Event bus:* credentials RabbitMQ + reachability tới exchange `water-platform`.
   - *gRPC:* `notification-be-rs:8081` reachable **nội bộ cluster** (KHÔNG qua APISIX) + **Keycloak SA token** (client_credentials).
3. `tenantId` của bạn.

## Đường nối đầu tiên: gRPC Send (chứng minh nhanh) → event bus (sản xuất)
- **gRPC Send** cho lần đầu: đồng bộ, trả `notificationId`/`status` ngay → dễ debug một phát.
- **Event bus** cho sản xuất: bất đồng bộ, đúng khuyến nghị doc; dùng khi domain service phát event nghiệp vụ.
- `customerUserId` chỉ cần cho kênh **noti/in-app**; OTP/sms chỉ cần `phone`.

## Ứng viên "thông báo thật đầu tiên" → OTP
Chọn cái app **thật sự tự phát**, ít phụ thuộc nhất:
- **OTP của better-auth** (auth capability): recipient = `phone`, channel `sms`, category `transactional`
  → **KHÔNG cần customerUserId, KHÔNG cần match**, và **đang có sẵn trong luồng login**.
- Việc làm: đổi `sendOTP` của better-auth — thay path hiện tại (ZaloOaClient/mock) → gọi notification-be-rs
  (gRPC Send, `templateKey` OTP đã đăng ký, kèm `idempotencyKey`).
- Đây là send thật đơn giản nhất để chứng minh cả kênh, trước khi đụng in-app (cần customerUserId).

## Các đường nối (thật)

### A. gRPC Send — từ auth capability / caller
- Proto: `notification.v1.NotificationService/Send` (`platform-core/services/notification-be-rs/proto/notification.proto`).
- metadata: `authorization: Bearer <SA token Keycloak>`.
- `SendRequest`: `templateKey`, `tenantId`, `recipients[{phone,email,userId}]`, `channels` (rỗng = theo template),
  `dataJson` (biến template, JSON string), `idempotencyKey`.
- Thay `NotificationPort` mock cũ → `NotificationGrpcClient` thật (bind qua config, bỏ nhánh mock).

### B. Inbox display — mobile (làm được luôn vì có customerUserId)
- Mobile tab "Thông báo" → BFF `/notifications` proxy → **inbox API** notification-be-rs (đọc theo `customerUserId` có sẵn). Không cần match.

### C. Delivery events — tùy chọn
- subscribe `notification.delivery.*`, dedup theo **(`deliveryId`, `eventType`)** (không dùng `eventId`).

## Bỏ khỏi phạm vi (theo yêu cầu)
- `MockProvisioner` / `IdentityProvisioner` / bảng mapping tạo-mới-match → **KHÔNG làm** (customerUserId giả định có sẵn).
- Cấu hình provider thật (SMTP/eSMS/ZNS) → việc của tenant/admin-portal, **không chặn** nối.

## Verify — mốc thật đầu tiên
1. Gửi (gRPC Send hoặc event) một thông báo test/OTP với `templateKey` **đã đăng ký**.
2. Nhận `notificationId`/`status=queued` (gRPC), hoặc thấy consumer nhận (event).
3. Thấy delivery ở admin-portal → Notifications → Deliveries (provider = `mock` nếu tenant chưa config),
   HOẶC nhận event `notification.delivery.*`.
→ Ba dấu này = "nối thật" xong (dù provider còn mock).

## Rủi ro / bẫy
- **Gửi `templateKey` chưa đăng ký** → im lặng/hỏng. Xác nhận template tồn tại TRƯỚC khi code.
- **gRPC không qua APISIX** — phải reachable nội bộ; sai địa chỉ = timeout.
- **SA token Keycloak** hết hạn / sai client → 401 gRPC.
- **Thiếu `idempotencyKey`** → gửi trùng khi retry (bus at-least-once).
- **Sai `category`** (marketing khai `transactional`) = vi phạm NĐ13.
- Lẫn "nối thật" với "SMS tới điện thoại thật" — cái sau cần tenant config provider.

## Thứ tự làm
1. Xin đội platform: (a) template OTP đã đăng ký?, (b) gRPC endpoint + SA token, (c) tenantId. ← chặn, làm trước.
2. Thay `sendOTP` → gọi notification-be-rs gRPC (bỏ mock). Verify OTP đi qua Deliveries.
3. (Sau) inbox display cho mobile bằng customerUserId.
4. (Sau) delivery events nếu nghiệp vụ cần biết kết quả.
