# Spec — Wire an toàn app-BFF ↔ customer-service (chia việc hai bên)

> Hand-off document. Bổ sung cho `PLAN-customer-wire-safe-vs-asbuilt.md` + `RUNBOOK-deploy-verify-phase3-k8s.md`. Dùng để: (1) biết bạn cần làm gì phía app, (2) gửi team xây customer-service biết họ cần cung cấp gì.

---

## 0. Nguyên tắc an toàn (cả hai bên phải giữ)

1. **Hai hop, hai auth** — Customer↔app-BFF: better-auth OTP (bạn). app-BFF↔customer-service: **service JWT do BFF ký, KHÔNG Keycloak** (họ phải chấp nhận).
2. **Hai bước danh tính, không gộp** — *Authentication* (OTP → danh tính) tách khỏi *Binding* (verify bill-secret → mở dữ liệu). Phone-match KHÔNG tự mở dữ liệu.
3. **Một authority** — cả app-BFF lẫn omnichannel resolve về **cùng một nguồn** (chống split-brain).
4. **Leaf** — endpoint resolve/verify KHÔNG gọi ngược vào một BFF (chống loop hiện tại: `Customer360BffAdapter → CSKH_BFF_URL`).
5. **Bí mật không rời nguồn** — verify bill-secret **server-side**; app gửi cái khách nhập, nhận về đúng/sai. Số thật (invoice amount / mã KH) không bao giờ truyền ra.
6. **Data-min** — response resolve chỉ trả candidate đã mask, không full PII.

---

## PHẦN A — VIỆC CỦA BẠN (app-BFF + omnichannel owner)

### A0. Đã xong (W0 — commit 34860cf / 57f2746)
- N-match deny, PII-min response, 0-match hotline copy, 8/8 contract tests, mock + env-gate.

### A1. Binding domain (build sau mock, factor pluggable)
- [ ] Binding entity `{betterAuthUserId, customerId, verifiedAt, factorUsed, deviceInfo}` lưu DB isolated `app_tu_phuc_vu`.
- [ ] Cơ chế challenge **tổng quát**: `challenge → verify(secret) → bind`. Factor cụ thể (amount/mã KH) là tham số, **không hardcode** — chờ team kia chốt verify được gì.
- [ ] Session scoping: session mang `customerId` **chỉ sau** binding verified; mọi customer-data port từ chối identity chưa bind.
- [ ] Rate-limit + lockout **riêng** cho challenge (mở rộng hạ tầng rate-limit better-auth, ngưỡng chặt hơn login).
- [ ] Audit log bind/unbind (device, IP, thời gian).
- [ ] Re-verify triggers: device mới + binding cũ / tín hiệu đổi số → step-up lại challenge trước khi mở dữ liệu.

### A2. Service auth + cache
- [ ] `JwtSignerService`: mở rộng scope tách — pre-bind = `lookup`+phone (KHÔNG customerId), post-bind = `customerId`.
- [ ] Redis cache `phone→customerId` **chỉ binding đã verified**; TTL + invalidate khi unbind.

### A3. Fix loop + một authority (bạn sở hữu cả omnichannel)
- [ ] `Customer360BffAdapter` của omnichannel đang trỏ `CSKH_BFF_URL` (một BFF) → **repoint sang authority leaf** khi có URL. App-BFF + omnichannel cùng trỏ một chỗ.
- [ ] App-BFF resolve KHÔNG đi qua omnichannel (tránh tái tạo loop).

### A4. Test độc lập
- [ ] Mock customer-service server mirror đúng interface Phần C → test 3 nhánh resolve + verify pass/fail/lockout mà chưa cần endpoint thật.

> **Toàn bộ Phần A build được NGAY sau mock + hợp đồng Phần C. Bạn không chờ team kia để bắt đầu** — chỉ chờ 1 câu (verify được secret nào) để chốt factor cụ thể trong A1.

---

## PHẦN B — VIỆC CỦA NGƯỜI XÂY CUSTOMER-SERVICE (cái bạn gửi họ)

Customer-service (dù là service dedicated mới, hay customer-be expose internal API) phải cung cấp:

### B1. Endpoint service-to-service, KHÔNG Keycloak
- [ ] Chấp nhận **service JWT của app-BFF** (verify qua JWKS) HOẶC mTLS + network policy. Không đòi Keycloak token.
- [ ] **Leaf**: các endpoint dưới KHÔNG gọi ngược vào bất kỳ BFF nào.

### B2. Xác nhận vai trò authority (câu kiến trúc — trả lời TRƯỚC)
- [ ] Customer-service có phải **system-of-record của danh tính khách hàng** không (master thật), hay chỉ là view staff-facing? Nếu chỉ là view → nó KHÔNG phải authority đúng, cần bàn lại.

### B3. Các API cần expose (hợp đồng ở Phần C)
- [ ] `resolve-by-phone`, `resolve-by-channel`, `verify-bill-secret`, `getProfile` — spec ở Phần C.

### B4. Bảo mật phía nguồn
- [ ] Response `resolve` **mask tối thiểu** (không full PII).
- [ ] `verify` chạy **server-side**, không trả giá trị thật.
- [ ] Response 0-match và 1-match **không phân biệt được** đủ để enumerate (chống dò mã KH).
- [ ] Lockout/rate-limit phía họ, HOẶC cho app-BFF đủ tín hiệu để tự enforce.

### B5. Câu trả lời chặn (unblock factor bill-secret)
- [ ] **Verify được bí mật nào?** — last-invoice-amount (ưu tiên: chống porting tốt nhất) hay chỉ mã KH / số hợp đồng? Câu này quyết định A1 của bạn.

---

## PHẦN C — HỢP ĐỒNG INTERFACE (thống nhất giữa hai bên)

```
POST /resolve/phone      { phone }
  → 0 match: { status: "none" }                        (đồng nhất, không lộ enumerate)
  → 1 match: { status: "one", customerRef, maskedHint } (KHÔNG full PII, KHÔNG lộ customerId thật ra client)
  → N match: { status: "many", candidates: [{customerRef, maskedHint}] }

POST /resolve/channel    { channel, channelId }         (cho omnichannel — CÙNG authority)
  → { customerRef }

POST /verify             { customerRef, secretType, secretValue }
  → { verified: boolean }                               (server-side; secret thật KHÔNG rời service)

GET  /profile            { customerId }                 (chỉ gọi được với token scope customerId — post-binding)
  → { ...full Customer 360 }
```

Ràng buộc: `/resolve/*` và `/verify` nhận token scope `lookup`; `/profile` nhận token scope `customerId`. Full profile CHỈ lấy sau khi `verify` = true.

---

## PHẦN D — GO-LIVE GATE (cả hai bên xanh mới set `CUSTOMER_SERVICE_URL` → data thật)

**Phía họ:**
- [ ] 4 endpoint live, Keycloak-free, leaf
- [ ] resolve mask tối thiểu; verify server-side; secretType đã xác nhận
- [ ] response không enumerate được

**Phía bạn:**
- [ ] binding step trong flow; N-match deny; session scoping
- [ ] rate-limit + lockout challenge; audit; service JWT scope tách
- [ ] omnichannel `Customer360BffAdapter` repoint sang authority (không loop)

**Joint verify trong cluster (nhét vào RUNBOOK §5h):**
- [ ] Porting: số reassign → binding cũ → buộc re-verify, KHÔNG lộ data khách cũ
- [ ] N-match: disambiguation, không data nào hiện trước khi chọn + bind
- [ ] Brute-force: sai secret N lần → lockout; không enumerate được
- [ ] Service down: BFF rơi về Cached/Queued, không sập luồng đọc
- [ ] Data-min: bắt response resolve → chỉ candidate mask

---

## PHẦN E — THỨ TỰ / DEPENDENCY

1. **Ngay:** gửi Phần B + C cho team customer-service. Câu B5 (verify được secret nào) là thứ cần nhất.
2. **Song song, không chờ:** bạn build Phần A trên mock (A1 factor pluggable, A2/A3/A4). Đây là việc bạn sở hữu trọn.
3. **Khi B5 có trả lời:** chốt factor cụ thể trong A1.
4. **Khi endpoint thật + Phần D xanh:** set URL, joint verify, đóng track.

**Điều duy nhất thật sự block bạn = câu B5. Mọi thứ khác phía bạn chạy được ngay.**

---

*Ranh giới một câu: bạn xây cơ chế chứng minh danh tính; họ xây nguồn để chứng minh so vào. Bí mật nằm ở phía họ, cơ chế nằm ở phía bạn, và không bên nào được tự làm cả hai — đó chính là cái giữ cho wire an toàn.*
