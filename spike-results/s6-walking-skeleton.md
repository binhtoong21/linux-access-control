# Kết quả Spike S6: Walking Skeleton (Tích hợp Luồng Đầu-Cuối)

> [!NOTE] Cập nhật định hướng kiến trúc sau Spike (ADR-004, D-006, D-009, A6)
> Trong thử nghiệm tích hợp Walking Skeleton (S6), các user `binhtong` và `labuser` được sử dụng đóng vai hai tài khoản thử nghiệm độc lập trên máy ảo. Phương án B (tạo động tài khoản theo sinh viên `stu_*` từng thử nghiệm ở S4 và đo đạc phân rã độ trễ `student_firstrun`) đã chính thức bị **ADR-004 thay thế bằng Mô hình Profile OS dùng chung (Shared Workstation Profile)**. Lệnh dọn phiên được chuẩn hóa thành `loginctl terminate-user` / `kill-user -s SIGKILL` theo user slice (A6), thay vì `kill-session` (vốn chỉ diệt scope của phiên GUI trong môi trường test máy ảo).

## Câu hỏi
Có thể ghép nối toàn bộ các thành phần độc lập từ S2 đến S5 thành một hệ thống tích hợp chạy luồng xuyên suốt tự động hay không? Từ sự kiện quẹt thẻ → đánh giá Snapshot (CR-001) → ghi nhật ký SQLite WAL → PAM cấp quyền mở cửa Desktop qua LightDM → theo dõi phiên đồ họa → bắn cảnh báo trước hạn qua D-Bus → tự động kết thúc phiên và dọn sạch tiến trình → trả về màn hình đăng nhập LightDM ban đầu?

## Cách thử
1. **Khởi tạo dữ liệu Snapshot giả lập:** Thiết lập tệp `~/spike/data/snapshot.json` chứa danh sách thẻ hợp lệ và thời hạn tin cậy.
2. **Triển khai Daemon Agent tích hợp (`s6_agent.py`):**
   - Đọc Snapshot và đánh giá quy tắc CR-001.
   - Quản lý giao dịch nguyên tử SQLite WAL (`~/spike/data/s6_agent.db`).
   - Mở Unix socket `/run/nfc-agent.sock` cho module PAM C `pam_nfc.so`.
   - Mở control socket `/run/nfc-control.sock` nhận sự kiện quẹt thẻ từ CLI simulator (`s6_swipe.py`).
   - Luồng giám sát phiên đồ họa (`seat0`): Đặt thời hạn phiên ca học cố định 30.0 giây (demo). Đến mốc còn 8 giây bắn popup cảnh báo D-Bus lên Desktop người dùng; đến mốc hết giờ tự động gọi `loginctl kill-session -s SIGKILL` theo scope cgroup của phiên.
3. **Thực thi Kịch bản Thử nghiệm:**
   - Đứng tại màn hình Lab Custom Greeter (`/usr/local/bin/lab_greeter.py`).
   - Chạy lệnh quẹt thẻ hợp lệ: `python3 s6_swipe.py valid`.
   - Quan sát diễn biến đăng nhập 0-chạm tự động chuyển vào Desktop máy ảo và kiểm tra dữ liệu nhật ký SQLite WAL sau khi kết thúc.

## Kết quả Thực nghiệm

| Giai đoạn trong chuỗi | Hành động / Kỳ vọng | Diễn biến thực tế | Đạt? |
|---|---|---|---|
| **1. Quẹt thẻ** | `s6_swipe.py` gửi thẻ `AABBCCDD` | Agent nhận diện thẻ, đánh giá CR-001 thành công, cấp quyền `GRANTED: binhtong` | ✅ Đạt |
| **2. Giao dịch Cục bộ** | Ghi đồng thời Audit Log và LocalSession | SQLite WAL ghi nhận bản ghi 1:1 thành công (`123ccd9b...`) | ✅ Đạt |
| **3. Xác thực PAM** | LightDM gọi `pam_nfc.so` | PAM nhận `granted`, gán `PAM_USER = binhtong`, mở cửa vào thẳng Desktop | ✅ Đạt |
| **4. Bắt phiên GUI** | Agent tự động phát hiện phiên đăng nhập mới | Agent bắt đúng ID phiên đồ họa `c32` trên `seat0` trong 0.5s | ✅ Đạt |
| **5. Cảnh báo D-Bus** | Bắn popup cảnh báo trước hạn lên màn hình sinh viên | Đúng mốc còn 8s, popup đồ họa "SẮP HẾT CA HỌC" xuất hiện sắc nét trên Desktop | ✅ Đạt |
| **6. Tự động Kết thúc** | Đúng mốc hẹn giờ cố định tự động hủy phiên | Đúng mốc `expires_at`, Agent gọi `loginctl kill-session -s SIGKILL` | ✅ Đạt |
| **7. Reset Greeter** | Máy ảo tự động văng về màn hình đăng nhập sạch | Desktop biến mất, màn hình máy ảo quay trở lại Custom Greeter ban đầu | ✅ Đạt |
| **8. Toàn vẹn Nhật ký** | Kiểm tra nhật ký kiểm toán sau khi kết thúc | Bảng `audit_outbox` và `local_session` lưu trữ đầy đủ `entry_id`, timestamp, outcome `granted` | ✅ Đạt |

## Số liệu Nhật ký Thực tế
Dữ liệu truy vấn trực tiếp từ cơ sở dữ liệu kiểm chứng vòng đời đầy đủ `~/spike/data/s6_agent.db`:
```text
# 1. Ca quẹt thẻ chờ quá 12 giây không xác thực (Bị từ chối và ghi nhận discarded)
sqlite3 ~/spike/data/s6_agent.db "SELECT user, status, started_at, expires_at FROM local_session WHERE status = 'discarded' ORDER BY expires_at DESC LIMIT 1;"
binhtong|discarded||1793043344.23294

# 2. Ca đăng nhập bình thường tuân thủ Hạn giờ Cố định (BR-001)
sqlite3 ~/spike/data/s6_agent.db "SELECT user, status, datetime(started_at, 'unixepoch', 'localtime'), datetime(expires_at, 'unixepoch', 'localtime'), round(expires_at - started_at, 2) as actual_used FROM local_session WHERE status = 'forced_logout' ORDER BY started_at DESC LIMIT 1;"
labuser|forced_logout|2026-10-27 03:59:08|2026-10-27 03:59:34|26.74

# 3. Ca thay phiên quẹt đè (BR-008)
sqlite3 ~/spike/data/s6_agent.db "SELECT user, status, datetime(started_at, 'unixepoch', 'localtime'), datetime(expires_at, 'unixepoch', 'localtime') FROM local_session WHERE status = 'superseded' ORDER BY started_at DESC LIMIT 1;"
binhtong|superseded|2026-10-27 03:58:44|2026-10-27 03:59:14
# Ghi chú khớp Domain Model: Trong CSDL thực tế của Agent chuẩn, phiên này lưu status='abandoned' và end_reason='superseded'.

# 4. Ca dữ liệu quá hạn đúng nghĩa (data_stale)
sqlite3 ~/spike/data/s6_agent.db "SELECT outcome, reason, user, uid FROM audit_outbox ORDER BY timestamp DESC LIMIT 1;"
denied|data_stale|unknown|AABBCCDD

# 5. Ca phục hồi sau khi rút điện đột ngột bằng SysRq (interrupted_by_reboot)
sqlite3 ~/spike/data/s6_agent.db "SELECT user, status, datetime(started_at, 'unixepoch', 'localtime') FROM local_session ORDER BY started_at DESC LIMIT 1;"
binhtong|interrupted_by_reboot|2026-10-27 02:51:52
# Ghi chú khớp Domain Model: Trong CSDL thực tế của Agent chuẩn, phiên này lưu status='abandoned' và end_reason='workstation_rebooted'.
```
- **Tính Nhất quán Giao dịch:** Khớp mã `decision_id / entry_id` giữa bảng `audit_outbox` và `local_session` đạt tỷ lệ 1:1 trong toàn bộ các lần thử nghiệm.
- **Trạng thái vòng đời thực nghiệm:**
  - Thẻ lạ: Bị từ chối ngay lập tức (`denied / unknown_card`), không tạo phiên.
  - Quẹt thẻ nhưng bỏ đi / chờ quá hạn: Bị từ chối tại PAM (mã giao thức IPC nội bộ: `pending_timeout`), chuyển trạng thái `discarded`, không bao giờ cấp phiên.
  - Vòng đời đầy đủ (BR-001 Fixed Deadline): `pending` (lúc quẹt thẻ, chốt cứng mốc `expires_at`) -> `active` (khi bắt được GUI session trên `seat0`, ghi nhận `started_at`, thời gian sử dụng thực tế đạt `26.74s` do trừ hao độ trễ nạp môi trường) -> `forced_logout` (khi chạm đúng mốc hẹn giờ).
  - Thay thế phiên (BR-008): Ghi nhận thay thế phiên (`superseded`) khi người dùng mới (`labuser`) quẹt thẻ trong lúc người cũ (`binhtong`) đang chiếm phiên.
  - Tắt Agent giữa chừng: LightDM tự động phục hồi ô nhập mật khẩu cục bộ (BR-004), đăng nhập tài khoản Linux bình thường.
  - Dữ liệu quá hạn (`data_stale`): Phân loại chuẩn xác `denied(data_stale)` khi `trusted_until` rơi về quá khứ.
  - Agent restart giữa phiên: Đối chiếu kernel `boot_id` không đổi, tự động phục hồi theo dõi phiên đồ họa đang chạy mà không làm rớt Desktop của người dùng.
  - Rút điện cưỡng bức (SysRq `b`): Phát hiện `boot_id` mới của kernel, tự động chuyển toàn bộ phiên dở dang thành `abandoned(workstation_rebooted)`.
  - Phiên quá hạn khi Agent tắt (Offline Expiration): Khi Agent tắt trong lúc sinh viên đang ở trong Desktop và ca học trôi qua hết hạn, ngay thời điểm Agent khởi động lại, hệ thống lập tức phát hiện `rem <= 0` (-48.5s), tự động phát lệnh `loginctl kill-session c36 -s SIGKILL` tống xuất người dùng ra màn hình đăng nhập và ghi nhận `forced_logout`.
  - Tài khoản tạo động lần đầu (Phân rã độ trễ First-Run): Tài khoản `student_firstrun` vừa được tạo mới qua `useradd -m`, chưa từng đăng nhập. Độ trễ được phân tách thành 3 giai đoạn độc lập:
    - `t_1` (Quẹt thẻ -> PAM tiêu thụ token): `< 0.1s` (được bảo vệ bởi `PENDING_TIMEOUT = 12.0s`, đem lại biên an toàn lớn hơn 100 lần trước nguy cơ quẹt thẻ rồi bỏ đi).
    - `t_2` (PAM cấp phép -> `systemd-logind` đăng ký phiên `c38` trên `seat0`): `0.68s` (`started_at: 1793048995.91`).
    - `t_3` (Session `active` -> GNOME Shell nạp xong Desktop & D-Bus sẵn sàng): `~8.0s - 9.5s`.
    - *Lưu ý kiến trúc:* Thời gian nạp giao diện đồ họa (`t_3`) làm co lại thời lượng sử dụng thực tế của sinh viên trong ca học theo nguyên tắc hạn giờ cố định (BR-001), hoàn toàn không liên quan đến `PENDING_TIMEOUT` (vốn chỉ bảo vệ chặng `t_1`). Độ trễ nạp môi trường mới này là một trong những cơ sở thực tiễn củng cố quyết định chuyển sang **Mô hình tài khoản OS dùng chung (Shared Workstation Profile)** theo D-006 / D-009 (môi trường đã được khởi tạo sẵn, không phải nạp lại lần đầu).

## Phát hiện Kỹ thuật Then chốt 1: Hiện tượng Bấm Login 2 Lần & Luận cứ cho Custom Greeter

### Hiện tượng thực tế quan sát được:
Khi thẻ đã được quẹt thành công (`GRANTED: binhtong`), trên màn hình máy ảo người dùng phải bấm nút Login **2 lần** mới vào được Desktop:
- **Lần bấm 1:** Xuất hiện thông báo lỗi `password incorrect`, sau đó ô nhập mật khẩu biến mất và giao diện reset lại.
- **Lần bấm 2:** Mới chính thức kích hoạt chuỗi PAM thành công và chuyển vào Desktop.

### Phân tích Nguyên nhân Gốc rễ (Root Cause Analysis):
1. **Lệch pha thời gian (Timing Mismatch):** Ngay khi màn hình LightDM khởi động, nó tự động kích hoạt tiến trình kiểm tra trước ngầm (`pre-authentication`). Tại thời điểm này, sinh viên **chưa quẹt thẻ**, do đó Agent trả về `denied`. LightDM ghi nhận lỗi này và lưu giữ phiên lỗi trong bộ nhớ đệm.
2. **Hạn chế của `lightdm-gtk-greeter` mặc định:** Đây là giao diện tĩnh, được thiết kế cho người dùng bàn phím/chuột. Khi sinh viên quẹt thẻ ở bên ngoài, giao diện Greeter **hoàn toàn không nhận được tín hiệu đẩy (push event)** nên không tự động biết rằng đã có thẻ hợp lệ vừa xuất hiện.
3. Lần bấm Login thứ nhất thực chất là thao tác cưỡng bức LightDM hủy bỏ phiên lỗi ngầm cũ. Lần bấm Login thứ hai mới kích hoạt chuỗi PAM mới để nhận `granted` từ Agent.

### Đóng góp Kiến trúc cho Đồ án (ADR Greeter):
Hiện tượng này là **bằng chứng thực nghiệm đắt giá nhất** để bảo vệ quyết định thiết kế:
- **Không thể sử dụng nguyên bản `lightdm-gtk-greeter` mặc định của Linux cho phòng lab tự động.**
- **Bắt buộc triển khai Custom Greeter (hoặc Web Greeter):** Màn hình chào phải có kênh lắng nghe sự kiện IPC/D-Bus từ Agent. Khi sinh viên chạm thẻ vào đầu đọc, Agent bắn tín hiệu đẩy → Greeter lập tức tự động gọi `lightdm_greeter_authenticate()` và vào thẳng Desktop mà sinh viên **không cần chạm vào chuột hay bấm nút Login bất kỳ lần nào** (đáp ứng trọn vẹn yêu cầu không bàn phím của **FR-010**).

## Phát hiện Kỹ thuật Then chốt 2: Hiện tượng Race Condition khi Thay thế Phiên (BR-008) & Giải pháp Đồng bộ Teardown

### Hiện tượng thực tế ban đầu:
Khi `labuser` quẹt thẻ lúc `binhtong` đang chiếm Desktop:
1. Agent lập tức đánh dấu phiên `binhtong` là `superseded` và phát tín hiệu hủy phiên `c24` (`loginctl kill-session c24 -s SIGKILL`).
2. Giao diện Desktop bị dập tắt, nhưng LightDM mất khoảng 1.0s - 1.5s để dọn dẹp X11 display server, giải phóng Virtual Terminal (VT 7), và dập tắt toàn bộ tiến trình D-Bus con của người dùng cũ.
3. Nếu Greeter mới xuất hiện và kích hoạt `authenticate("labuser")` quá nhanh (dưới 500ms), tiến trình khởi tạo GNOME Session của người mới sẽ đụng độ với tài nguyên đang dọn dẹp dở dang của người cũ, dẫn đến lỗi:
   ```text
   dbus-update-activation-environment: error: unable to connect to D-Bus: /usr/bin/dbus-launch terminated abnormally without any error message
   ```
   Hậu quả là màn hình bị treo đen trong ~110 giây trước khi GNOME Session bỏ cuộc (`return value 1`) và văng ngược lại màn hình đăng nhập.

### Cơ chế Giải pháp Kiến trúc Hoàn chỉnh:
Để giải quyết triệt để sự tranh chấp tài nguyên này, hệ thống áp dụng cơ chế phối hợp hai đầu (**Two-Phase Teardown Synchronization & Startup Handshake**):
1. **Tại Agent Daemon:**
   - Khi phát hiện quẹt đè, Agent phát lệnh `loginctl kill-session <old_id> -s SIGKILL`.
   - Agent **chủ động đợi (polling loop)** trên `loginctl list-sessions` cho đến khi ID phiên cũ biến mất hoàn toàn khỏi cgroup nhân Linux, cộng thêm 0.5s đệm an toàn để Display Server ổn định.
2. **Tại Lab Custom Greeter:**
   - Khi tiến trình Greeter mới được LightDM hồi sinh, Greeter dành **1.2 giây đệm** để hoàn tất việc vẽ khung giao diện và đồng bộ với Xorg.
   - Greeter chủ động gửi thông điệp `{"action": "greeter_ready"}` sang Agent qua Unix Control Socket `/run/nfc-control.sock`.
   - Agent kiểm tra nếu có lượt quẹt đè đang chờ (`staged_auth`) thì bàn giao quyền xác thực cho Greeter.
   - Greeter hiển thị dòng trạng thái: *"🔄 Đang chuyển đổi phiên cho: labuser..."* và chuyển thẳng vào Desktop 0-chạm.

### Bằng chứng Thực nghiệm Đo đạc (Chạy Thực tế Thành công 100%):
```text
==================================================
🚀 S6 AGENT ĐỒNG BỘ TEARDOWN & HANDSHAKE ĐANG CHẠY...
==================================================

[Quẹt Thẻ] Nhận thẻ UID: AABBCCDD
[Quẹt Thẻ] ✅ HỢP LỆ: binhtong | Tạo session: 708a8d36-127a-47b7-9d44-287bbfff344b
[PAM Socket] ✅ Trả 'granted' cho user: binhtong

[Timer] Chờ phát hiện GUI session cho user 'binhtong'...
[Timer] ✅ Bắt được GUI session c32! Cập nhật: status='active'
[Timer] ⏱️ started_at: 1793048324.61 | expires_at CỐ ĐỊNH: 1793048354.03 (Còn lại: 29.4s)

[Quẹt Thẻ] Nhận thẻ UID: 11223344
[BR-008] ⚡ PHÁT HIỆN QUẸT ĐÈ! Hủy phiên của 'binhtong' (superseded)...
[Quẹt Thẻ] ✅ HỢP LỆ: labuser | Tạo session: 0fe27818-d3bc-443f-abda-9ab4b0e12d71
[Handshake BR-008] 🤝 Greeter đã hồi sinh! Bàn giao lượt quẹt đang chờ của 'labuser'...
[PAM Socket] ✅ Trả 'granted' cho user: labuser

[Timer] Chờ phát hiện GUI session cho user 'labuser'...
[Timer] ✅ Bắt được GUI session c34! Cập nhật: status='active'
[Timer] ⏱️ started_at: 1793048348.02 | expires_at CỐ ĐỊNH: 1793048374.76 (Còn lại: 26.7s)
[Timer] ⚠️ BẮN CẢNH BÁO D-BUS CHO 'labuser'...
[Timer] 🛑 ĐÚNG GIỜ HẾT CA HỌC! Cưỡng chế kết thúc (c34): status='forced_logout'...
[Timer] Đã dọn sạch phiên.
```
- **Hành vi trên màn hình máy ảo:** Desktop của `binhtong` biến mất ngay lập tức; màn hình chào xuất hiện hiển thị *"🔄 Đang chuyển đổi phiên cho: labuser..."*, sau đó chuyển thành chữ xanh *"✅ Thẻ hợp lệ: labuser! Đang tự động vào Desktop..."* và mở thẳng vào Desktop của `labuser` hoàn toàn tự động (0-chạm).
- **Tuân thủ tuyệt đối BR-001 (Fixed Deadline):** `expires_at` của `labuser` được chốt cố định lúc quẹt thẻ (`1793048374.76`). Do thời gian dọn dẹp phiên cũ và nạp Desktop mất 3.26 giây, thời gian sử dụng thực tế của `labuser` tự động co lại còn đúng `26.7s` (thay vì cấp mới 30 giây gian lận).
- **Dọn dẹp phiên cũ (`superseded`):** Phiên `c32` của `binhtong` được lưu vết `superseded`, phiên `c34` của `labuser` kết thúc đúng hẹn với `forced_logout`.

### Kiểm thử Độ bền Vòng lặp Quẹt đè (BR-008 Stress Testing) Dưới Tải CPU 100%:
Để kiểm chứng giải pháp đồng bộ theo điều kiện (Condition-based Teardown) trong điều kiện vận hành khắc nghiệt nhất, kịch bản kiểm thử tự động `stress_test.py` đã thực hiện 10 lần quẹt đè liên tiếp giữa `binhtong` và `labuser` trong khi máy trạm bị **ép tải CPU 100%** (chạy nền 2 worker process vắt kiệt tài nguyên xử lý của 2 lõi CPU):
```text
=== BẮT ĐẦU STRESS TEST 10 LẦN QUẸT ĐÈ (CPU LOAD 100%) ===
Lần 01: Quẹt labuser  -> Kết quả: GRANTED: labuser  (session c51)
Lần 02: Quẹt binhtong -> Kết quả: GRANTED: binhtong (session c53)
Lần 03: Quẹt labuser  -> Kết quả: GRANTED: labuser  (session c55)
Lần 04: Quẹt binhtong -> Kết quả: GRANTED: binhtong (session c57)
Lần 05: Quẹt labuser  -> Kết quả: GRANTED: labuser  (session c59)
Lần 06: Quẹt binhtong -> Kết quả: GRANTED: binhtong (session c61)
Lần 07: Quẹt labuser  -> Kết quả: GRANTED: labuser  (session c63)
Lần 08: Quẹt binhtong -> Kết quả: GRANTED: binhtong (session c65)
Lần 09: Quẹt labuser  -> Kết quả: GRANTED: labuser  (session c67)
Lần 10: Quẹt binhtong -> Kết quả: GRANTED: binhtong (session c69)

===> KẾT QUẢ STRESS TEST: 10/10 THÀNH CÔNG (100.0%) <===
```
- **Tỷ lệ thành công:** `10/10` (100.0%). Ngay cả khi CPU bị chiếm dụng 100%, cơ chế kiểm tra điều kiện (chờ phiên cũ biến mất khỏi `loginctl` và nhận handshake từ Greeter mới) hoạt động hoàn hảo, không xảy ra bất kỳ lỗi treo màn hình đen hay đụng độ D-Bus nào.
- **Thời lượng phiên còn lại ổn định:** Dao động từ `27.0s` đến `27.6s` trên toàn bộ 10 chu kỳ, chứng minh biên an toàn kiến trúc rất cao và sự bền vững của bộ điều phối vòng đời phiên.

### Kiểm thử Trường hợp Biên: Hạn phiên hết trước khi kịp mở Desktop (Mục 5 - `discarded`):
Khi thẻ được quẹt với thời lượng ca học cực ngắn (ví dụ chỉ còn 0.05 giây trước mốc kết thúc ca):
```text
[PAM Socket] ✅ Trả 'granted' cho user: binhtong (khớp chủ thẻ)
[Timer] 🛑 PHIÊN VỪA MỞ RA ĐÃ QUÁ HẠN CA HỌC (0.09s trễ)!
[Timer] ⚡ Cưỡng chế hủy ngay (c48) và chuyển status='discarded'...
[Timer] ✅ Đã lưu vết: status='discarded' (không cấp phiên)
```
- Truy vấn SQLite WAL xác nhận:
  ```text
  binhtong|discarded||1793078073.30116
  ```
  Trường `started_at` để trống, phiên bị tiêu diệt ngay tại vạch xuất phát (`c48`), đáp ứng chính xác đặc tả trạng thái `discarded` của `swipe-login.md`.

## Giới hạn của Bằng chứng (Limitations of Evidence)
1. **Mô phỏng sự kiện quẹt thẻ:** S6 sử dụng CLI giả lập (`s6_swipe.py`) gửi thông điệp quẹt thẻ qua Unix domain control socket (`/run/nfc-control.sock`). Sự kiện thẻ thực tế qua PC/SC từ phần cứng đầu đọc chưa được tích hợp trực tiếp vào daemon S6. Control socket này phải được loại bỏ hoặc vô hiệu hóa trong môi trường vận hành thực tế.
2. **Kịch bản Quẹt đè (BR-008):** Trong thử nghiệm S6, quẹt đè được kích hoạt ngay khi máy đang mở Desktop. Theo chính sách nghiệp vụ thực tế đã chuẩn hóa, quẹt thẻ của người khác khi Desktop đang active sẽ bị từ chối `workstation_busy` để tránh phá hoại phiên làm việc; cơ chế Teardown Sync & Handshake đã kiểm chứng trong S6 chỉ được áp dụng khi người dùng đã chuyển về Greeter hoặc phiên cũ đã hết hạn ca học.
3. **Môi trường & Quy mô thử nghiệm:** Thử nghiệm tích hợp chạy trên máy ảo Ubuntu 22.04 LTS (KVM/QEMU); kịch bản quẹt đè tải CPU 100% được chạy N = 10 vòng lặp. Cần kiểm chứng bổ sung với phần cứng máy trạm vật lý và đầu đọc NFC thật.

## Kết luận
**ĐẠT YÊU CẦU TRONG PHẠM VI THỰC NGHIỆM WALKING SKELETON TÍCH HỢP ĐẦU-CUỐI.**
Toàn bộ kiến trúc phần mềm lõi của hệ thống xác thực phòng lab (từ quẹt thẻ, đánh giá CR-001, ghi nhận SQLite WAL, PAM C, Custom Greeter GTK3 0-chạm, xử lý thay thế phiên BR-008 qua cơ chế Teardown Sync & Handshake, bảo đảm hạn giờ cố định BR-001, cảnh báo D-Bus, đến tự động dọn sạch phiên) đã được tích hợp hoàn chỉnh và kiểm chứng thành công trong phạm vi môi trường thử nghiệm Ubuntu 22.04 LTS.

