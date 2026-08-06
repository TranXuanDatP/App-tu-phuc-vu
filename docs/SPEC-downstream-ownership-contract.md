# Spec — Hợp đồng ownership cho các service customer-data (gửi team downstream)

> **Handable độc lập** — doc này gửi cho team sở hữu billing/invoice, meter/usage,
> contract, incident-report(Phản ánh), customer-service. Không chứa chuyện nội bộ
> của app-BFF (regression register, drop cột, sync mobile gate — coi `SPEC-binding.md`).
> Tự-contained: resolve/verify/profile (§2) + ownership các service data (§1).

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
   được ở **status, body, VÀ timing**. Cẩn thận timing: "không của mình" thường phải tra DB
   (tìm record → check owner → 404) trong khi "không tồn tại" có thể short-circuit sớm →
   khác biệt thời gian đáp ứng tái mở oracle dù body 404 giống hệt. Team phải biết timing là
   kênh rò và chủ động san bằng. Khách không dò được sự tồn tại record của người khác qua
   bất kỳ kênh nào.
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
| **payment** | history / list | customerId | scope customerId (lịch sử thanh toán theo customerId) |
| payment | get-by-id | customerId + paymentId | payment.owner = customerId, else 404 |
| payment | create | customerId + invoiceId | **verify invoice đích thuộc customerId** trước khi tạo QR/ thanh toán — KHÔNG cho pay hóa đơn người khác (financial IDOR) |
| **debt (công nợ)** | list / detail / history | customerId | scope customerId — công nợ là dữ liệu tài chính nhạy cảm |
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
| **notification (per-customer)** | "hóa đơn đến hạn", "đã thanh toán", alert cá nhân | customerId | scope customerId — nội dung + trạng thái là PII tài chính |
| **notification (broadcast)** | "mất nước khu vực", alert vùng | (area) | bound-shared, KHÔNG scope customerId |
| **account/profile** | get-profile / timeline / related / update | customerId | scope customerId |

> Lưu ý Phản ánh ≠ incident, và notification cũng split y hệt:
> - **Per-customer** (có PII/nội dung cá nhân) → scope customerId: Phản ánh (reporter PII),
>   payment/debt (tài chính), notification cá nhân ("hóa đơn đến hạn", "đã thanh toán").
> - **Broadcast/area** (không PII cá nhân) → bound-shared (chỉ cần bind): incident (mất nước
>   cả phường), notification vùng ("mất nước khu vực").
>
> ⚠️ Phân loại này dựa trên **schema review BFF** (`createReport` mang `customerId`+address;
> incident có `affectedCustomers:count`; notification có cả loại cá nhân và vùng). **Cần chủ
> dữ liệu từng service confirm** (§6). Nếu record thực mang PII cá nhân ở tầng tôi chưa thấy,
> phải scope per-customer — không để lửng.

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

## 2. resolve/verify/profile (customer-service) — interface đầy đủ

Customer-service expose 4 endpoint (service-to-service, JWT, leaf). Đây là phần contract
cho customer-service; ownership cho các service DATA ở §1.

```
POST /resolve/phone   { phone }
  → 0 match: { status: "none" }                                 (đồng nhất mọi lần — không enumerate)
  → 1 match: { status: "one",  customerRef, maskedHint }        (mask tối thiểu, KHÔNG full PII / customerId thật)
  → N match: { status: "many", candidates: [{customerRef, maskedHint}] }

POST /resolve/channel { channel, channelId }                    (omnichannel — CÙNG authority)
  → ResolveResult (giống /resolve/phone)

POST /verify          { customerRef, secretType, secretValue }
  → { verified: boolean }                                       (server-side; secret thật KHÔNG rời service)

GET  /profile         { customerRef }                           (chỉ gọi được post-bind, scope customerId)
  → { customerId, fullName, classification, address, contactInfo, status }   (full Customer 360)
```

**Ràng buộc bảo mật:**
- `/resolve/*` và `/verify` nhận token scope `lookup` (claim `phone`, KHÔNG customerId).
- `/profile` nhận token scope `customerId` — full profile CHỈ lấy sau `verify=true`.
- **resolve mask tối thiểu**: `maskedHint` theo ĐỊA CHỈ (vd `"Nguyễn V*** • 12 Lê Lợi"`), không
  chứa mã KH/amount/contract#; 0-match trả cùng shape mỗi lần (không enumerate).
- **verify server-side**: không bao giờ echo giá trị secret thật; `verified:false` cho cả
  sai-value lẫn unknown-customerRef (cùng shape, no oracle).
- **B5 (câu chặn duy nhất):** verify được bí mật nào? (`last_invoice_amount` ưu tiên — chống
  porting tốt nhất — hay chỉ `mã KH` / `số hợp đồng`). Câu này chốt `secretType` của bind flow.

---

## 3. Flow thiết lập link (gác bằng resolve) — downstream phải hỗ trợ

```
bind-init (BFF dùng session.phone) → resolve/phone
  ├─ status='one'/'many' (KHÁCH TỒN TẠI) → bind: verify bill-secret → binding verified
  └─ status='none' (KHÁCH MỚI)          → register: create Customer 360 → binding verified (creation=proof)
```

Cả hai nhánh kết ở **một dòng `customer_bindings` status='verified'**.

### 3.1 TOCTOU — create phải atomic phone-unique (fail-closed), không tin resolve='none'
Giữa lúc resolve trả 'none' và lúc create, khách thật cho số đó có thể được tạo ở hệ
customer-service/billing (ở dịch vụ khác, hoặc 2 request cùng số cùng resolve 'none'):
- auto-bind vào một khách giờ đã tồn tại, KHÔNG qua challenge = bypass; hoặc
- 2 Customer 360 + 2 auto-bind cho cùng số.

→ **create phải enforce phone-uniqueness ATOMIC** (unique constraint trên phone ở
customer-service; create fail nếu customer cho số đó vừa xuất hiện). `resolve='none'` chỉ là
**gợi ý nhánh**, không là điều kiện an toàn — create tự **fail-closed** nếu số đã tồn tại.
BFF không được assume "resolve nói none thì create an toàn".

### 3.2 resolve-authoritative — giả định an toàn nặng nhất (cần confirm độc lập)
Tách khỏi flow vì nó là giả định sống còn, không phụ thuộc nuốt:

> **Team customer-service phải confirm resolve/phone là authoritative + complete.**

Hướng nguy hiểm cần nhấn: **resolve false-negative** (bỏ sót khách đang tồn tại) = **lỗ bảo
mật** → nhánh create tạo duplicate + auto-bind = porting-bypass. resolve **false-positive**
(match nhầm khách mới vào record người khác) = **chỉ UX dead-end** (challenge fail, fail-
closed, không lộ data). Hướng phải canh là **false-negative**. Đối chiếu: §6 mục 2.

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

**Token phải short-lived + audience-scoped per downstream service**: claim `aud` theo từng
service (billing ≠ meter ≠ customer-service); một token ký cho billing không dùng lại được
ở meter. Mục đích: rò một service-token không thành chìa vạn năng — mỗi service chỉ chấp
nhận token có `aud` của mình, TTL ngắn.

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
2. **resolve completeness (§3.2)** — confirm resolve/phone authoritative, **KHÔNG false-negative** (bỏ sót khách đang tồn tại = **lỗ bảo mật** → create duplicate + auto-bind = bypass). Hướng nguy hiểm là false-negative; false-positive chỉ là UX dead-end. Confirm độc lập — giả định sống còn.
3. **Atomic phone-unique create (§3.1)** — customer-service enforce unique constraint trên phone; create **fail-closed** nếu số đã tồn tại (TOCTOU). `resolve='none'` là gợi ý nhánh, không là điều kiện an toàn.
4. **Ownership enforcement** — mỗi data port scope customerId + 404-no-oracle ở **status / body / TIMING** (§0.3). **403 bị cấm** record-scoped (403-vs-404 = enumerate oracle). **Bao gồm payment + debt** (financial IDOR): payment.create phải verify invoice đích thuộc customerId trước khi tạo QR/thanh toán.
5. **Key-mapping (§1.1)** — mỗi port chốt: tự resolve customerId→khóa nội bộ, hay getProfile trả khóa.
6. **PII classification (§1 note)** — per-customer vs broadcast: Phản ánh (reporter), payment/debt, notification cá nhân = **per-customer**; incident, notification vùng = **broadcast**. Chủ dữ liệu từng service confirm.
7. **JWT scope verify (§4)** — accept service JWT (JWKS/mTLS, không Keycloak), verify scope + **audience per service + short-lived**.
8. **Leaf** — endpoint không gọi ngược vào BFF nào (chống loop).

---

*Ranh giới: bạn (downstream) nắm nguồn sự thật (record thuộc ai, secret thật, resolve);
BFF nắm cơ chế chứng minh (challenge → binding). Không bên tự làm cả hai.*
