# Kế hoạch — Customer match-wire an toàn (so sánh với 839443c + ghép runbook Phase 3)

> Bổ sung cho `RUNBOOK-deploy-verify-phase3-k8s.md`. Mục tiêu: giữ nguyên plumbing đã build ở commit `839443c`, chèn tầng binding danh tính để không dính porting-leak / multi-match-leak / PII-leak, và biến bước go-live thành checklist bắt buộc thay vì "set 1 env var".

---

## 0. Khung tư duy (đọc trước)

**Tách bạch hai việc đang bị gộp:**
- *Authentication* — OTP chứng minh "người này kiểm soát số này **lúc này**". Tạo/đăng nhập danh tính better-auth. Chỉ vậy.
- *Binding* — gắn danh tính đó với `customerId` để mở dữ liệu hóa đơn/hợp đồng. Đây là bước **riêng, có chứng minh riêng**, KHÔNG tự động cấp chỉ vì phone khớp.

Toàn bộ rủi ro porting nằm ở khoảng cách giữa hai câu: "giữ số" ≠ "là chủ hợp đồng gắn với số". Kế hoạch as-built (839443c) làm authentication + routing đúng; nó thiếu bước binding. Kế hoạch này **chèn binding vào giữa `resolve` và `dashboard`** — không thay code cũ, mở rộng nó.

---

## 1. So sánh: as-built (839443c) vs an toàn-target

| Khía cạnh | As-built (839443c) | An toàn-target | Rủi ro nếu giữ as-built khi live |
|---|---|---|---|
| Sau phone-match 1 | link customerId → dashboard (full) | → **binding challenge** (bill-secret) → mới mở dữ liệu | Người chiếm số (porting) xem hóa đơn/hợp đồng khách cũ |
| N-match | pick first + warn → dashboard | **disambiguation/deny**, không bao giờ pick-first | Hiển thị dữ liệu một khách bị chọn tùy tiện |
| Response `resolve` | trả đủ để link customerId | chỉ trả **candidate đã mask** (`custRef` nội bộ + gợi ý mask), full 360 kéo sau binding | Kích hoạt lookup = moi PII không cần chứng minh |
| Login lần sau | (chưa có khái niệm binding) | tra binding verified trong Redis → fast path OTP-only | — |
| Chống brute-force | rate-limit chung của login | + **rate-limit + lockout riêng** cho bind challenge | Endpoint bind thành oracle dò mã KH |
| Service auth | (chờ endpoint) | service JWT BFF tự ký, **scope tách**: pre-bind = `lookup`, post-bind = `customerId` | Một token làm cả hai việc → over-privilege |
| Go-live | "set `CUSTOMER_SERVICE_URL`" | "set URL **sau khi go-live gate xanh**" | Đường kém an toàn cách data thật đúng 1 env var |
| Audit / revoke | — | log mọi bind/unbind + re-verify khi đổi số | Không truy vết được chiếm tài khoản |

**Đánh giá:** as-built = tầng vận chuyển đúng và an toàn *khi mock*. An toàn-target = thêm tầng danh tính để an toàn *khi live trên data thật*. Cùng một xương sống, khác nhau ở lớp gate trước `dashboard`.

---

## 2. Luồng an toàn-target (thay cho nhánh "1 match → dashboard")

```
OTP verify OK
  │
  ▼
resolve?phone=X   (trả CANDIDATE đã mask, KHÔNG full 360, KHÔNG lộ customerId ra client)
  │
  ├─ 0 match  → registered:false → form đăng ký
  │             (+ copy: "Nếu bạn là khách hàng, liên hệ tổng đài" — chặn false-negative số khác)
  │
  ├─ 1 match  → đã có binding verified? 
  │             ├─ CÓ (Redis phone→customerId) → fast path → session scope customerId → dashboard
  │             └─ CHƯA → BINDING CHALLENGE (bill-secret) 
  │                        ├─ pass → tạo binding {verifiedAt, factor, device} + audit 
  │                        │         → session scope customerId → fetch full 360 → dashboard
  │                        └─ fail → retry có rate-limit → lockout sau N lần
  │
  └─ N match  → DISAMBIGUATION (chọn hợp đồng/địa chỉ theo gợi ý mask) 
                → binding challenge trên record đã chọn → (như trên)
                (KHÔNG pick-first)
```

Re-verify (step-up lại challenge) khi: device mới + binding lâu không dùng, hoặc tín hiệu đổi số. Mutation nhạy cảm (đổi TK ngân hàng nhận hoàn tiền, chuyển nhượng HĐ) → step-up Mức 2 (CCCD) — không dùng cho login thường.

---

## 3. Kế hoạch xây dựng (4 phase, W0 làm ngay không cần endpoint)

### W0 — Harden cái đã build (nhỏ, làm trước, vẫn mock)
- [ ] N-match: đổi `pick first + warn` → **deny + require disambiguation** (default an toàn kể cả mock)
- [ ] `resolve` response: chỉ trả candidate **mask tối thiểu**; customerId là ref nội bộ, không đẩy full 360 ở bước này
- [ ] 0-match copy: thêm nhánh "liên hệ tổng đài nếu là khách hàng"
- [ ] Cập nhật 6 contract tests theo 3 thay đổi trên
> Không phụ thuộc customer-service. Đóng ngay 2/3 lỗ (N-match, PII-min) trước khi bất kỳ ai nghĩ tới set URL.

### W1 — Binding domain (code, mock-backed)
- [ ] Binding port + entity: `{betterAuthUserId, customerId, verifiedAt, factorUsed, deviceInfo}`, lưu trong DB isolated `app_tu_phuc_vu`
- [ ] Endpoint binding-challenge: verify bill-secret với candidate (mock trả secret kỳ vọng cho seed customers)
- [ ] Session scoping: session chỉ mang `customerId` **sau khi** binding verified; các customer-data port từ chối identity chưa bind
- [ ] Rate-limit + lockout riêng cho challenge (mở rộng hạ tầng rate-limit better-auth, ngưỡng chặt hơn login)
- [ ] Audit log bind/unbind
- [ ] Contract tests: challenge pass / fail / lockout; unbound identity KHÔNG chạm được customer-data port
> **Quyết định nghiệp vụ cần chốt trong phase này:** bill-secret là gì. Ứng viên: mã KH (in trên hóa đơn — dễ có nhưng có thể tuần tự → cần ghép factor 2 hoặc lockout chặt), số hợp đồng, số tiền hóa đơn gần nhất (khó đoán, xoay vòng, nhưng khách có thể không nhớ). Khuyến nghị: một thứ **in trên hóa đơn vật lý** để đúng khách mới có, cộng lockout mạnh vì entropy thấp.

### W2 — Redis cache + service auth (code)
- [ ] Redis `phone→customerId` **chỉ cache binding đã verified**; TTL + invalidate khi unbind
- [ ] Service JWT: mở rộng `JwtSignerService` — pre-bind scope=`lookup`+phone (KHÔNG customerId), post-bind scope=`customerId`; customer-service verify qua JWKS của BFF
- [ ] Mock customer-service server cho 3 nhánh resolve + binding verify → W1/W2 verify được mà chưa cần endpoint thật
- [ ] Network policy: customer-service chỉ nhận traffic từ pod BFF (defense-in-depth, không thay service JWT)

### W3 — Live wire + go-live gate (phần ghép runbook)
- [ ] Chỉ khi có endpoint Keycloak-free thật / customer-service dedicated
- [ ] Chạy **go-live gate** (mục 4) — mọi dòng xanh mới set `CUSTOMER_SERVICE_URL` trỏ data thật
- [ ] Verify trong k8s (mục 4)

---

## 4. GHÉP VÀO RUNBOOK PHASE 3

### 4a. Thêm vào Pre-flight (runbook §2) — GO-LIVE GATE cho customer-wire
> `CUSTOMER_SERVICE_URL` **KHÔNG được** trỏ vào data thật cho tới khi cả 6 dòng xanh. Đây thay cho dòng cũ "chỉ cần set URL".
- [ ] (a) Binding step có trong flow (W1) — phone-match KHÔNG tự mở dữ liệu
- [ ] (b) N-match = disambiguation/deny, KHÔNG pick-first (W0)
- [ ] (c) `resolve` response mask tối thiểu, full 360 chỉ post-binding (W0)
- [ ] (d) Rate-limit + lockout trên endpoint bind (W1)
- [ ] (e) Service JWT scope tách pre/post-binding, verify được (W2)
- [ ] (f) Audit logging bind/unbind live
- [ ] Bill-secret (Mức 1) đã chốt; mức tin porting đã có quyết định nghiệp vụ ghi lại

### 4b. Thêm mục verify mới (runbook §5h) — customer-service wire trong cluster
```bash
# Set URL chỉ khi 4a xanh
kubectl -n <NS> edit secret app-tu-phuc-vu-secret   # CUSTOMER_SERVICE_URL=...
```
- [ ] **Happy path (đã bind):** OTP → binding cache hit → dashboard, không challenge lại
- [ ] **First-bind:** số khách thật lần đầu → challenge bill-secret → pass → dashboard; full 360 chỉ tải sau pass
- [ ] **Porting (bẫy 1):** số đã reassign → binding cũ tồn tại nhưng device/tín hiệu mới → **buộc re-verify**, KHÔNG lộ data khách cũ trước khi pass
- [ ] **N-match (bẫy 2):** trả nhiều candidate → UI disambiguation → KHÔNG có data nào hiện trước khi chọn + bind
- [ ] **Brute-force:** sai bill-secret N lần → lockout; endpoint không trả tín hiệu đủ để enumerate mã KH
- [ ] **Service down:** customer-service tắt → BFF rơi về Cached/Queued (three-tier), không sập luồng đọc
- [ ] **Data-min:** bắt response `resolve` → xác nhận chỉ có candidate mask, KHÔNG full PII

### 4c. Rollback
- Bất kỳ dòng 4b fail (đặc biệt porting / data-min) → `kubectl rollout undo` + unset `CUSTOMER_SERVICE_URL` (về mock ngay). Mock = an toàn, luôn là trạng thái lùi về được.

---

## 5. Definition of done
- [ ] W0–W2 xong + contract tests xanh (mock)
- [ ] Go-live gate (4a) 6/6 xanh
- [ ] Verify cluster (4b) pass cả 7 kịch bản, đặc biệt porting + data-min
- [ ] Runbook Phase 3 đã nhét §5h + go-live gate; dòng "chỉ set URL" đã bị thay
- [ ] Ghi lại: binding là **điều kiện tiên quyết** để URL trỏ data thật (không phải "việc thêm sau")

---

*Nguyên tắc xuyên suốt (đã trả cổ tức ở Step 4 AMQP): đường kém an toàn không được build sẵn rồi chờ 1 env var để thành live. Bước binding phải có mặt TRƯỚC khi `CUSTOMER_SERVICE_URL` chạm data thật — vì một khi live, rò rỉ xảy ra trước khi kịp vá.*
