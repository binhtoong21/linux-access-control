# 👥 stakeholders.md

## Stakeholder Map
| Stakeholder | Vai trò | Ảnh hưởng | Quan tâm chính |
|---|---|---|---|
| Giảng viên hướng dẫn | Người đặt đề bài, nghiệm thu | High | Đúng yêu cầu đề bài, chạy ổn trên Linux, demo thuyết phục |
| Quản trị viên phòng máy | Vận hành hàng ngày | High | Quản lý lịch tập trung, theo dõi máy, ít thao tác thủ công |
| Sinh viên / nhân viên | Người quẹt thẻ | High | Quẹt thẻ là vào, biết lý do khi bị từ chối |
| Bộ phận IT | Triển khai, bảo trì | Medium | Dễ cài agent, dễ thêm máy |

## Actors & Goals
| Actor | Loại | Mục tiêu |
|---|---|---|
| End User | User | Quẹt thẻ để đăng nhập; nhận lý do rõ ràng khi bị từ chối |
| Admin | User | Quản lý user, nhóm, thẻ, máy, phòng; tạo và sửa lịch; xem máy online hoặc offline; xem nhật ký đăng nhập; vô hiệu hóa thẻ hoặc user |
| Agent (trên PC) | System | Nhận dữ liệu từ server; đọc thẻ NFC; hiển thị màn hình login; tự quyết định cho đăng nhập; tự đăng xuất khi hết giờ; ghi log cục bộ rồi đẩy lên; gửi heartbeat |
| Server | System | Lưu và quản lý lịch, user, thẻ; đồng bộ xuống PC qua MQTT; theo dõi heartbeat; nhận và lưu nhật ký từ PC |

## Personas
- **Sinh viên Minh:** đến phòng máy đúng giờ thực hành, muốn quẹt thẻ vào ngay, không nhớ mật khẩu.
- **Anh Tuấn, quản trị 2 phòng (40 máy):** xếp lịch cho các lớp, muốn đổi lịch một nơi mà tất cả máy tự cập nhật, muốn thấy máy nào đang tắt.

## Communication Plan
| Stakeholder | Kênh | Tần suất | Nội dung |
|---|---|---|---|
| Giảng viên hướng dẫn | Họp trực tiếp hoặc online | 1 đến 2 tuần/lần | Tiến độ, demo, xin xác nhận quyết định thiết kế |
| Sinh viên | Khi UAT | Khi thử nghiệm | Trải nghiệm quẹt thẻ, thông báo lỗi |