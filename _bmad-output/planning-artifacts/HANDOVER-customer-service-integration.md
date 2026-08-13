# HANDOVER — Customer-Service gRPC Contract

- **Tới:** team customer-service · **Từ:** team app-tu-phuc-vu (customer BFF) · **2026-08-11**
- **Mục tiêu:** customer-service implement 4 RPC dưới đây để BFF thay `MockCustomerServiceClient` → binding real → go-live app khách hàng. Đây là long-pole duy nhất còn lại.
- **Giao thức:** **gRPC** (như notification-be-rs). BFF sẽ add `.proto` vào `src/libs/shared/proto/`, viết client theo pattern `notification-grpc.client.ts`.

---

## 🔴 Câu hỏi then chốt — B5 (factor)

`Verify` chấp nhận factor nào? `last_invoice_amount` (số tiền hoá đơn) · `ma_kh` (mã khách hàng) · số hợp đồng · khác?
BFF trả `ChallengeDescriptor` cho mobile render 1 input đúng factor — đổi factor = 1 dòng BE, mobile không rebuild. Cần chốt để lock.

---

## .proto (BFF draft — team chốtnh)

```proto
syntax = "proto3";
package customer.v1;

service CustomerBindingService {
  rpc Resolve (ResolveRequest)  returns (ResolveResponse);   // phone → masked candidate(s)
  rpc Verify  (VerifyRequest)   returns (VerifyResponse);    // bill-secret proof (oracle-free)
  rpc Profile (ProfileRequest)  returns (CustomerProfile);   // full profile, SAU verify
  rpc Create  (CreateRequest)   returns (CreateResult);      // new customer (atomic phone-unique)
}

message ResolveRequest  { string phone = 1; }                 // OTP-verified session phone (server-side)
message ResolveResponse {
  string status = 1;                          // "none" | "one" | "many"
  optional string customer_ref = 2;           // opaque, NOT real customerId
  optional string masked_hint = 3;            // "Nguyễn V*** • 12 Lê Lợi" — address + name-mask
  optional ChallengeDescriptor challenge = 4; // BE-chosen factor (mobile renders from this)
  repeated Candidate candidates = 5;          // N ≤ 3 — disambiguate by address
  bool capped = 6;                            // N > 3 → true, KHÔNG candidates (→ tổng đài)
}
message ChallengeDescriptor { string type = 1; string label = 2; string input_mode = 3; } // numeric|text
message Candidate { string customer_ref = 1; string masked_hint = 2; ChallengeDescriptor challenge = 3; }

message VerifyRequest  { string customer_ref = 1; string secret_type = 2; string secret_value = 3; }
message VerifyResponse { bool verified = 1; }

message ProfileRequest { string customer_ref = 1; }
message CustomerProfile { // full — BFF chỉ gọi post-verify; encrypts customer_id at rest
  string customer_id = 1;  string full_name = 2;  string classification = 3;  Address address = 4;
}
message Address { string street = 1; string ward = 2; string district = 3; string city = 4; string full_address = 5; }

message CreateRequest { string phone = 1; string full_name = 2; string classification = 3; Address address = 4; optional string email = 5; }
message CreateResult  { string customer_id = 1; string customer_ref = 2; }   // throw ALREADY_EXISTS nếu phone đã có (race)
```

---

## Bảo mật bắt buộc (must implement)

- **Resolve** — KHÔNG trả PII (real `customer_id` / fullName / phone / mã KH / contract / amount). Chỉ `customer_ref` opaque + `masked_hint` (address-based, rời giá trị secret — survives B5). 0-match identic mỗi lần. N>3 → `capped`, không candidates.
- **Verify** — oracle-free: unknown `customer_ref` và wrong `secret_value` trả cùng `{verified:false}`. Never echo secret.
- **Create** — atomic phone-uniqueness: race → `ALREADY_EXISTS` (BFF reroute sang bind, không auto-bind).
- **Profile** — trả real `customer_id` (BFF encrypt at rest, cache cipher-only). Chỉ BFF gọi sau verify.

BFF owns: 3-tier rate-limit/lockout, PII encryption, N-cap fallback, `auth/me.linked` gate. Customer-service chỉ cần 4 RPC đúng contract.

---

## Hỏi lại team
1. **B5**: `Verify` factor nào?
2. **.proto**: team cung cấp hay dùng draft trên (BFF edit)?
3. `customer_ref` scheme: opaque service tự sinh, hay map field có sẵn?
4. `masked_hint`: service generate sẵn hay trả field thô cho BFF build?

## Definition of done
Team trả lời B5 + implement 4 RPC theo `.proto` → BFF swap mock → gRPC client (URL no `http://`, proto-loader `keepCase:true`, `OnModuleDestroy`+close) → smoke test OTP→bind-init→verify→bound→customer-data mở.
