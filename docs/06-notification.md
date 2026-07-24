# 06 — Notification (thông báo đa kênh)

`notification-be-rs` (Rust) là **engine thông báo của platform**: nhận yêu cầu gửi qua
**event bus** hoặc **gRPC**, render template, áp **policy** (consent/bảo vệ/giờ yên
tĩnh/tần suất/ngân sách), gửi qua **provider plugin** per-tenant (SMTP, eSMS, Zalo ZNS,
in-app inbox) có **fallback chain**, và phát **event kết quả** về bus.

Khối nghiệp vụ đặt thông báo qua **contract của platform** — không gọi SMTP/eSMS/Zalo
trực tiếp — để thay provider không vỡ caller.

> Bản này thay thế hoàn toàn kiến trúc cũ (facade .NET + Novu, đã gỡ 2026-07-04).
> Event `notification.requested` và `POST /api/platform/notifications` **không còn tồn tại**.

## 1. Kiến trúc

```text
                      ┌──────────────────────── notification-be-rs ────────────────────────┐
[billing-be] ─(1) event: billing.invoice.issued ──► consumer ─┐                             │
[congno-be]  ─(1) event: <domain>.<entity>.<action> ─► ...    │   accept                    │
[bất kỳ khối]─(2) gRPC :8081 NotificationService/Send ────────┼─► (validate, normalize,    │
                      │                                       │    idempotency, snapshot   │
                      │                                       │    provider chain, 1 tx)   │
                      │                                       ▼                            │
                      │                            policy chain: consent → protected       │
                      │                             → quiet_hours → freq_cap → budget_cap  │
                      │                                       │ Allow / Suppress / Defer   │
                      │                                       ▼                            │
                      │                            dispatch worker (lease, retry ×3,       │
                      │                             rate governor, per-attempt timeout)    │
                      │                                       │                            │
                      │              ┌────────────────────────┼──────────────────┐         │
                      │              ▼                        ▼                  ▼         │
                      │        email.smtp             sms.esms / sms.zalozns  noti.inapp   │
                      │              └──── fallback chain: tenant → platform → mock ─┘     │
                      │                                       │                            │
                      │     sweeper 60s (orphan / deferred / resurrection)                 │
                      └───────────────────────────────────────┼────────────────────────────┘
                                                              ▼
[khối nghiệp vụ] ◄─(3) event: notification.delivery.{delivered|failed|suppressed}
[admin-portal]   ◄─(4) read-model + config API /api/platform/notifications/* (platform-admin)
```

Hạ tầng: HTTP `:8080` + gRPC `:8081` (svc `notification-be-rs`, ns `platform-core`),
Postgres DB `notification`, RabbitMQ exchange `water-platform` (topic).

## 2. Chọn đường tích hợp (theo quy tắc 3-nấc của platform)

| # | Đường | Khi nào dùng | Ai đang dùng |
| --- | --- | --- | --- |
| 1 | **Event bus** (khuyến nghị, mặc định) | Gửi thông báo phát sinh từ nghiệp vụ; bất đồng bộ, không chặn luồng | billing (`billing.invoice.issued/overdue`) |
| 2 | **gRPC Send** (đồng bộ nội bộ) | Cần `notificationId` ngay, hoặc nơi không tiện publish event | verify/tooling |
| 3 | **Event kết quả** `notification.delivery.*` | Nghiệp vụ cần biết đã gửi được chưa (vd đánh dấu "đã nhắc nợ") | — |
| 4 | Read-model + config API (HTTP, `platform-admin`) | Chỉ cho UI quản trị (admin-portal) — khối nghiệp vụ KHÔNG cần | admin-portal-bff |

## 3. Đặt qua event (khuyến nghị)

Publish **event nghiệp vụ của chính khối** lên exchange `water-platform`, routing key =
`eventType`. Notification đăng ký binding cho từng `eventType` và tự map:

- `templateKey` = `eventType` (convention `<domain>.<entity>.<action>`)
- **Recipients** đọc từ 3 field top-level của `payload`: `phone` (kênh sms), `email`
  (kênh email), `customerUserId` (kênh noti/in-app — **phải là Keycloak user UUID**).
  Field nào thiếu thì pair kênh đó bị bỏ qua, không lỗi.
- **Biến template** = toàn bộ `payload` (chỉ đưa biến template cần — NĐ13, không PII thừa).
- Idempotency: consumer billing dùng `{eventType}:{invoiceNo}` — event của khối bạn nên có
  1 field định danh nghiệp vụ tương tự để chống gửi trùng khi redeliver.
- Kênh gửi = theo khai báo của template (không chỉ định trong event).

```jsonc
// Envelope chuẩn platform (xem 03-event-bus.md), schemaVersion 1
{
  "eventType": "billing.invoice.issued",
  "eventId": "uuid-v7",
  "schemaVersion": 1,
  "tenantId": "hawaco",
  "traceId": "trace-abc",
  "occurredAt": "2026-07-10T09:00:00Z",
  "actor": { "clientId": "billing-be" },
  "payload": {
    "invoiceNo": "HD-2026-001",          // biến template + gốc idempotency
    "customerName": "Nguyễn Văn A",      // biến template
    "amount": 150000,
    "dueDate": "2026-08-01",
    "phone": "0912345678",               // → pair kênh sms
    "email": "an@example.com",           // → pair kênh email
    "customerUserId": "kc-user-uuid"     // → pair kênh noti (inbox), = Keycloak sub
  }
}
```

**Đăng ký eventType mới** (khối mới muốn gửi thông báo): phối hợp đội notification thêm
(a) **binding consumer** cho routing key của bạn và (b) **template** cùng key + `category`
+ nội dung kênh (hiện qua migration). Xem checklist §10.

## 4. Đặt qua gRPC (đồng bộ nội bộ)

- Proto: `platform-core/services/notification-be-rs/proto/notification.proto`
  — `notification.v1.NotificationService/Send`
- Địa chỉ nội bộ cluster: `notification-be-rs:8081` (KHÔNG expose qua APISIX)
- Auth: metadata `authorization: Bearer <SA token>` (Keycloak client_credentials)

```jsonc
// SendRequest
{
  "templateKey": "billing.invoice.issued",
  "tenantId": "hawaco",
  "recipients": [{ "phone": "0912345678", "email": "an@x.vn", "userId": "kc-uuid" }],
  "channels": ["sms"],                    // rỗng = theo template
  "dataJson": "{\"invoiceNo\":\"HD-1\"}", // JSON string — biến template
  "locale": "vi-VN",                      // rỗng = vi-VN
  "idempotencyKey": "billing.invoice.issued:HD-1"
}
// → {"notificationId":"…","status":"queued"}  (gọi lại cùng key → "duplicate")
```

## 5. Nhận kết quả gửi (event `notification.delivery.*`)

3 event terminal phát lên exchange `water-platform`, envelope chuẩn, **at-least-once**
(outbox-lite, trễ tối đa ~30s):

| eventType | Khi nào |
| --- | --- |
| `notification.delivery.delivered` | Gửi thành công |
| `notification.delivery.failed` | Hết retry + hết fallback chain |
| `notification.delivery.suppre
ssed` | Policy chặn (opt-out, bảo vệ, tần suất, ngân sách, quá hạn defer) |

```text
queue: <your-service>.notification-delivery
bind:  water-platform / notification.delivery.*
```

Payload NĐ13-safe (chỉ `recipientMasked`, không có SĐT/email thô): `deliveryId`,
`notificationId`, `idempotencyKey`, `tenantId`, `templateKey`, `category`, `channel`,
`provider`, `recipientMasked`, `chainIndex`, `attemptCount`, `failureReason`,
`suppressReason`, `occurredAt`.

**Quy tắc consumer (bắt buộc):**
- Dedup theo cặp **(`deliveryId`, `eventType`)** — KHÔNG dùng `eventId` (mỗi lần phát lại
  sinh `eventId` mới).
- Đối chiếu về nghiệp vụ của bạn bằng `idempotencyKey`/`notificationId` mà bạn gửi lúc đặt.
- Một delivery có thể phát terminal lần 2 (cơ chế hồi sinh khách-bảo-vệ) — khác `eventType`
  qua bình thường, trùng `eventType` bị chính quy tắc dedup nuốt. Không cần xử lý thêm.

## 6. Template & category

- `templateKey` convention: `<domain>.<entity>.<action>` — trùng `eventType` khi đặt qua event.
- Mỗi template khai: kênh (`email`/`sms`/`noti`), nội dung per kênh (Handlebars), locale,
  và **`category`** — quyết định policy:

| Category | Ý nghĩa | Policy |
| --- | --- | --- |
| `transactional` | Giao dịch quan trọng (hoá đơn, OTP, cắt nước) | Bỏ qua quiet-hours + frequency cap; opt-out chỉ được tôn trọng khi còn kênh khác |
| `care` (default) | Chăm sóc / marketing | Áp dụng ĐỦ mọi policy — có thể bị suppress/defer |

Đặt category **đúng bản chất** — khai `care` cho hoá đơn sẽ bị chặn ngoài giờ; khai
`transactional` cho khuyến mãi là vi phạm NĐ13.

## 7. Kênh & provider

| Loại kênh | Recipient field | Provider thật | Mock (mặc định khi chưa config) |
| --- | --- | --- | --- |
| `email` | `email` | `email.smtp` | `email.mock` |
| `sms` | `phone` | `sms.esms`, `sms.zalozns` (ZNS qua eSMS broker) | `sms.mock` |
| `noti` | `customerUserId`/`userId` | `noti.inapp` (inbox API); `noti.apns`/`noti.expo` chờ mobile app | `noti.mock` |

Provider config **per-tenant** (admin-portal → Notifications → Providers), resolution
`tenant → platform → mock` thành **fallback chain** chốt lúc accept: provider lỗi hết
retry tự chuyển hồi kế, cuối cùng luôn còn mock (log, không gửi thật) — caller không
phải xử lý gì.

## 8. Policy ảnh hưởng gì tới caller

Caller KHÔNG bật/tắt policy — chỉ cần hiểu delivery của mình có thể ra 5 trạng thái:

| Status | Nghĩa cho caller |
| --- | --- |
| `delivered` | Đã gửi (event delivered) |
| `failed` | Hết retry + hết chain (event failed, có `failureReason`) |
| `suppressed` | Policy chặn — opt-out (`opted_out`), khách bảo vệ (`protected_*`), tần suất, ngân sách (event suppressed, có `suppressReason`) |
| `deferred` | Hoãn tới hết giờ yên tĩnh (care) — sweeper tự gửi lại, KHÔNG phát event |
| `queued` | Đang xử lý |

Lưu ý nghiệp vụ: khách trong **danh sách bảo vệ** có thể bị chặn cả template
transactional nếu tenant đưa key đó vào `protected.blockedTemplates` (chủ đích — chặn
dunning người yếu thế). Nếu khối bạn làm nhắc nợ, hãy subscribe `delivery.suppressed`
với `suppressReason=protected_blocked_template` để KHÔNG leo thang biện pháp (cắt nước…)
khi thông báo chưa từng đến tay khách.

## 9. Quy tắc & cấm

- ✅ Đặt thông báo qua event nghiệp vụ hoặc gRPC Send; tham chiếu `templateKey`.
- ✅ Luôn gửi `idempotencyKey`/field định danh nghiệp vụ — bus là at-least-once.
- ✅ Payload chỉ chứa biến template cần + 3 field recipient (NĐ13).
- ✅ Dedup delivery events theo (`deliveryId`, `eventType`).
- ❌ Không gọi SMTP/eSMS/Zalo/provider trực tiếp từ khối nghiệp vụ.
- ❌ Không tự nhúng nội dung template trong code khối (template sống ở notification).
- ❌ Không dùng `eventId` để dedup; không giả định exactly-once.
- ❌ Không đặt `category=transactional` cho nội dung marketing.

## 10. Checklist tích hợp cho service mới

1. **Đặt tên**: `eventType`/`templateKey` = `<domain>.<entity>.<action>` (vd
   `congno.dunning.notice`), chọn `category` đúng bản chất.
2. **Phối hợp đội notification**: thêm binding consumer + template (kênh, nội dung
   Handlebars, category) — hiện qua migration của notification-be-rs.
3. **Publish event** đúng envelope `schemaVersion:1` với payload: biến template +
   `phone`/`email`/`customerUserId` (field nào có kênh đó) + field định danh cho idempotency.
4. *(Tuỳ chọn)* **Subscribe** `notification.delivery.*`, dedup (`deliveryId`,`eventType`),
   đối chiếu bằng `idempotencyKey` của bạn.
5. **Test staging**: chưa config provider thật → mọi kênh rơi về mock, xem kết quả ở
   admin-portal → Notifications → Deliveries (hoặc read-model API).
6. **Go-live**: tenant config provider thật ở admin-portal (Providers tab); riêng
   ZNS cần `templateMap` đã duyệt.

## Tham chiếu đầy đủ

- **Reference chi tiết** (API, env, policy semantics, fallback, DLQ, protected list,
  inbox): `platform-core/services/notification-be-rs/docs/integration.md`
- Proto gRPC: `platform-core/services/notification-be-rs/proto/notification.proto`
- Envelope & event bus: `03-event-bus.md`
- Quản trị (providers/policy/consent/spend/protected): admin-portal
  `https://admin.dichvunuoc.vn` → Notifications (role `platform-admin`)
