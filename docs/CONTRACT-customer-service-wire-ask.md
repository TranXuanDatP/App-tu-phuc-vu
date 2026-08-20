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

---

## Phụ lục: transport gRPC (customer-service đang chạy gRPC)

Bảng endpoint ở trên mô tả **semantic**; nếu phía chạy gRPC thì wire là **gRPC** — app-mobile không bị ảnh hưởng (mobile chỉ nói HTTP/JSON với BFF; BFF làm trình dịch REST↔gRPC). Ánh xạ:

| Contract (REST) | RPC | Lưu ý semantic |
|---|---|---|
| `POST /resolve/phone` | `ResolvePhone` | none/one/many + mã đã mask — giữ nguyên |
| `POST /verify` | `Verify` | sai-secret và sai-mã trả **giống hệt nhau** (không thành oracle) |
| `POST /create` (409 khi trùng phone) | `Create` → lỗi `ALREADY_EXISTS` (code 6) | "409" HTTP ↔ status code gRPC |
| `GET /profile` | `GetProfile` | chỉ gọi sau verify (scope `customerId`) |

Xác thực dịch sang **gRPC metadata** (`authorization: Bearer <service-JWT>`, verify JWKS) hoặc mTLS trên channel — vẫn Keycloak-free. Endpoint phía customer-service **không gọi ngược** BFF (leaf).

### Draft `.proto` để review trực tiếp

```proto
syntax = "proto3";
package customer.identity.v1;

// Định danh khách cho app tự phục vụ. Bất biến an toàn nằm ở comment từng rpc —
// xem "Bất biến" ở trên; semantic không đổi dù transport là gRPC.

service CustomerIdentity {
  // status NONE phải giống hệt nhau cho mọi số không tồn tại (chống dò).
  // Chỉ trả customer_ref nội bộ + masked_hint — không trả customerId/tên/địa chỉ.
  rpc ResolvePhone(ResolvePhoneRequest) returns (ResolvePhoneResponse);

  // Verify server-side. KHÔNG echo giá trị thật. Sai secret và sai customer_ref
  // phải trả cùng một kết quả (verified=false) — không phân biệt được ref nào tồn tại.
  rpc Verify(VerifyRequest) returns (VerifyResponse);

  // Atomic phone-uniqueness: số đã tồn tại → trả lỗi ALREADY_EXISTS (code 6),
  // KHÔNG tạo trùng. BFF dựa vào lỗi này để không auto-link nhầm.
  rpc Create(CreateRequest) returns (CreateResponse);

  // Chỉ gọi SAU khi Verify pass (service-JWT scope customerId).
  rpc GetProfile(GetProfileRequest) returns (CustomerProfile);
}

enum ResolveStatus { RESOLVE_STATUS_UNSPECIFIED = 0; NONE = 1; ONE = 2; MANY = 3; }

// B5 chưa chốt — để cả 3, sẽ cắt còn 1 sau khi team customer trả lời.
enum SecretType {
  SECRET_TYPE_UNSPECIFIED = 0;
  LAST_INVOICE_AMOUNT = 1; // ưu tiên: kẻ chiếm SIM không biết số tiền hóa đơn gần nhất
  MA_KH = 2;               // mã khách hàng
  CONTRACT_NUMBER = 3;     // số hợp đồng
}

message ResolvePhoneRequest { string phone = 1; } // E.164, vd +84912345678

message MaskedCandidate {
  string customer_ref = 1; // ref nội bộ, không phải customerId
  string masked_hint = 2;  // vd "Nguyễn V*** • khu vực X"
}

message ResolvePhoneResponse {
  ResolveStatus status = 1;
  string customer_ref = 2;         // đặt khi ONE
  string masked_hint = 3;          // đặt khi ONE
  repeated MaskedCandidate candidates = 4; // đặt khi MANY (số lượng có cap)
}

message VerifyRequest {
  string customer_ref = 1; // phải xuất phát từ ResolvePhone cùng phiên
  SecretType secret_type = 2;
  string secret_value = 3; // không echo lại ở response
}
message VerifyResponse { bool verified = 1; }

message Address {
  string street = 1;
  string ward = 2;
  string district = 3;
  string city = 4;
}

message CreateRequest {
  string phone = 1;        // trùng → ALREADY_EXISTS
  string full_name = 2;
  string classification = 3; // sinh_hoat | san_xuat | hanh_chinh
  Address address = 4;
  optional string email = 5;
}
message CreateResponse {
  string customer_ref = 1;
  string customer_id = 2;
}

message GetProfileRequest { string customer_ref = 1; }

message CustomerProfile {
  string customer_id = 1; // customerId thật — chỉ xuất hiện sau verify
  string full_name = 2;
  string phone = 3;
  string classification = 4;
  Address address = 5;
  optional string email = 6;
}
```

### Cần bên customer-service cung cấp để BFF nối (checklist)
1. Xác nhận/sửa draft `.proto` trên (service + messages + tên field thật của họ).
2. Địa chỉ `host:port` + có TLS/mTLS chưa.
3. Auth: metadata token (service-JWT) hay mTLS.
4. Trả lời **B5** (`SecretType` thật sự verify được — cắt enum còn 1).
