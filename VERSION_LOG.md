# TCT SCANNER PRO - LỊCH SỬ PHÁT TRIỂN CHI TIẾT (VERSION LOG)

---

## [V1.1.6 Beta] - 10/04/2026 (Hiện tại)
- **Sửa lỗi Google Sheets**: 
    - Khắc phục lỗi không tải được dữ liệu nhập tay có định dạng "Giờ trước Ngày sau" hoặc thiếu số 0 ở đầu (ví dụ: `8:0:19 10/4/2026`).
- **Cải tiến UX/UI**:
    - Điều chỉnh thời gian hiển thị thông báo (Toast) về **2 giây** để cân bằng tốc độ đọc.
    - Bổ sung dòng thông báo "Đang phát triển ...." cho Tab Xem lại.
- **Trạng thái**: Hỗ trợ tốt hơn cho việc quản lý dữ liệu thủ công.

---

## [V1.1.5 Beta] - 04/2026

---

## [V1.1.4 Beta] - 04/2026
- **Sửa lỗi nghiêm trọng**:
    - **Data Normalization**: Sửa lỗi "0 đơn hàng" khi Sheets trả về dữ liệu dạng mảng (getValues()) thay vì Object. App tự động map Cột A=Time, B=ID, C=Content.
    - **Date Parsing**: Hỗ trợ dấu gạch ngang `-` (ví dụ: `09-04-2026`) thường xuất hiện trên một số dòng của người dùng.
- **Trạng thái**: Khả năng tương thích dữ liệu cao hơn.

---

## [V1.1.3 Beta] - 04/2026
- **Tính năng mới**: 
    - **In-Tab Scan**: Quét mã tại Tab bằng Modal `search-scan-modal`, không nhảy Tab.
    - **Download Data**: Nút "TẢI DỮ LIỆU" thay thế cho nút "Làm mới".
    - **Stats**: Hiển thị tổng số đơn hàng (`total-count-header`) trên đầu danh sách.
- **Logic**: Sử dụng 2 bộ quét độc lập (`html5QrCode` cho tab chính, `searchScanner` cho modal).
- **Trạng thái**: Ổn định nhất cho PC và Mobile.

---

## [V1.1.2 Beta] - 04/2026
- **Thay đổi quan trọng**:
    - **Quy tắc 3 ký tự**: Giới hạn chỉ hiện gợi ý/tìm kiếm khi có >= 3 ký tự.
    - Hiển thị cảnh báo nếu gõ 1-2 ký tự.
- **Logic**: Kiểm tra `query.length` trước khi gọi `displayRemoteData`.

---

## [V1.1.1 Beta] - 04/2026
- **Tính năng mới**: 
    - Nút **TẤT CẢ** để xem nhanh bộ nhớ đệm (Cache).
    - Tối ưu Render: Chỉ hiện tối đa 100-200 kết quả để tăng tốc độ UI.
- **Logic**: Lọc trực tiếp từ `remoteDataCache` với độ trễ (latency) bằng 0.

---

## [V1.1.0 Beta] - 04/2026
- **Cải tiến lớn về Dữ liệu**:
    - **Lọc 30 ngày**: Tải toàn bộ nhưng chỉ lưu đơn hàng trong vòng 1 tháng.
    - **Bỏ trùng**: Khử trùng mã đơn hàng dựa trên `content` (giữ đơn mới nhất).
    - **Chuẩn hóa thời gian**: Chuyển toàn bộ sang `DD/MM/YYYY HH:mm:ss`.
- **Logic kỹ thuật**: Bổ sung hàm `formatDate()`, `parseDate()` và logic `uniqueMap` trong `fetchDataFromSheets`.

---

## [V1.0.0 Beta] - 04/2026
- **Nền tảng Diamond Edition**:
    - Giao diện Tím - Vàng Gold (Modern Dark Scheme).
    - **PC Mode**: Hỗ trợ giám sát 2 camera đồng thời và ghi hình (.webm).
    - **Kích hoạt**: Hệ thống Activation Key (310824).
    - **Đồng bộ**: Kết nối Google Sheets cơ bản.

---

### Hướng dẫn khôi phục (Dành cho AI):
Nếu người dùng yêu cầu quay lại một phiên bản cụ thể:
1.  Đọc mục tương ứng để hiểu Logic và UI ở thời điểm đó.
2.  So sánh với mã nguồn hiện tại để gỡ bỏ hoặc thay đổi các hàm liên quan.
3.  Lưu ý: Luôn kiểm tra tính tương thích của dữ liệu trong `localStorage` khi quay lại bản cũ.

---
*Cập nhật bởi Antigravity AI - Phiên bản V1.1.6.*
