# ADR-004: Mô hình Profile OS Dùng Chung và Phân Tách Danh Tính Xác Thực

## Metadata

| Field | Value |
|---|---|
| **Status** | Proposed |
| **Date** | 2026-11-05 |
| **Deciders** | Nhóm tác giả ĐATN & Giảng viên hướng dẫn |
| **Supersedes** | Quyết định Phương án B trong Spike S4 (Tài khoản riêng `stu_<id>`) |

---

## Context

Trong thiết kế ban đầu và thử nghiệm Spike S4, hệ thống giả định tạo tài khoản Linux riêng biệt cho từng sinh viên trên mỗi máy trạm (`stu_<sanitized_external_id>`). Mục đích ban đầu là tận dụng phân quyền tự nhiên của Linux (DAC `750`) để cô lập dữ liệu cá nhân.

Tuy nhiên, khi đối chiếu với **thực tiễn vận hành phòng lab máy tính đại học**, mô hình tài khoản riêng bộc lộ những bất cập nghiêm trọng:
1. **Khó khăn chuẩn bị môi trường môn học:** Giảng viên cần cài đặt sẵn extension VS Code, biến môi trường (PATH), conda environment, SDK công cụ (Docker, Packet Tracer, Quartus...) và các tệp dữ liệu bài tập cho cả lớp. Nếu mỗi sinh viên có một tài khoản riêng, thư mục `/home/stu_*` mới toanh được sinh ra từ `/etc/skel`, làm mất toàn bộ cấu hình chuẩn bị của giảng viên. Giảng viên không thể đi cấu hình thủ công cho hàng trăm/hàng ngàn sinh viên.
2. **Cạn kiệt dung lượng ổ đĩa (Disk Exhaustion):** Qua nhiều học kỳ với hàng ngàn sinh viên luân phiên, máy trạm sẽ tích tụ hàng ngàn thư mục `/home/stu_*`, gây tràn ổ cứng và làm phức tạp hóa công tác dọn dẹp user database.
3. **Độ trễ đăng nhập lần đầu (First-run Latency):** Spike S6 ghi nhận khi một tài khoản mới đăng nhập lần đầu, môi trường GNOME Shell mất thêm **8.0 đến 9.5 giây** chỉ để khởi tạo cấu hình desktop và D-Bus, làm giảm thời lượng sử dụng hữu ích của sinh viên trong ca học.

Do đó, cần điều chỉnh thiết kế: **Hệ thống chuyển trọng tâm sang Kiểm soát truy cập (Access Control / Gatekeeper)** — xác thực sinh viên có quyền ngồi vào máy trong khung giờ học hay không, sau đó cấp quyền mở vào tài khoản OS dùng chung đã được chuẩn bị sẵn.

---

## Decision Drivers

- **Thực tiễn đào tạo:** Giảng viên cấu hình một lần trên profile dùng chung, mọi sinh viên trong ca học đều dùng được ngay lập tức.
- **Tốc độ đăng nhập 0-chạm:** Vào thẳng Desktop GNOME đã nạp sẵn mà không chịu độ trễ tạo mới profile.
- **Tính khả thi vận hành:** Không phát sinh gánh nặng tạo/xóa tài khoản OS trên từng máy trạm; không lo cạn kiệt ổ cứng.
- **Toàn vẹn nhật ký kiểm toán (Audit Trail):** Dù dùng chung tài khoản Linux, hệ thống vẫn phải ghi nhận chính xác 100% sinh viên nào (thẻ UID nào) đã mở máy vào thời điểm nào.

---

## Options Considered

### Option 1: Tài khoản cá nhân động (`stu_<id>`) — Mô hình cũ
- **Ưu điểm:** Cách ly thư mục cá nhân tốt qua phân quyền DAC Linux.
- **Nhược điểm:** Không thể chuẩn bị môi trường dùng chung; tốn dung lượng đĩa; độ trễ first-run cao.

### Option 2: Tài khoản OS dùng chung (Shared Workstation Profile) — Được chọn
- **Ưu điểm:**
  - Giảng viên/kỹ thuật viên cấu hình ứng dụng, môi trường và file bài tập trên các profile dùng chung (ví dụ `student`, `labuser`).
  - Đăng nhập tức thì 0-chạm.
  - Phân tách rõ ràng giữa:
    - **Danh tính xác thực (User/Card):** Dùng để kiểm tra quyền truy cập (CR-001) và ghi nhận vào `AuditLog`.
    - **Profile đăng nhập (`os_username`):** Dùng để mở phiên Desktop tương ứng.
- **Nhược điểm & Giới hạn:** Dữ liệu cá nhân, cookie trình duyệt, lịch sử terminal có thể được nhìn thấy giữa các người dùng liên tiếp nếu không dọn dẹp.

---

## Decision

Chúng tôi quyết định áp dụng **Mô hình Profile OS Dùng Chung (Shared Workstation Profile)** với các nguyên tắc kiến trúc sau:

1. **Thực thể `WorkstationProfile` & Cơ chế Tự phát hiện (Auto-Discovery):**
   - Tài khoản Linux dùng chung được tạo sẵn trên máy trạm thông qua Master Image (Clonezilla/PXE) hoặc do kỹ thuật viên tạo trực tiếp (`adduser`).
   - Khi khởi động (Hello) hoặc gửi Heartbeat, Agent tự động quét các user hợp lệ trên máy (thuộc nhóm `labstudent` hoặc khai báo trong config máy) và gửi danh mục profile hiện có lên Server.
   - Server tự động lưu trữ và cập nhật danh mục allowlist profile của máy trạm mà không cần lệnh can thiệp tạo từ xa. Kỹ thuật viên có thể bổ sung tài khoản mới bất kỳ lúc nào; Agent sẽ tự động cập nhật với Server trong lần kết nối tiếp theo.
   - Agent và PAM từ chối tuyệt đối việc mở phiên vào tài khoản không nằm trong allowlist hợp lệ (`profile_not_found`, `profile_disabled`).
2. **Quy định Schedule và Giải quyết Profile Đích (Target Profile Resolution - A1):**
   - Mỗi Schedule có thể chỉ định `target_os_username` (ví dụ `student`, `labuser`) hoặc để trống để kế thừa profile mặc định của máy trạm. Thiết kế này giải quyết triệt để vấn đề một Schedule gán cho cả Zone nhiều máy mà không bị ràng buộc bởi `target_profile_id` cục bộ theo máy. Khi dựng snapshot, Server resolve `target_os_username` vào allowlist của từng máy.
   - Khi hợp quyền nhiều Schedule khớp cho một lần quẹt (BR-016), nếu các Schedule này trỏ tới nhiều `target_os_username` khác nhau, kết quả là **mơ hồ và bị từ chối tuyệt đối** (`denied(ambiguous_profile)`). Cấm chọn ngầm theo thứ tự ưu tiên.
3. **Chính sách kết thúc phiên và dọn dẹp tiến trình (A6):**
   - Khi hết giờ phiên hoặc khi có người khác thay thế phiên hợp lệ: Agent kích hoạt Two-Phase Teardown tiêu diệt 100% tiến trình chạy ngầm thuộc user slice (`loginctl terminate-user <UID>`, chờ 2s, cưỡng chế `loginctl kill-user <UID> -s SIGKILL` hoặc `pkill -9 -u <UID>`). Cấu hình SSHD có `DenyGroups labstudent` và tắt linger (`loginctl disable-linger`).
   - **Tuyệt đối KHÔNG tự động xóa thư mục `/home` hay dữ liệu file cục bộ** của profile dùng chung sau phiên. Sinh viên lưu bài tập trên máy; việc dọn dẹp file do giảng viên hoặc kỹ thuật viên thực hiện định kỳ.
4. **Vô hiệu hóa Lock Screen cho Profile dùng chung (A3):**
   - Do tài khoản dùng chung đã bị khóa mật khẩu (`passwd -l`) và GNOME lock screen trên LightDM không hỗ trợ quẹt thẻ mở khóa, sinh viên có thể tự khóa mình cho đến hết ca học nếu màn hình bị khóa.
   - Master Image bắt buộc cấu hình dconf vô hiệu hóa màn hình khóa: `org.gnome.desktop.screensaver lock-enabled=false` và `org.gnome.desktop.lockdown disable-lock-screen=true`.
5. **Nhận thức rủi ro & Khuyến nghị vận hành (A4):**
   - Thừa nhận rủi ro `workstation_busy` (A4): Sinh viên rời máy mà quên đăng xuất thì máy tiếp tục bận đến hết hạn ca học; kỹ thuật viên xử lý bằng đăng xuất thủ công (fallback).
   - Thừa nhận giới hạn: Các ứng dụng chạy trong cùng một user OS sẽ chia sẻ cookie, session trình duyệt và lịch sử terminal.
   - Khuyến nghị quy trình: Sinh viên nộp bài chính thức lên hệ thống trực tuyến (LMS, Google Classroom, Git...) và chủ động đăng xuất tài khoản web cá nhân trước khi rời máy.

---

## Consequences

- **Tích cực:**
  - Đáp ứng trọn vẹn nghiệp vụ thực tế của phòng lab đại học.
  - Loại bỏ hoàn toàn sự phức tạp của cơ chế provisioning tài khoản động trên Edge.
  - Đảm bảo đăng nhập 0-chạm mượt mà, ổn định.
- **Cần theo dõi & Xác nhận:**
  - Quy chuẩn đặt tên profile trên các máy trạm (ví dụ thống nhất `student` làm profile mặc định).
  - Khuyến nghị giảng viên hướng dẫn sinh viên không lưu mật khẩu cá nhân trên trình duyệt của máy dùng chung.
