# Customer-service cần làm gì để wire binding

**Tới:** team customer-service · **Từ:** app-tu-phuc-vu (customer BFF) · **2026-08-11**

## Bối cảnh (vì sao cần customer-service)

App khách hàng (`app-tu-phuc-vu-mobile`) cho user xem hóa đơn, đồng hồ, thanh toán. Trước khi xem, user phải chứng minh mình **sở hữu hồ sơ khách hàng** — gọi là **binding** (xác thực bằng thông tin hóa đơn, mạnh hơn OTP SMS). OTP chỉ chứng minh user có phone; binding chứng minh user là chủ hồ sơ.

BFF lo phần OTP, binding flow, rate-limit, mã hóa. Nhưng **BFF không biết user nào là khách hàng nào** — đó là dữ liệu Customer 360 của **customer-service**. Hiện BFF dùng mock; cần service thật.

→ Customer-service cần thêm **4 khả năng** (gọi qua gRPC) để BFF hỏi. Bảng dưới tóm tắt; chi tiết + ví dụ bên dưới.

## Tóm tắt — customer-service phải thêm gì

| # | Khả năng | Khi nào BFF gọi | Đầu vào | Đầu ra | Bảo mật bắt buộc |
|---|---|---|---|---|---|
| 1 | **Resolve** — tìm theo phone | sau OTP | `phone` | 0/1/N candidate (chỉ mã ẩn + gợi ý địa chỉ) | không trả PII |
| 2 | **Verify** — chứng minh sở hữu | user nhập thông tin hóa đơn | `customerRef` + secret | `verified: true/false` | oracle-free |
| 3 | **Profile** — lấy hồ sơ đầy đủ | **sau** Verify OK | `customerRef` | full profile + `customerId` thật | chỉ gọi post-verify |
| 4 | **Create** — tạo khách mới | user chưa có hồ sơ → đăng ký | `phone` + dossier | `customerId` + `customerRef` | atomic phone-unique |

Giao thức: **gRPC** (giống notification-be-rs đang chạy). `.proto` draft ở phụ lục.

---

## Chi tiết 4 khả năng (ví dụ dùng seed REF-001 — Nguyễn Văn Nam, +84987654321)

### 1. Resolve — tìm customer theo phone (sau OTP)
BFF vừa OTP xong, hỏi customer-service: "phone này là khách hàng nào?" Trả về **đủ để user nhận ra hồ sơ của mình**, KHÔNG trả PII.

- **Đầu vào:** `phone` (vd `+84987654321`) — luôn là session phone đã OTP (BFF đọc server-side).
- **Đầu ra theo số lượng match:**
  - **0 match** → `{status:"none"}` — user chưa có hồ sơ → BFF route đăng ký.
  - **1 match** → `{status:"one", customerRef:"REF-001", maskedHint:"Nguyễn V*** • 12 Lê Lợi, Hải Châu", challenge:{...}}`.
  - **2–3 match** → `{status:"many", candidates:[...]}` — household nhiều hồ sơ 1 phone, user chọn theo địa chỉ.
  - **>3 match** → `{status:"many", capped:true}`, **KHÔNG** candidates — số dùng chung/cũ/lỗi dữ liệu → BFF route tổng đài.
- **`customerRef`** = mã **opaque nội bộ** (KHÔNG phải `customerId` thật), service tự sinh, ổn định per customer.
- **`maskedHint`** = "Tên mask • tiền tố địa chỉ" — đủ user nhận ra CỦA mình, không đủ để dò (KHÔNG chứa mã KH / số hợp đồng / số tiền).
- **`challenge`** = factor BFF chọn để user verify (xem mục 2).
- ❌ **Không bao giờ trả:** `customerId` thật, fullName đầy đủ, phone, mã KH, số hợp đồng, số tiền.

### 2. Verify — chứng minh sở hữu (bill-secret proof)
User nhập 1 thông tin (factor) để chứng minh hồ sơ là của mình. BFF forward sang customer-service check.

- **Đầu vào:** `customerRef` (từ Resolve) + `secretType` + `secretValue`.
  - vd: `customerRef:"REF-001"`, `secretType:"last_invoice_amount"`, `secretValue:"247500"`.
- **Đầu ra:** `{verified: true}` hoặc `{verified: false}`.
- **🔴 B5 (cần chốt):** `secretType` nào? `last_invoice_amount` (số tiền hóa đơn gần nhất) · `ma_kh` (mã khách hàng) · số hợp đồng · khác? Customer-service phải cho biết hỗ trợ factor nào → BFF chọn đúng `challenge`.
- **Oracle-free (bắt buộc):** `customerRef` không tồn tại và `secretValue` sai phải trả **cùng `{verified:false}`** — attacker không biết ref nào tồn tại. Không bao giờ echo secret trong response/log.

### 3. Profile — hồ sơ đầy đủ (chỉ sau Verify OK)
BFF chỉ gọi **sau khi Verify thành công** (user đã chứng minh). Lấy `customerId` thật để BFF bind (mã hóa at rest).

- **Đầu vào:** `customerRef`.
- **Đầu ra:** `{customerId:"QN-0912345", fullName:"Nguyễn Văn Nam", classification:"sinh_hoat", address:{...}, ...}`.
- ✅ Đây là nơi duy nhất trả `customerId` thật.

### 4. Create — tạo khách hàng mới (resolve none)
User chưa có hồ sơ (Resolve trả `none`) → đăng ký tạo mới.

- **Đầu vào:** `phone` (session) + dossier `{fullName, classification, address}`.
- **Đầu ra:** `{customerId, customerRef}` (BFF auto-bind — tạo = chứng minh).
- **Atomic phone-uniqueness (bắt buộc):** nếu phone vừa xuất hiện (race tail: xuất hiện giữa Resolve và Create) → throw `ALREADY_EXISTS` → BFF reroute sang bind, **không** auto-bind.

---

## Câu hỏi lại team customer-service
1. **🔴 B5**: `Verify` hỗ trợ factor nào? (`last_invoice_amount` / `ma_kh` / số hợp đồng / khác)
2. **`.proto`**: team cung cấp, hay dùng draft ở phụ lục (BFF chỉnh)?
3. **`customerRef`**: scheme nào? service tự sinh opaque, hay map từ field có sẵn (mã KH hash)?
4. **`maskedHint`**: service generate sẵn (address + name mask), hay trả field thô cho BFF build?

## Definition of done
Team trả lời B5 + implement 4 khả năng theo contract → BFF swap mock → gRPC client (URL no `http://`, proto-loader `keepCase:true`, `OnModuleDestroy`+close) → smoke test: OTP → Resolve → Verify → bound → customer-data mở trên app.

---

## Phụ lục: `.proto` draft (tham chiếu, gRPC)

```proto
syntax = "proto3";
package customer.v1;

service CustomerBindingService {
  rpc Resolve (ResolveRequest)  returns (ResolveResponse);
  rpc Verify  (VerifyRequest)   returns (VerifyResponse);
  rpc Profile (ProfileRequest)  returns (CustomerProfile);
  rpc Create  (CreateRequest)   returns (CreateResult);
}

message ResolveRequest  { string phone = 1; }
message ResolveResponse {
  string status = 1;                          // "none" | "one" | "many"
  optional string customer_ref = 2;
  optional string masked_hint = 3;
  optional ChallengeDescriptor challenge = 4;
  repeated Candidate candidates = 5;
  bool capped = 6;
}
message ChallengeDescriptor { string type = 1; string label = 2; string input_mode = 3; } // numeric|text
message Candidate { string customer_ref = 1; string masked_hint = 2; ChallengeDescriptor challenge = 3; }

message VerifyRequest  { string customer_ref = 1; string secret_type = 2; string secret_value = 3; }
message VerifyResponse { bool verified = 1; }

message ProfileRequest { string customer_ref = 1; }
message CustomerProfile { string customer_id = 1; string full_name = 2; string classification = 3; Address address = 4; }
message Address { string street = 1; string ward = 2; string district = 3; string city = 4; string full_address = 5; }

message CreateRequest { string phone = 1; string full_name = 2; string classification = 3; Address address = 4; optional string email = 5; }
message CreateResult  { string customer_id = 1; string customer_ref = 2; }
```
