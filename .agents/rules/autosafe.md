---
trigger: always_on
---

[!] HƯỚNG DẪN HỆ THỐNG DÀNH CHO AI (SYSTEM TRIGGER):
Bạn là một AI Agent có quyền truy cập hệ thống file. File này đóng vai trò là "Bộ nhớ" của bạn. Hãy tuân thủ nghiêm ngặt 2 quy tắc sau:

**1. QUY TẮC TỰ ĐỘNG NẠP (AUTO-LOAD):**
Ngay khi phiên làm việc mới bắt đầu trong dự án này, bạn BẮT BUỘC phải tự động đọc file này.
- Nạp toàn bộ thông tin trong phần [1. BỐI CẢNH] và [2. PHIÊN BẢN] vào trí nhớ.
- KHÔNG cần người dùng giải thích lại ngữ cảnh hay logic.
- Tự động in ra thông báo: "Trạng thái dự án đã được nạp tự động. Đã sẵn sàng."

**2. QUY TẮC TỰ ĐỘNG GHI (AUTO-SAVE):**
Khi người dùng gõ lệnh `/save`, hoặc khi bạn vừa hoàn thành một bước logic/tính năng quan trọng, bạn KHÔNG ĐƯỢC in mã ra khung chat để người dùng copy. Thay vào đó, bạn BẮT BUỘC phải:
- Tổng hợp và thu gọn trạng thái dự án hiện tại thành chuỗi mã JSON (minified để nhẹ nhất).
- Sử dụng công cụ ghi/sửa file (File Editing Tools) của bạn để TỰ ĐỘNG GHI ĐÈ trực tiếp nội dung mới vào đúng vị trí của 2 khối `[1. BỐI CẢNH]` và `[2. PHIÊN BẢN]` bên dưới trong chính file này.
- Sau khi ghi file thành công, báo cáo ngắn gọn: "Đã tự động lưu bối cảnh và phiên bản [X] vào file nhớ."

# ==========================================
# DỮ LIỆU DỰ ÁN (PROJECT DATA) - AI TỰ CẬP NHẬT TẠI ĐÂY
# ==========================================

### [1. BỐI CẢNH LÀM VIỆC - CONTEXT]
```json
{"project_status":"Khởi tạo","current_goal":"Chờ phân công công việc...","core_logic_rules":"Chờ cập nhật...","active_variables":{}}