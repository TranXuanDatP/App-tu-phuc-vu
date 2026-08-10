# Domain Decision — Mobile Incident Tracking & Rating (C1/C3)

- **Ngày:** 2026-08-10
- **Trạng thái:** CHỐT
- **Liên quan:** roadmap mobile FE nhóm C; CONTRACT downstream gửi team customer
- **Bối cảnh kiến trúc:** `ticket ≠ incident` — KH tạo **Phản ánh** → GIS Triage → **Incident** (app-tu-phuc-vu). **Ticket** ở OmniCare (CSKH staff). Tách cố ý. Nguyên tắc giữ: **app khách hàng KHÔNG tạo/chạm ticket.**

---

## C1 — Tracking timeline

### Quyết định
Mobile timeline = **INCIDENT stage** (`pending → in_progress → resolved`), **KHÔNG field SLA/deadline/ETA**. Tôn trọng data contract hiện tại (Phản ánh DTO `IncidentReportSchema`/`ReportDetailSchema` không có SLA field) + domain boundary. Đúng định nghĩa roadmap "tracking Grab/Shopee-style".

Roadmap-item C1 "timeline liên kết SLA Engine" **sai tên** — kéo SLA ticket sang app KH = phá domain. Redefine thành **"incident stage timeline"**.

### SLA không publish đối ngoại
SLA nội bộ (P0 ack 1h/resolve 4h · P1 2h/8h · P2 24h/7d · P3 48h/14d; theo địa bàn sửa ống 2–6h, khiếu nại 24h) là **chỉ tiêu tuân thủ có ngữ nghĩa breach** — trace DR-4 "tiêu chuẩn dịch vụ công".

Lý do mạnh nhất không phải domain boundary (chỉ dữ kiện kỹ thuật) mà là: publish SLA ra KH = mỗi lần breach nội bộ đồng thời thành một **lời hứa lỗi với KH** — ghép rủi ro tuân thủ với rủi ro uy tín vào cùng một con số. Không đáng.

- **Phạm vi kỹ thuật: ĐÓNG.** Không thêm SLA/deadline/ETA field vào Phản ánh DTO.
- **Phạm vi business: ĐỂ NGỎ, kèm điều kiện tái mở.** Doc quyết định không khoá một lựa chọn kinh doanh bằng lập luận kỹ thuật — đó là kiểu điều khoản 8 tháng sau người ta lặng lẽ vượt qua vì thấy vô lý. Ghi thẳng điều kiện tái mở:
  > Nếu sau này business muốn publish ETA: giá trị đối ngoại phải là **một con số riêng, thận trọng hơn**, không được lấy trực tiếp giá trị SLA nội bộ. Thêm field vào Phản ánh DTO là **bước cuối**, không phải bước đầu.

### Stage timestamp — vấn đề stage đứng im
Stage tracking kiểu Grab/Shopee hoạt động vì các stage nhảy nhanh. Phản ánh nước có thể nằm `pending` ba ngày. Lúc đó timeline không ETA lại **tệ hơn không có timeline** — KH thấy một thanh trạng thái đứng im, không biết hệ thống chết hay chưa tới lượt.

Vá không phá nguyên tắc: **mỗi mốc timeline mang timestamp thực tế đã vào stage đó** (`enteredStageAt`). Đó là **dữ kiện lịch sử** (cho thấy chuyển động), không phải cam kết tương lai — cho thấy chuyển động mà không hứa gì. Đưa vào C1.

---

## C3 — Rating

### Quyết định
Mobile rating = **incident-satisfaction**, **KHÔNG reopen ticket**. Phase-3 CSAT `TicketClosed → survey → reopen<3★` là **ticket loop** (OmniCare staff) — KH không tạo ticket.

### Ranh giới: ghi vs đọc (không phải chiều dữ liệu)
"Độc lập hoàn toàn" vs "feed-back nhất chiều" là cặp lựa chọn sai. Ranh giới cần giữ là **ghi vs đọc**:

- **CẤM:** incident-satisfaction gây ra bất kỳ chuyển trạng thái nào ở ticket domain — reopen, SLA breach, re-assign. Đúng logic binding: KH không sở hữu ticket đó.
- **NÊN CÓ:** điểm hài lòng chảy sang staff-side dưới dạng **event/analytics đọc-only, phi tự-động**. Cắt hoàn toàn = vứt mất tín hiệu duy nhất cho biết incident "resolved" theo hệ thống có thực sự resolved theo KH hay không — đây là chỗ hay lệch nhất.

Diễn đạt chuẩn:
> *"incident-satisfaction không ghi state sang ticket domain; nó phát event để staff đọc/tổng hợp."*

### Key: `report_id`, KHÔNG `incident_id` 🚩
Draft trước ghi "API riêng, `incident_id`". Cái này hỏng theo hai đường:

1. **Một incident → N người phản ánh.** Vỡ ống Bãi Cháy sinh 40 phản ánh gộp về một incident. Rating theo `incident_id` không quy về ai, và 40 người cùng chấm một bản ghi.
2. **Thủng đúng chỗ vừa vá — IDOR mở lại.** Area-incident hiện là **bound-shared**, còn report thì **owner-scoped** (reporter = `customerId`, list filter + detail 404). Nếu rating key theo `incident_id`, KH B chấm được incident gắn với phản ánh của KH A → mở lại đúng lớp IDOR mà A2 vừa đóng trên `MockIncidentAdapter`, chỉ khác endpoint.

**Sửa:** rating gắn **`report_id`** (bản ghi KH sở hữu), trigger khi **report của chính họ** chuyển `resolved` (không phải khi incident resolved). Chấp nhận N rating trên một incident — đó là **dữ liệu đúng, không phải trùng lặp**.

---

## Implication downstream CONTRACT (gửi team customer)
Mobile chỉ consume **incident stage** (+ stage timestamp) + **incident-satisfaction** (key `report_id`). Ticket SLA/CSAT nằm staff-side, KH không chạm. **Phản ánh DTO giữ nguyên, không thêm SLA field.**

## Đính chính kỹ thuật (reference)
BullMQ trong `app-tu-phuc-vu` = **resilience Queued tier** (NFR-R2 "0% total outage"), **KHÔNG phải SLA timer**. SLA dual-clock worker nằm ở **ticket domain** `omichannel_be` (phase2 done). Incident domain (app-tu-phuc-vu) **chưa build + không có SLA mechanism** — port đang mock.
