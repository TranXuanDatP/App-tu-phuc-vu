# Spec — Hợp đồng ownership cho các service customer-data (gửi team downstream)

> **Handable độc lập** — doc này gửi cho team sở hữu billing/invoice, meter/usage,
> contract, incident-report(Phản ánh), customer-service. Không chứa chuyện nội bộ
> của app-BFF (regression register, drop cột, sync mobile gate — coi doc riêng).
> Bổ sung `SPEC-safe-wire-app-vs-customer-service.md` (resolve/verify/profile) bằng
> phần ownership cho các service DATA.

---

## Invariant (neo chung — mọi path tuân theo)

> **`customer_bindings.status='verified'` là thẩm quyền DUY NHẤT cấp quyền đọc data
> khách.** Mọi path — register, bind, downstream fetch — đều phải tuân theo invariant
> này. Không path nào được cấp data khách mà không qua một binding verified (tạo bằng
> challenge bill-secret, hoặc bằng create-customer khi resolve chứng minh chưa tồn tại).

Downstream giữ nguyên invariant này bằng: **mọi response customer-data phải scope theo
customerId mà BFF forward (post-bind, scope `customerId`), và reject mọi truy cập record
không thuộc customerId đó.**

---

## 0. Nguyên tắc an toàn (hai bên giữ)

1. **customerId BFF forward = bound customer** — BFF lấy customerId từ binding verified
   (decrypt per-request), KHÔNG bao giờ nhận từ client. Downstream không được nhận
   customerId từ query/body do client kiểm soát — chỉ từ service JWT scope (§4).
2. **Ownership do downstream enforce** — BFF chỉ forward customerId; nguồn sự thật (record
   thuộc ai) nằm downstream. Downstream return **404 (không 403)** khi record không thuộc
   customerId → no oracle (không phân biệt "không tồn tại" vs "không phải của mình").
3. **404-no-oracle** — response "không của mình" và "không tồn tại" phải KHÔNG phân biệt
   được (cùng shape, cùng status). Khách không dò được sự tồn tại record của người khác.
4. **resolve là authority new-vs-existing** — downstream customer-service resolve/phone
   phải **đầy đủ + chính xác**. Nếu resolve lỡ một khách đang tồn tại, nhánh "create mới"
   sẽ tạo duplicate + auto-bind → bypass (xem §5). Completeness của resolve là giả định sống
   còn của cả flow.

---

## 1. Hợp đồng per-port

Mỗi port: BFF forward `customerId` (post-bind) cùng selector. Downstream scope bởi
`customerId`, 404 nếu record không thuộc.

| Port | Method | Selector | Ownership rule downstream phải enforce |
|---|---|---|---|
| **invoice** | get-list | customerId | chỉ trả hóa đơn thuộc customerId |
| invoice | get-by-id | customerId + invoiceId | invoice.owner = customerId, else 404 |
| invoice | get-pdf | customerId + invoiceId | idem |
| **tariff** | get-tariff-plan | customerId + contractId | contract thuộc customerId, else 404 |
| tariff | get-tariff-breakdown | customerId + contractId + invoiceId | contract + invoice đều thuộc customerId |
| tariff | get-applicable-fees | customerId + contractId | contract thuộc customerId |
| **meter/usage** | get-meters / consumption / reading / realtime | customerId | scope customerId |
| meter | calibration / history / status | customerId + meterId | meter thuộc customerId, else 404 |
| **contract** | list / detail | customerId | scope customerId |
| contract | econtract get/sign | customerId + dossierId | dossier thuộc customerId, else 404 |
| **incident-report (Phản ánh)** | create-report | customerId | gán reporter = customerId |
| Phản ánh | list/detail | customerId + reportId | report.reporter = customerId, else 404 |
| **incident (sự cố hạ tầng)** | list/detail | (area) | **KHÔNG scope customerId** — area-level (mất nước cả phường); chỉ cần binding verified (bound-shared) |
| **account/profile** | get-profile / timeline / related / update | customerId | scope customerId |

> Lưu ý Phản ánh ≠ incident: Phản ánh = record per-customer có PII người báo → scope
> customerId. Incident = sự kiện hạ tầng cấp khu vực → bound-shared (chỉ cần bind).
>
> ⚠️ Phân loại này dựa trên **schema review BFF** (`createReport` mang `customerId`+address;
> incident có `affectedCustomers:count`, không có reporter PII). **Cần chủ dữ liệu
> incident/Phản ánh confirm** (xem §6). Nếu record thực mang PII người báo ở tầng tôi chưa
> thấy, phải scope per-customer — không để lửng.

### 1.1 Key-mapping (quan trọng — tránh BFF cầm sai khóa)

BFF chỉ cầm **customerId** (QN-…/APP-…, bound). Nếu một port downstream nội bộ key theo
khóa khác (số hợp đồng, mã thu, mã KH, mã KH nội bộ), thì một trong hai:
- **(i) port tự resolve** `customerId` → khóa nội bộ của nó (BFF chỉ forward customerId); hoặc
- **(ii) customer-service `getProfile` trả khóa đó** (vd `contractIds`, `taxCode`) để BFF forward.

BFF **không tự map** customerId → khóa domain. Mỗi port phải **chốt phương án (i) hay (ii)**
trong contract — không mặc định "billing biết customerId". Nếu không chốt, lúc wire BFF cầm
customerId gọi billing không khớp → im lặng trả 404/empty cho khách hợp lệ (false-deny).

### Reference implementation (BFF mock)
`MockInvoiceAdapter` (đã built) là pattern chuẩn: fixture mang `ownerCustomerId` server-side
(stripped khỏi response), `get-list` filter, `get-by-id` → `!item || owner!==customerId`
throw 404. Các port khác khi build mock phía BFF (hoặc downstream thật) theo y chang.

---

## 2. resolve/verify/profile (customer-service) — recap

Đã spec ở `SPEC-safe-wire-app-vs-customer-service.md` Phần C. Tóm tắt để doc tự-contained:
- `POST /resolve/phone {phone}` → `{status:'none'|'one'|'many', customerRef?, maskedHint?, candidates?}` — mask tối thiểu, không PII.
- `POST /verify {customerRef, secretType, secretValue}` → `{verified}` — server-side, không echo secret.
- `GET /profile {customerRef}` → full Customer 360 (chỉ post-bind, scope customerId).
- `POST /resolve/channel` — omnichannel, cùng authority.

**B5 (câu chặn):** verify được secret nào? (last_invoice_amount ưu tiên / mã KH / hợp đồng). Câu này chốt `secretType`.

---

## 3. Flow thiết lập link (gác bằng resolve) — downstream phải hỗ trợ

```
bind-init (BFF dùng session.phone) → resolve/phone
  ├─ status='one'/'many' (KHÁCH TỒN TẠI) → bind: verify bill-secret → binding verified
  └─ status='none' (KHÁCH MỚI)          → register: create Customer 360 → binding verified (creation=proof)
```

Cả hai nhánh kết ở **một dòng `customer_bindings` status='verified'**. Quy tắc sống còn:
**nhánh create chỉ chạy khi resolve trả 'none'**. Nếu resolve lỡ (trả 'none' cho số đã tồn
tại) → create duplicate + auto-bind = porting-bypass. Nên downstream resolve phải
**authoritative + complete** (không false-negative). Đây là giả định an toàn lớn nhất của
toàn bộ flow — team customer-service phải confirm.

---

## 4. JWT scope (downstream verify)

BFF sign 2 scope (JwtSignerService):
- **`lookup`** (pre-bind): claim `{scope:'lookup', phone}` — cho resolve/verify. Không customerId.
- **`customerId`** (post-bind): claim `{scope:'customerId', customerRef, customerId}` — cho profile + mọi data port.

Downstream **verify scope** trên mỗi call:
- resolve/verify yêu cầu scope `lookup`.
- data port (profile/invoice/meter/contract/Phản ánh) yêu cầu scope `customerId`, và
  customerId trong token = customerId dùng scope ownership (§1). Token là nguồn customerId,
  không phải query param.

Mock không enforce downstream; structural khi BFF ký đúng scope, enforce khi wire live.

---

## 5. Go-live gate (per-port readiness)

**Cứng:** không port nào trỏ data thật trước khi (a)+(b) xanh:
- (a) Port downstream: endpoints live, leaf, scope theo customerId, 404-no-oracle.
- (b) resolve authoritative complete (không false-negative) + B5 đã chốt secretType.

| Port | (a) ready | (b) ready | Ghi chú |
|---|---|---|---|
| customer-service resolve/verify/profile | ☐ | ☐ B5 | nền tảng cho mọi flow |
| invoice | ☐ | n/a | ref impl BFF mock đã có |
| tariff/contract | ☐ | n/a | |
| meter/usage | ☐ | n/a | |
| contract/econtract | ☐ | n/a | |
| Phản ánh | ☐ | n/a | reporter scope |
| incident | ☐ (hoặc always — bound-shared) | n/a | area-level |

**Hard line:** `CUSTOMER_SERVICE_URL` chỉ trỏ data thật khi customer-service resolve/verify/profile
xanh (a+b). Mỗi data port chỉ trỏ thật khi port đó xanh (a). BFF flip từng port một (api-endpoints.yaml), không big-bang.

---

## 6. Chúng tôi cần gì từ team downstream

1. **B5** — secretType verify được gì? (1 câu chặn, quyết định §3 + A1 factor).
2. **resolve completeness** — confirm resolve/phone là authoritative, không false-negative (giả định sống còn §3/§4).
3. **Ownership enforcement** — mỗi data port scope customerId + 404-no-oracle (§1, §0.3). **403 bị cấm** cho record-scoped (403-vs-404 = enumerate oracle).
4. **Key-mapping (§1.1)** — mỗi port chốt: tự resolve customerId→khóa nội bộ, hay getProfile trả khóa.
5. **reporter-PII confirm** — Phản ánh per-customer (reporter PII)? incident area-shared (không PII)? (§1 note). Chủ dữ liệu incident/Phản ánh xác nhận.
6. **JWT scope verify** — accept BFF service JWT (JWKS/mTLS, không Keycloak), verify scope (§4).
7. **Leaf** — endpoint không gọi ngược vào BFF nào (chống loop).

---

*Ranh giới: bạn (downstream) nắm nguồn sự thật (record thuộc ai, secret thật, resolve);
BFF nắm cơ chế chứng minh (challenge → binding). Không bên tự làm cả hai.*
