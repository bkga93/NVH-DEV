# TCT SCANNER PRO - PROJECT CONTEXT FOR AI (V1.1.7.3 Beta)

Tài liệu này lưu trữ toàn bộ ngữ cảnh, logic và các quyết định kỹ thuật quan trọng của dự án để AI có thể tiếp tục hỗ trợ ngay lập tức khi được tải lên.

## 1. Thông tin chung
- **Tên dự án**: TCT Scanner Pro (Diamond Edition).
- **Mục đích**: Quản lý đơn hàng Shopee, quét mã QR, đồng bộ Google Sheets, giám sát Camera và ghi hình bằng chứng.
- **Phiên bản hiện tại**: V1.1.7.3 Beta (Cập nhật 10/04/2026).
- **Công nghệ**: HTML5, Vanilla CSS, Javascript (ES6), IndexedDB, WebRTC (go2rtc), Google Apps Script.

## 2. Logic Xử lý Dữ liệu (Dữ liệu Tab)
- **Định dạng thời gian**: Bắt buộc dùng `DD/MM/YYYY HH:mm:ss` (ví dụ: `04/04/2026 18:48:44`).
- **Cập nhật dữ liệu (Nút TẢI DỮ LIỆU)**:
    - Tải toàn bộ từ Sheets.
    - Lọc: **Bắt buộc chỉ lấy trong vòng 30 ngày**.
    - Loại bỏ trùng lặp: Dựa trên **Mã đơn hàng quét được** (`content`), giữ bản ghi mới nhất.
- **Tìm kiếm & Gợi ý**:
    - Chỉ hiển thị gợi ý khi từ khóa **>= 3 ký tự**.
    - Hiển thị gợi ý **ngay lập tức** từ cache cục bộ khi đủ độ dài.
    - Tự động ẩn danh sách nếu ô tìm kiếm trống.
    - Tìm kiếm từ xa (Cloud SEARCH) chỉ kích hoạt sau 0.8s dừng gõ (debounce) và từ khóa >= 3 ký tự.
- **Nút Xem tất cả**: Hiển thị nhanh toàn bộ dữ liệu trong bộ nhớ (giới hạn render 200 items), kèm dòng **Tổng số đơn hàng** trên đầu.
- **Quét mã tại Tab (In-Tab Scan)**: Sử dụng Modal overlay để quét mã mà không cần chuyển Tab.

## 3. Hệ thống Camera & Recording (PC Mode)
- **PC Mode**: Giao diện 2 cột (Trái: Quét mã & Lịch sử nhanh | Phải: Giám sát 2 góc & Ghi hình).
- **Camera IP**: Kết nối qua `go2rtc` (WebRTC).
- **Ghi hình**: Sử dụng MediaRecorder, lưu song song 2 góc (CAM1, CAM2) dạng `.webm`.
- **Lưu trữ**: Ưu tiên thư mục máy tính (File System Access API), dự phòng IndexedDB cho Safari/iPhone.
- **Đồng bộ Video**: Tự động tải lên Google Drive theo từng mảnh (chunks) 2MB.

## 4. Bảo mật & Kích hoạt
- **Activation Key**: `310824` (Lưu trạng thái kích hoạt vào IndexedDB).
- **Mật khẩu App**: Lưu trạng thái vào `localStorage` (`nvh_auth_skip`).

## 5. Quy tắc Phát triển (Lưu ý cho AI)
- Luôn giữ giao diện theo phong cách **Diamond Edition** (Tím đậm, Vàng Gold, Hiệu ứng Glassmorphism).
- Khi sửa log, phải cập nhật đồng thời ở `index.html` (template changelog) và `CHANGELOG.md`.
- Bảo toàn logic `formatDate` và `parseDate` đã xây dựng trong `app.js` để tránh sai sót ngày tháng.
- **Lưu ý v1.1.6**: `parseDate` hỗ trợ linh hoạt cả `D/M/Y H:M:S` và `H:M:S D/M/Y` (xử lý tốt dữ liệu nhập tay từ Google Sheets).

---
*File updated on 2026-04-10 by Antigravity AI (Data Overhaul V1.1.7.3).*
