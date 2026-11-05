# Kết quả Spike S2: PAM và Agent qua Socket

## Câu hỏi
Một PAM module tối giản nói chuyện với Agent qua Unix domain socket, mà không bao giờ chặn đường dự phòng, được không? Và có thể gán `PAM_USER` động khi truyền username rỗng không?

## Cách thử
- Xây dựng Agent giả lập bằng Python (`s2_fake_agent.py`) lắng nghe trên Unix Domain Socket (`/run/nfc-agent.sock`).
- Viết PAM module C tối giản (`pam_nfc.c` biên dịch thành `pam_nfc.so`) triển khai `pam_sm_authenticate` giao tiếp IPC với Agent, sử dụng `poll()` với timeout 3000ms.
- Tạo service PAM thử nghiệm riêng `/etc/pam.d/nfctest`:
  ```text
  auth sufficient pam_nfc.so
  auth required   pam_unix.so
  ```
- Sử dụng `pamtester` trên môi trường máy ảo Ubuntu 22.04 để kiểm thử độc lập 4 kịch bản.

## Kết quả

| Ca test | Kỳ vọng | Thực tế | Đạt? |
|---|---|---|---|
| **Ca 1: Quẹt hợp lệ** | Agent trả `granted` → PAM thành công ngay, không hỏi mật khẩu | `pamtester: successfully authenticated` không cần gõ mật khẩu | ✅ Đạt |
| **Ca 2: Agent chết** | Không tìm thấy socket → Trả `PAM_IGNORE`, fallback hỏi mật khẩu Linux | Hiện nhắc `Password:`, nhập mật khẩu đúng thì xác thực thành công | ✅ Đạt |
| **Ca 3: Agent treo** | Timeout sau 3 giây → Tự đóng socket, fallback sang mật khẩu Linux | Sau đúng 3s ngắt, hiện `Password:`, phía Agent nhận `Broken pipe` | ✅ Đạt |
| **Bước 6: Username rỗng** | Gọi với username `""` → PAM nhận diện user từ Agent và gán `PAM_USER` | `PAM_USER` được gán thành `binhtong` động qua `pam_set_item`, xác thực thành công | ✅ Đạt |
| **Ca 4: An ninh `SO_PEERCRED`** | Lọc định danh tiến trình kết nối socket ở cấp nhân Linux | Khi mở socket quyền `0666` để kiểm thử logic lọc cấp nhân: Tiến trình user thường (`binhtong`, UID=1000) kết nối thành công qua syscall `connect()` nhưng bị Agent bóc tách cấu trúc `ucred` và từ chối ngay lập tức (`permission_denied_not_root`); chỉ tiến trình chạy quyền root (UID=0, như Display Manager/PAM) mới được cấp phép giao tiếp | ✅ Đạt (Kiểm chứng Nhóm 3.1) |
| **Ca 5: Chống Replay (`entry_id`)** | Ngăn chặn kẻ gian gửi lại token cũ để chiếm quyền | Token chỉ dùng đúng 1 lần duy nhất; gửi request lần 2 lập tức bị chặn với lý do `token_already_consumed` | ✅ Đạt (Kiểm chứng Nhóm 3.1) |
| **An toàn hệ thống** | Không ca nào gây đơ hay kẹt cứng máy | Fallback hoạt động trơn tru trong mọi kịch bản lỗi | ✅ Đạt |

## Số liệu
- **Thời gian xác thực thực tế (Latency):** `0m0.022s` (22 mili-giây).
  - `user`: 0.003s
  - `sys`: 0.011s
- **Độ trễ timeout:** Đúng 3.0 giây khi Agent không phản hồi.
- **Quyền hạn file socket & An ninh nhân Linux:** 
  - Mô hình phòng thủ 2 lớp (Defense-in-Depth):
    - *Lớp 1 (Filesystem DAC):* Trong vận hành thực tế, file socket được cấp quyền `0660 root:root` (hoặc `root:lightdm`), chặn đứng người dùng thường ngay tại bước gọi syscall `connect()`.
    - *Lớp 2 (Kernel Peer Credentials):* Trong ca kiểm thử Ca 4 (mở tạm `0666` để kiểm thử bộ lọc nhân), Agent truy vấn cấu trúc `ucred` qua cờ `SO_PEERCRED` trên socket Unix (`AF_UNIX`). Kiểm soát chặt chẽ PID, UID, GID do chính nhân Linux chứng thực, ngăn chặn triệt để nguy cơ tấn công mạo danh từ các tiến trình người dùng không có đặc quyền root (kể cả khi file socket bị cấu hình sai quyền truy cập).
  - Chống Replay: Mỗi quyết định gắn liền với `entry_id` duy nhất và bị vô hiệu hóa ngay sau lần tiêu thụ đầu tiên.

## Kết luận
**ĐẠT XUẤT SẮC**. 
- Kiến trúc PAM C module tối giản kết hợp với IPC Unix Domain Socket hoàn toàn khả thi, cực kỳ nhẹ và có thời gian phản hồi tức thì (22ms).
- Cơ chế dự phòng (NFR-M01, BR-004) hoàn toàn tin cậy: Khi Agent crash hoặc treo, hệ thống tự động rơi về mật khẩu cục bộ mà không gây gián đoạn hay kẹt phiên đăng nhập.
- Giải quyết được bài toán hóc búa nhất cho **S3**: Có thể bắt đầu chuỗi PAM với username rỗng `""` và cập nhật danh tính người dùng động qua `pam_set_item(pamh, PAM_USER, username)`.

## ADR bị ảnh hưởng
- **ADR "PAM và Greeter":** Chốt phương án sử dụng Unix Domain Socket cho IPC giữa PAM module và Agent. Module PAM chỉ đóng vai trò ủy quyền (stateless client), toàn bộ logic nghiệp vụ (kiểm tra hạn thẻ, snapshot, quyền) giao cho Agent xử lý.
- **ADR "Ánh xạ tài khoản OS":** Xác nhận PAM module có khả năng inject username linh hoạt sau khi Agent phân giải chủ thẻ.

## Giả định trong 01-05 bị lung lay
- **Không có.** Giả định về tính khả thi của PAM module và fallback mật khẩu là hoàn toàn chính xác.

## Ghi chú
- Header `pam_nfc.c` bắt buộc cần có `#include <syslog.h>` để định nghĩa các hằng số log (`LOG_WARNING`, `LOG_INFO`).
- Khi khởi động lại Agent thử nghiệm, cần đảm bảo dọn sạch tiến trình cũ (`pkill -9 -f ...` và xóa file socket cũ) để tránh xung đột kết nối.
