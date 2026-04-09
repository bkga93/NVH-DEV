# NHẬT KÝ THAY ĐỔI (CHANGELOG) - TCT SCANNER PRO

Tất cả các thay đổi quan trọng đối với dự án **TCT Scanner Pro** sẽ được lưu lại tại đây.

---

## [2.3.2] - 2026-04-09
### Added
- Tạo file `CHANGELOG.md` chính thức để theo dõi lịch sử cập nhật.
- Cập nhật hiển thị Version v2.3.2 tại Tiêu đề và Footer của ứng dụng.
### Fixed
- **Quy tắc tìm kiếm 3 ký tự:** Áp dụng quy định chỉ hiển thị gợi ý và kết quả khi người dùng gõ từ 3 ký tự trở lên để tránh làm chậm hệ thống và hiện dữ liệu thừa.
- Ẩn danh sách gợi ý tự động khi từ khóa quá ngắn tại tab Dữ liệu và Xem lại.

---

## [2.3.1] - 2026-04-09
### Fixed
- Sửa lỗi logic Tìm kiếm tại tab **Dữ liệu**.
- Khắc phục lỗi không hiển thị Gợi ý tìm kiếm tại tab **Xem lại**.
- Tối ưu hóa bộ nhớ đệm (cache) để phản hồi kết quả tìm kiếm tức thì.

---

## [2.3.0] - 2026-04-09
### Added
- **Snapshot (Chụp ảnh bằng chứng):** Tự động chụp ảnh gói hàng ngay khi phát hiện mã QR.
- **Tracking (Theo dõi thời gian):** Tự động ghi nhận giờ **Bắt đầu** (khi thấy đơn) và giờ **Kết thúc** (khi đóng gói xong).
- **Hỗ trợ Camera IP:** Tích hợp WebRTC qua `go2rtc` để xem luồng trực tiếp từ đầu ghi Dahua (chuẩn H.264).
- **Trạng thái Đang đóng gói:** Hiển thị hiệu ứng nhấp nháy khi đơn hàng đang được xử lý dưới camera.

---

## [2.2.0] - 2026-04-08
### Changed
- Nâng cấp giao diện **Diamond Edition** (Modern Dark Theme).
- Tích hợp thư viện `jsQR` để tăng tốc độ nhận diện mã QR cho Camera IP.
- Đồng bộ dữ liệu nâng cao với Google Sheets (Hỗ trợ Append & Update).

---

## [2.1.0] - 2026-04-07
### Added
- Chế độ **PC Mode** (Giao diện giám sát đa màn hình).
- Hệ thống kích hoạt bản quyền (Activation Key) bảo mật mới.
- Hỗ trợ lưu trữ cấu hình camera và server vào LocalStorage.

---

## [1.x.x] - Phên bản cũ
- Các tính năng cơ bản về quét mã, đồng bộ Sheets và lưu lịch sử máy.

---
*Thực hiện bởi NVH*
