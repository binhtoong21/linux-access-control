# Kết quả Spike S3: Greeter và Màn hình khóa

## Câu hỏi
Có thể hiển thị đúng các trạng thái của FR-010 và đăng nhập không cần gõ username/mật khẩu trên màn hình chào thật không? Chốt Display Manager nào? Xử lý màn hình khóa (quy tắc BR-008, `superseded`) như thế nào khi có phiên đang chạy?

## Cách thử
- Chuyển Display Manager mặc định của Ubuntu 22.04 từ GDM3 sang LightDM (`lightdm-gtk-greeter`).
- Cấu hình `/etc/pam.d/lightdm` chèn `auth sufficient pam_nfc.so` lên đầu chuỗi xác thực `auth`.
- Chạy Agent giả lập `s2_fake_agent.py` qua Unix Domain Socket (`/run/nfc-agent.sock`).
- Thực hiện chuỗi thử nghiệm thực tế trên màn hình máy ảo:
  1. Đăng nhập trực tiếp qua giao diện LightDM với ô mật khẩu để trống.
  2. Kiểm tra hiện tượng màn hình khóa khi gọi `loginctl lock-session`, `dm-tool switch-to-greeter`, và `dm-tool lock`.
  3. Kiểm chứng cơ chế hủy phiên `sudo loginctl terminate-session <ID>` để thay thế phiên (`superseded`).
  4. Kiểm chứng cơ chế dự phòng (Fallback): Tắt Agent và kiểm tra xem LightDM có tự động hiển thị lại ô nhập mật khẩu hay không.

## Kết quả

| Ca test | Kỳ vọng | Thực tế | Đạt? |
|---|---|---|---|
| **Ca 1: Chuyển đổi Display Manager** | Hệ thống chạy ổn định với LightDM thay cho GDM3 | Chuyển thành công sang LightDM GTK Greeter; khắc phục crash host VirtualBox bằng cách tắt 3D Acceleration | ✅ Đạt |
| **Ca 2: Đăng nhập NFC qua Greeter** | Bấm Login không cần gõ mật khẩu → vào thẳng Desktop | Thành công vào Desktop GNOME; log xác nhận `Session pid=1176: Authentication complete: Success` | ✅ Đạt |
| **Ca 3: Tự động ẩn ô mật khẩu** | Khi quẹt thẻ/xác thực NFC, màn hình không yêu cầu bàn phím | LightDM tự động ẩn ô nhập mật khẩu do `pam_nfc.so` không phát yêu cầu hội thoại bàn phím (`PAM_PROMPT_ECHO_OFF`) | ✅ Đạt |
| **Ca 4: Khảo sát Màn hình khóa** | Màn hình khóa kích hoạt PAM để nhận quẹt thẻ mở khóa | Thất bại: GNOME Shell xung đột với `light-locker` (báo "Lock disabled", crash `light-locker`); `dm-tool` chỉ phục hồi phiên mà không gọi PAM | ⚠️ Bác bỏ giả định ban đầu |
| **Ca 5: Cơ chế thay thế phiên (BR-008)** | Cưỡng chế kết thúc phiên cũ để người mới đăng nhập | `sudo loginctl terminate-session <ID>` dọn sạch phiên Desktop cũ trong < 0.2s, đưa màn hình về Greeter sạch sẽ | ✅ Đạt |
| **Ca 6: Fallback khi Agent tắt** | Màn hình tự phục hồi hỏi mật khẩu cục bộ (BR-004) | Khi Agent chết, `pam_nfc.so` trả `PAM_IGNORE`, LightDM tự động làm xuất hiện lại ô nhập mật khẩu | ✅ Đạt |
| **Ca 7: Xác thực Danh tính Động (`PAM_USER`)** | LightDM chấp nhận đổi user từ Greeter sang user quẹt thẻ | Khởi tạo auth cho `dummyuser`, module PAM đổi `PAM_USER` thành `binhtong`. LightDM đọc lại thành công, cấp quyền `User authorized` và mở phiên `c6` cho `binhtong` | ✅ Đạt (Kiểm chứng Giai đoạn 1.1) |
| **Ca 8: Đăng nhập tài khoản bị khóa mật khẩu (`passwd -l`) (A3)** | Tài khoản shared profile bị `passwd -l` vẫn đăng nhập bình thường qua `pam_nfc.so` | Thành công 100%: `pam_nfc.so` trả `PAM_SUCCESS` và gán `PAM_USER`, bỏ qua `pam_unix.so` nên trạng thái khóa mật khẩu không ảnh hưởng đến quẹt thẻ | ✅ Đạt |

## Số liệu
- **Thời gian xử lý xác thực của `pam_nfc.so` trong LightDM:** ~0.03 giây (từ khi nhận request đến khi cấp `User authorized`).
- **Thời gian cưỡng chế hủy phiên (`loginctl terminate-session`):** < 0.2 giây để giải phóng seat và nạp lại Greeter sạch.
- **Tính khả dụng của đường dự phòng:** Ô mật khẩu xuất hiện ngay lập tức ở lần khởi tạo Greeter tiếp theo khi socket Agent không phản hồi.
- **Bằng chứng Nhật ký Thực nghiệm LightDM (Ca 7):**
  ```text
  DEBUG: Greeter start authentication for dummyuser
  DEBUG: Session pid=10915: Started with service 'lightdm', username 'dummyuser'
  DEBUG: Session pid=10915: Authentication complete with return value 0: Success
  DEBUG: Authenticate result for user binhtong: Success
  DEBUG: User binhtong authorized
  DEBUG: Creating shared data directory /var/lib/lightdm-data/binhtong
  DEBUG: Activating login1 session c6
  DEBUG: Seat seat0 changes active session to c6
  ```

## Kết luận
**ĐẠT VỚI ĐIỀU CHỈNH KIẾN TRÚC QUAN TRỌNG:**
1. **Chốt Display Manager:** Chọn **LightDM** cho các máy trạm phòng lab. GDM3 quá đóng kín và không hỗ trợ các luồng PAM tùy biến linh hoạt như LightDM.
2. **Cơ chế xác thực không mật khẩu:** Hoàn toàn khả thi và mượt mà. LightDM tự động ẩn ô nhập mật khẩu khi module PAM đầu tiên là `auth sufficient pam_nfc.so`.
3. **Màn hình khóa và quy tắc BR-008 (`superseded`):** 
   - Bác bỏ phương án dựa vào màn hình khóa của Desktop OS (GNOME Shell / screensaver), vì cơ chế này xung đột mạnh với Display Manager bên ngoài.
   - **Chốt phương án kiến trúc & Vô hiệu hóa Lock Screen (A3):** 
     - Vì tài khoản đã bị khóa mật khẩu (`passwd -l`), nếu màn hình khóa GNOME kích hoạt, sinh viên sẽ không thể mở khóa (tự nhốt mình đến hết ca học).
     - **Bắt buộc cấu hình Master Image (Checklist):** Vô hiệu hóa triệt để màn hình khóa và screensaver lock trong dconf:
       * `dconf write /org/gnome/desktop/screensaver/lock-enabled false`
       * `dconf write /org/gnome/desktop/lockdown/disable-lock-screen true`
     - Quyền kiểm soát phiên và thay thế phiên (`superseded`) được giao cho **Agent daemon**. Khi phát hiện quẹt thẻ của người dùng khác lúc máy đang có phiên, Agent trực tiếp điều phối kết thúc phiên cũ theo quy trình BR-008/BR-009.

## ADR bị ảnh hưởng
- **ADR "PAM và Greeter":** Chốt sử dụng LightDM; chốt cấu hình `auth sufficient pam_nfc.so` trước `common-auth`; ghi nhận cơ chế pre-authentication của LightDM Greeter.
- **ADR "Ánh xạ tài khoản OS và kết thúc phiên (BR-008)":** Chốt cơ chế `superseded` thông qua `systemd-logind` API (`loginctl terminate-session`) do Agent thực thi, loại bỏ sự phụ thuộc vào màn hình khóa desktop.

## Giả định trong 01-05 bị lung lay
- **Giả định ban đầu:** *"Màn hình khóa là thành phần khác greeter, cần PAM service riêng để nhận quẹt thẻ"* → **Bị lung lay và thay thế**. Trong thực tế, không cần duy trì 2 service PAM phức tạp; Agent daemon quản lý vòng đời phiên qua `loginctl` mang lại độ tin cậy và sự nhất quán cao hơn nhiều.

## Ghi chú kỹ thuật
- **Cảnh báo GNOME Keyring:** Khi đăng nhập không dùng mật khẩu, GNOME Keyring không thể tự động giải mã két khóa cá nhân, dẫn đến popup thông báo lướt qua. Trong môi trường phòng lab sinh viên, cần cấu hình tắt prompt của GNOME Keyring hoặc cấp keyring rỗng tự động.
- **Cơ chế Pre-authentication của LightDM:** LightDM tự động kích hoạt tiến trình PAM ngầm ngay khi Greeter vừa nạp giao diện người dùng. Cần lưu ý điều này khi xử lý trạng thái sẵn sàng của Agent.
