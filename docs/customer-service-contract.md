# Customer Service — Contract cho team build (handoff)

> Tài liệu này mô tả **những gì service Customer 360 (`customer-service`) cần cung cấp**
> để BFF `app-tu-phuc-vu` lấy dữ liệu thật (hiện BFF đang dùng mock). Người làm
> customer-service implement theo contract này; BFF sẽ swap mock → live (xem §6).

- **Consumer**: BFF `app-tu-phuc-vu` (port `customer-profile`, file `src/modules/account/`).
- **Provider (cần build)**: `customer-service` — source of truth Customer 360.
- **DTO nguồn sự thật phía BFF**: `src/modules/account/dto/customer-profile.dto.ts`
  (Zod schema). Phía customer-service nên có schema tương đương.

---

## 1. Mục đích / luồng nghiệp vụ

BFF gọi customer-service cho 3 việc chính (+ 3 việc phụ đã có):

| Việc | Method (port) | Khi nào BFF gọi |
|---|---|---|
| **Match theo SĐT** | `find-by-phone` | Sau OTP login — quyết định routing (khách cũ → dashboard; chưa có → màn đăng ký) |
| **Lấy hồ sơ** | `get-profile` | Dashboard, màn hồ sơ khách hàng |
| **Tạo khách mới** | `create-customer` | Khi user đăng ký dịch vụ qua app (người mới / no-match) |
| Lấy timeline | `get-timeline` | Lịch sử tương tác KH |
| Tài khoản liên quan | `get-related-accounts` | Hồ sơ KH |
| Cập nhật liên hệ | `update-profile` | KH sửa phone/email/địa chỉ liên hệ |

---

## 2. Data contracts (DTO)

### 2.1. Customer 360 record — `CustomerProfileResponse`
(BFF đọc qua `get-profile` / `find-by-phone`, và trả về từ `create-customer`)

```jsonc
{
  "customerId": "QN-0912345",          // string, duy nhất — đây chính là "mã KH"
  "fullName": "Nguyễn Văn A",          // string, required
  "classification": "sinh_hoat",        // enum: "sinh_hoat" | "san_xuat" | "hanh_chinh"
  "address": {                          // structured (KHÔNG phải 1 string)
    "street": "123 Lê Lợi",
    "ward": "Phường Hải Châu 1",
    "district": "Quận Hải Châu",
    "city": "Đà Nẵng",
    "fullAddress": "123 Lê Lợi, Phường Hải Châu 1, Quận Hải Châu, Đà Nẵng"
  },
  "contactInfo": {
    "phone": "0901234567",              // string | null
    "email": "a@email.com",             // string | null
    "contactAddress": "..."             // string | null
  },
  "status": "active"                    // enum: "active" | "inactive" | "suspended"
}
```

**Lưu ý quan trọng:**
- `customerId` = mã KH (dùng để link với user ở BFF). Format do customer-service tự chọn (gợi ý: prefix theo khu vực + số, vd `QN-0912345`).
- `classification` enum **3 giá trị**: `sinh_hoat | san_xuat | hanh_chinh`. (Đừng dùng `kcn`/`dich_vu` — lệch với contract BFF.)
- `address` phải **structured** (street/ward/district/city) + kèm `fullAddress` đã join. BFF thu thập 4 phần từ form đăng ký; customer-service tự build `fullAddress` hoặc BFF gửi sẵn (xem §2.3).
- **Không có trường CCCD** — register không thu CCCD (xác thực định danh là kế hoạch riêng, chưa chốt — xem §4.3). Record chỉ là hồ sơ khách hàng.

### 2.2. `create-customer` — input (BFF gửi khi đăng ký)

```jsonc
{
  "fullName": "Trần Thị B",
  "classification": "sinh_hoat",
  "address": { "street": "...", "ward": "...", "district": "...", "city": "..." },
  "contactInfo": {
    "phone": "0901234567",              // SĐT đã verify OTP của user
    "email": "b@email.com",             // nullable
    "contactAddress": null              // nullable
  },
  "status": "active"
}
```
→ customer-service **tạo record + sinh `customerId`**, trả về `CustomerProfileResponse` đầy đủ (HTTP 201).

### 2.3. `update-profile` — input (chỉ cập nhật liên hệ)
```jsonc
{ "phone": "...", "email": "...", "contactAddress": "..." }   // ≥ 1 trường
```

### 2.4. `get-timeline` → `TimelineResponse`
```jsonc
{ "entries": [ { "eventType":"...", "timestamp":"ISO", "summary":"...",
                 "channel":"app|zalo|hotline|counter|web|null", "referenceId":"|null" } ],
  "totalCount": 0 }
```

### 2.5. `get-related-accounts` → `RelatedAccountsResponse`
```jsonc
{ "accounts": [ { "customerId":"...", "name":"...", "relationshipType":"...",
                  "address":"|null", "contactInfo": { "phone":"|null", ... } } ] }
```

---

## 3. API surface (REST/JSON) — endpoint convention

BFF gọi dạng **`${baseUrl}/${method}`** (method-name endpoints) — đây là convention
`InternalAdapterBase` mặc định, baseUrl ở `api-endpoints.yaml` = `${BACKEND_BASE_URL}/customers`.
→ Customer-service triển khai các endpoint sau (đã khớp với adapter BFF đã viết sẵn,
`src/modules/account/clients/customer-profile-live.client.ts`):

| Port method | HTTP | Endpoint | Query/Body |
|---|---|---|---|
| `get-profile` | GET | `/customers/get-profile` | `?customerId=...` |
| `find-by-phone` | POST | `/customers/find-by-phone` | body `{ "phone": "..." }` |
| `create-customer` | POST | `/customers/create-customer` | body §2.2 → 201 + record |
| `get-timeline` | GET | `/customers/get-timeline` | `?customerId=...` |
| `get-related-accounts` | GET | `/customers/get-related-accounts` | `?customerId=...` |
| `update-profile` | PUT | `/customers/update-profile` | body `{ customerId, ... }` (§2.3) |

> Muốn RESTful hơn (`/customers/{id}`, `/customers/{id}/timeline`...)? Báo trước — BFF
> override `buildUrl` trong adapter (mặc định đang là method-name cho đơn giản).

**Response body**: trả **raw object** (DTO ở §2) trực tiếp — BFF đọc response body làm data.
Nếu team quen dùng envelope `{success, data}`, báo trước để BFF adapter extract (khuyến nghị raw cho đơn giản).

**Status codes**:
- 200 OK + object (read/update thành công)
- 201 Created + object (`create-customer`)
- 404 Not Found (get/find không có) — BFF map `find-by-phone` 404 → "chưa đăng ký"
- 400 Invalid (sai enum/trường thiếu)
- 409 Conflict (trùng phone/CCCD khi create — nếu customer-service dedup)

---

## 4. Quy tắc nghiệp vụ CỐT LÕI

### 4.1. `find-by-phone` PHẢI phone-aware
- Chỉ trả về KH khi **SĐT thực sự tồn tại**. Không tồn tại → **null / 404**.
- ⚠️ **Không** trả một record cố định cho mọi SĐT (mock cũ từng làm vậy → sai logic
  "khách cũ vs mới"). Đây là điều kiện để BFF routing đúng sau OTP.
- **Normalize SĐT VN** trước khi match để `0901234567` / `+84901234567` / `84901234567`
  khớp nhau (BFF gửi dạng `+84...` hoặc `0...`). Khuyến nghị: lưu 1 cột dạng chuẩn
  (digits, bỏ `+84`/leading `0`) để index/lookup.

### 4.2. `create-customer` sinh `customerId`
- Sinh mã KH duy nhất, trả lại trong record. BFF sẽ gán `customerId` này vào user
  (link hồ sơ KH ↔ tài khoản app).
- **Dedup**: kiểm tra trùng **SĐT** trước khi tạo → 409 nếu trùng. (CCCD chưa thu — xem §4.3.)

### 4.3. CCCD / xác thực định danh (chưa chốt — KHÔNG thu ở register)
- **Quyết định (2026-07-24)**: register **KHÔNG thu CCCD** — "xác thực bằng CCCD" mới là
  kế hoạch, chưa chốt (memory `cskh-identity-verification-pending`). Register chỉ thu Họ
  tên + phân loại + địa chỉ (+ email tuỳ chọn).
- Bảng `users` vẫn có cột `cccd`/`cccd_hash` (nullable, migration 0005) — để dùng KHI NÀO
  chốt bước xác thực định danh. Hiện register không ghi các cột này.
- `create-customer` payload **không chứa CCCD**. Customer-service dedup theo **SĐT**.
- Khi chốt xác thực CCCD → bổ sung: thu CCCD ở register + gửi customer-service (nếu cần
  dedup/đối soát) + encrypt (PiiEncryptionService đã có sẵn).

---

## 5. Transport / bảo mật

- **REST + JSON** (khuyến nghị) hoặc gRPC (nếu team prefer — báo trước, BFF sẽ đổi adapter).
- **Auth downstream**: BFF truyền một JWT nội bộ qua header khi gọi downstream
  (`JwtSignerService` → header `Authorization: Bearer ...` hoặc header riêng). Customer-service
  cần **validate JWT đó** (hoặc tin tưởng nếu trong mạng nội bộ + mTLS). Báo cơ chế BFF sẽ dùng.
- **Correlation ID**: BFF gửi header `x-correlation-id` — customer-service nên log/propegate.
- **Timeout**: BFF đặt timeout per-port (mặc định 3s). Customer-service nên respond < 1-2s.

---

## 6. Wire (đã chuẩn bị sẵn — chỉ còn flip khi service lên)

Đã làm sẵn "đường dẫn nối" (mock vẫn đang active, không đổi hành vi hiện tại):
1. ✅ `CustomerProfileInternalAdapter extends InternalAdapterBase` — `src/modules/account/clients/customer-profile-live.client.ts` (map các port method → endpoint §3; PortHttpClient lo JWT/correlation/timeout).
2. ✅ Đăng ký làm **live adapter** (tham số thứ 2 của `portRegistry.register('customer-profile', mock, live)`) trong `account.module.ts`. Mock vẫn là default.
3. ⏳ Khi customer-service sẵn sàng — chỉ cần flip 1 dòng `config/api-endpoints.yaml`:
   ```yaml
   customer-profile:
     adapter: live                    # ← đổi từ mock
   ```
4. (Tuỳ chọn) `MOCK_MODE=false` để ép toàn bộ port sang live.

→ Endpoint BFF (`/auth/check-registration`, `/auth/register`, `/customers/...`) **không đổi**;
chỉ source dữ liệu chuyển từ mock sang customer-service thật.

---

## 7. Checklist cho team customer-service

- [ ] Định nghĩa schema tương đương §2 (đặc biệt `classification` 3-giá-trị, `address` structured).
- [ ] Endpoint §3 + đúng HTTP method + status codes.
- [ ] `find-by-phone` phone-aware + normalize SĐT VN (§4.1) — **quan trọng nhất**.
- [ ] `create-customer` sinh `customerId` + dedup phone (§4.2).
- [ ] Validate JWT downstream / đồng ý cơ chế auth (§5).
- [ ] (Khi chốt xác thực CCCD) bổ sung thu CCCD ở register + gửi customer-service (§4.3).
- [ ] Confirm envelope raw-object vs `{success,data}` (§3).
- [ ] Sample data: seed ≥ 1 "khách cũ" theo SĐT để BFF test nhánh match (hiện mock seed `0987654321` → QN-0912345).

---
*Liên quan: `src/modules/account/dto/customer-profile.dto.ts` (DTO), `api-endpoints.yaml`
(customer-profile port), `internal-adapter.base.ts` (cơ chế live call). Memory:
[[app-identity-feature-progress]], [[app-bff-lean-restructure]].*
