# 🎯 problem.md

## Bài toán

Tại các phòng máy dùng chung, nhiều nhóm người dùng luân phiên sử dụng máy Linux theo lịch. Hiện việc đăng nhập dựa trên tài khoản cục bộ và mật khẩu dùng chung, nên không gắn được phiên sử dụng với từng người, không giới hạn được theo khung giờ, và admin phải thao tác thủ công trên từng máy.

Cần một hệ thống gồm **server** (quản lý lịch, đồng bộ, theo dõi máy) và **agent trên mỗi PC** (nhận lịch, hiển thị màn hình login, cho đăng nhập bằng thẻ NFC). PC giữ dữ liệu lịch cục bộ và **tự quyết định** cho đăng nhập, không phụ thuộc server tại thời điểm quẹt thẻ.

Phòng máy đại học là bối cảnh pilot của đồ án.

## Ràng buộc từ đề bài

- Đăng nhập PC bằng thẻ NFC (khuôn mặt là phương thức bổ sung, xem Goals).
- Server có: phân lịch, quản lý lịch, MQTT, health check.
- PC có: nhận lịch, xử lý màn hình login, cho phép đăng nhập bằng NFC.

## Pain Points

| # | Pain Point | Ảnh hưởng |
|---|-----------|----------|
| 1 | Tài khoản dùng chung, không truy vết được ai dùng máy | Sự cố xảy ra không xác định được người chịu trách nhiệm |
| 2 | Mật khẩu chia sẻ cho nhóm lớn dễ bị lộ | Người ngoài truy cập trái phép |
| 3 | Đổi mật khẩu thủ công trên từng máy khi thay đổi nhân sự | Tốn công, dễ sót |
| 4 | Không giới hạn được theo khung giờ, không phân phòng theo lịch | Máy bị dùng sai giờ, sai đối tượng |
| 5 | Người dùng hay quên mật khẩu bị đổi liên tục | Mất thời gian đầu giờ |
| 6 | Không biết máy nào đang bật, tắt, mất mạng | Phải đi kiểm tra tại chỗ |

## Goals

### Core
- **G1**: PC cho đăng nhập bằng thẻ NFC; mỗi phiên gắn với một người cụ thể.
- **G2**: Server quản lý lịch tập trung: ai (user hoặc nhóm), ở đâu (máy hoặc phòng), khi nào (khung giờ lặp).
- **G3**: Server đồng bộ dữ liệu xuống PC qua MQTT; PC hoạt động theo dữ liệu cục bộ.
- **G4**: PC tự quyết định cho đăng nhập dựa trên dữ liệu cục bộ, kể cả khi mất liên lạc với server.
- **G5**: PC có màn hình login riêng: chờ quẹt thẻ, kết quả, lý do từ chối.
- **G6**: Server biết máy nào online hoặc offline (health check bằng heartbeat).

### Derived (hệ quả bắt buộc của core)
- D1: Quản lý user, nhóm, gắn thẻ với user; vô hiệu hóa thẻ hoặc user.
- D2: Định danh máy trạm để tham gia kênh MQTT.
- D3: Ghi nhật ký đăng nhập cục bộ rồi đẩy lên server.
- D4: Đường đăng nhập dự phòng cục bộ, không để máy bị khóa chết.
- D5: PC tự đăng xuất khi hết khung giờ.
- D6: Giao diện quản trị tối thiểu.
- D7: Quản lý Profile tài khoản Linux dùng chung trên máy trạm theo allowlist (không cấp sudo không mật khẩu, khóa mật khẩu cục bộ cho luồng quẹt thẻ, thu hồi sạch tiến trình khi hết phiên).

### Extension (làm sau)
Import Excel/CSV, tích hợp API cho hệ thống ngoài, buộc đăng xuất khi thu hồi, điều khiển máy từ xa, phát hiện nhàn rỗi, chống dò thẻ, cảnh báo, bản đồ phòng máy, webhook, nhiều vai trò quản trị, chính sách dọn dẹp dung lượng thư mục dùng chung định kỳ.

### Nice-to-have
- Xác thực khuôn mặt (thư viện có sẵn, xử lý cục bộ).

## Non-Goals
- Windows; phần cứng đầu đọc; cấp phát thẻ vật lý.
- Giám sát tình trạng phần cứng, kiểm kê thiết bị.
- Đa múi giờ, đa tổ chức trên một lần triển khai.

## Giả định
- "Phân lịch" hiểu là gán nhóm hoặc người vào máy hoặc phòng theo khung giờ; thầy có thể xác nhận lại.
- Dữ liệu cục bộ có thời hạn tin cậy (lease): quá hạn không liên lạc server thì PC ngừng cho đăng nhập bằng thẻ, chỉ còn dự phòng. Con số chọn sau.

## Tiêu chí thành công (định tính)
- Quẹt thẻ hợp lệ trong khung giờ được phép thì vào được; ngoài khung giờ hoặc không có lịch thì bị từ chối kèm lý do.
- Rút mạng khỏi PC thì vẫn đăng nhập được theo lịch đã nhận (trong thời hạn tin cậy).
- Sửa lịch hoặc thêm người trên server thì PC online nhận được thay đổi mà không cần thao tác tại máy.
- Mọi lần quẹt thẻ đều có bản ghi với danh tính cá nhân.
- Server hiển thị đúng máy online hoặc offline.