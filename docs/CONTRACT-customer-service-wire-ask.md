# Yêu cầu tích hợp: customer-service ↔ app-BFF (app tự phục vụ khách hàng)

**Từ:** team app-tu-phuc-vu (BFF) · **Gửi:** team customer-service
**Phạm vi:** chỉ phần **định danh khách hàng** (resolve / verify / create / profile). Ownership per data-port (billing/meter/contract…) ở doc riêng.

---

## Cần gì
App khách hàng đăng nhập bằng OTP số điện thoại. Để hiển thị đúng dữ liệu của khách, BFF cần customer-service làm **nguồn định danh** (system-of-record: số điện thoại → khách hàng). BFF **không** giữ dữ liệu khách; chỉ hỏi customer-service để (1) tìm khách theo số, (2) xác minh khách là chủ thật, (3) tạo khách mới nếu chưa có, (4) lấy hồ sơ sau khi đã xác minh.

## Xác thực (quan trọng)
- **KHÔNG Keycloak.** Đây là service-to-service. Chấp nhận **service JWT do BFF ký** (verify qua JWKS) hoặc mTLS + network policy.
- **Leaf:** các endpoint dưới **không gọi ngược vào BFF nào** (tránh vòng lặp).
- JWT có 2 scope: `lookup` (pre-verify: resolve/verify/create) và `customerId` (post-verify: profile).

## 4 endpoint cần expose

| Endpoint | Request | Response | Ghi chú bắt buộc |
|---|---|---|---|
| `POST /resolve/phone` | `{ phone }` | `{ status: 'none'\|'one'\|'many', customerRef?, maskedHint?, candidates? }` | Chỉ trả **ref nội bộ + gợi ý đã mask** (vd "Nguyễn V*** • khu vực X"). **Không** trả customerId thật, tên đầy đủ, địa chỉ, số. `none` phải **giống hệt nhau mọi lần** (không để dò số nào có trong hệ thống). |
| `POST /verify` | `{ customerRef, secretType, secretValue }` | `{ verified: boolean }` | Xác minh **server-side**. **Không echo** giá trị thật. Sai giá trị và ref-không-tồn-tại phải trả **giống hệt nhau** (không thành oracle). |
| `POST /create` | `{ phone, ...hồ sơ tối thiểu }` | `{ customerRef, customerId }` hoặc `409` | **Atomic phone-uniqueness:** nếu số đã tồn tại → **409**, KHÔNG tạo trùng. Đây là điểm chặn race quyết định (BFF dựa vào 409 này để không auto-link nhầm). |
| `GET /profile` | `{ customerRef }` (token scope `customerId`) | full hồ sơ khách | Chỉ gọi **sau khi verify**. |

*(Tùy chọn, cho omnichannel dùng chung một nguồn: `POST /resolve/channel { channel, channelId } → { customerRef }`.)*

## Bất biến an toàn (hai bên giữ)
- **resolve authoritative + complete** — không được false-negative (bỏ sót khách đang tồn tại). Nếu resolve trả `none` cho một số đã là khách thật → BFF sẽ tạo trùng + tự cấp quyền = lỗ bảo mật. Đây là giả định sống còn.
- customerId thật chỉ xuất hiện **sau verify**; trước đó BFF chỉ cầm `customerRef` đã mask.

---

## ❗ Câu chặn — cần trả lời để bắt đầu (B5)
**`/verify` xác minh được bí mật nào?**
- [ ] `last_invoice_amount` (số tiền hóa đơn gần nhất) — *ưu tiên: chống chiếm số điện thoại tốt nhất, vì kẻ vừa chiếm số không biết số tiền hóa đơn gần đây*
- [ ] `ma_kh` (mã khách hàng)
- [ ] `contract_number` (số hợp đồng)
- [ ] khác: ____

Chốt `secretType` này mở toàn bộ luồng xác minh phía BFF.

## Cần team customer-service xác nhận
1. **B5** ở trên — `secretType` verify được.
2. **resolve completeness** — xác nhận authoritative, không false-negative.
3. **create atomic** — 409 khi số đã tồn tại (không tạo trùng).
4. **Xác thực Keycloak-free** — chấp nhận service JWT (JWKS) hoặc mTLS.
5. **Leaf** — endpoint không gọi ngược BFF.
6. **customer-service có phải system-of-record của danh tính khách không** — nếu chỉ là view staff-facing, ta cần bàn lại nguồn.

Chi tiết đầy đủ (mask format, JWT scope, per-port ownership) ở `SPEC-downstream-ownership-contract.md`. Bản này là phần định danh cốt lõi để bắt đầu.
