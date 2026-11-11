# Báo Cáo Kết Quả Spike S7b: Teardown Phiên GNOME Thật Qua LightDM/PAM & Tiến Trình Bẫy SIGTERM

- **Mã Spike:** S7b (Bổ sung bắt buộc cho S7 theo yêu cầu review độc lập)
- **Ngày thực hiện:** 2026-11-11
- **Môi trường:** Máy ảo Ubuntu 22.04 LTS (`binhtong@pam`, 2 vCPU, VirtualBox guest), cài mới stack LightDM + Xorg + GNOME Desktop + `pam_nfc.so` + `lab_greeter.py`
- **Trạng thái:** ✅ **Đạt hoàn toàn (20/20 chu kỳ E2E)**
- **Ảnh hưởng ADR:** Xác nhận chính thức **[ADR-004](../design/docs/06-architecture/decisions/ADR-004-mo-hinh-profile-os-dung-chung.md)** và **[ADR-008](../design/docs/06-architecture/decisions/ADR-008-vong-doi-phien-va-teardown-da-pha.md)** từ `Proposed` lên `Accepted`; phát hiện và sửa lỗi logic đếm crash trong wrapper của **[ADR-005](../design/docs/06-architecture/decisions/ADR-005-pam-greeter-va-display-manager.md)**.

---

## 1. Câu Hỏi Cần Chứng Minh (Khác Biệt So Với S7)

Spike S7 trước đó chỉ đo dọn dẹp scope nhân Linux qua `systemd-run --scope` (`165.0 ms` max) với **0/20** lần kích hoạt nhánh `SIGKILL`, chưa chạy đăng nhập thật qua **LightDM + PAM + Custom Greeter + GNOME Desktop (Xorg/D-Bus)** và chưa đo thời gian từ lúc quẹt thẻ tới khi Desktop sẵn sàng.

**Câu hỏi của S7b:**
> Khi thực hiện chu trình End-to-End thật: **quẹt thẻ (socket trigger) -> LightDM/PAM -> GNOME Desktop trên cùng UID dùng chung `student` (1001)**, có sẵn tiến trình autostart bẫy `SIGTERM` (`trap '' SIGTERM`) để ép hệ thống phải đi vào **Pha 2 (`loginctl kill-user -s SIGKILL`)**, và chèn `Linger N=5` cùng rogue unit dưới **tải CPU 100%**, liệu Two-Phase Teardown có hoàn tất trong `TOTAL_TEARDOWN_TIMEOUT = 3.0s`, triệt tiêu 100% lỗi treo D-Bus ~110s, và mở lại Desktop GNOME mới ổn định qua **20 chu kỳ liên tiếp** hay không?

---

## 2. Thiết Lập Thực Nghiệm Thực Tế

1. **Tài khoản & Khóa bề mặt GNOME (ADR-004):**
   - Tạo user `student` (`UID 1001`, group `labstudent`), khóa mật khẩu (`passwd -l student`).
   - Áp dụng `dconf update` với khóa bắt buộc (`/etc/dconf/db/local.d/00-lockscreen` & `locks/00-lockscreen`): vô hiệu hóa `lock-enabled=false`, `disable-lock-screen=true`, `disable-user-switching=true`.
   - Bỏ qua màn hình Welcome wizard (`gnome-initial-setup-done`).
2. **PAM & Custom Greeter (ADR-005):**
   - Biên dịch `/lib/security/pam_nfc.so` và chèn `auth sufficient /lib/security/pam_nfc.so` trước `@include common-auth` trong `/etc/pam.d/lightdm`.
   - Triển khai `/usr/local/bin/lab_greeter.py` (`gir1.2-lightdm-1`, `python3-gi`) có bộ đệm **1.2s Startup Handshake** trước khi giao tiếp authenticate với LightDM daemon và xử lý `signal.SIGTERM` thoát sạch (`exit 0`).
3. **Tiến trình ngoan cố bẫy `SIGTERM`:**
   - Cài đặt `/home/student/.config/autostart/stubborn-test.desktop` tự động chạy `/usr/local/bin/stubborn_worker.sh` (`trap '' SIGTERM`) mỗi khi Desktop GNOME của `student` mở lên. Mọi chu kỳ đều buộc Pha 1 (`loginctl terminate-user student`) bị bỏ qua sau `GRACE_TIMEOUT = 2.0s` và phải leo thang sang Pha 2 (`loginctl kill-user student -s SIGKILL`).
4. **Kịch bản đo `s7b_e2e_harness.py` (20 chu kỳ):**
   - Trong mỗi chu kỳ: ghi nhận `decided_at` -> kích hoạt Greeter đăng nhập `student` -> đợi phiên `student` `Active=yes` và có tiến trình `gnome-shell` sống -> kiểm tra dấu thời gian `started > decided_at` -> kiểm tra Linger `enable-linger` + `systemd-run` ở các chu kỳ `[1, 5, 10, 15, 20]` (`N=5`) -> chạy Two-Phase Teardown (`disable-linger` -> `terminate-user` đợi 2.0s -> `kill-user -s SIGKILL`) -> xác minh 0 tiến trình và `user@1001.service` sạch hoàn toàn trước chu kỳ kế tiếp.

---

## 3. Quá Trình Chạy & Sự Cố Lần 1 (RCA)

### Lần chạy 1 (`stress-ng --cpu 2 --quiet` ở `nice 0`): Đạt 8/20, treo ở chu kỳ 09 (`c24`)
- Các chu kỳ 1–8 (`c8, c10, c12, c14, c16, c18, c20, c22`) đều đạt (`Login->GNOME`: `5834`–`8933 ms`, trung bình `7133 ms`; `SIGKILL`: `8/8`, độ trễ `+132.2` đến `+349.1 ms`, trung bình `237.0 ms`; `Tổng TD`: `2200.4`–`2429.2 ms`, trung bình `2300.5 ms`; `Linger`: `2/2`).
- Tại chu kỳ 09/20 (`c24`), harness báo `❌ LỖI: Desktop GNOME không lên sau 45.0s!`.
- **Phân tích nguyên nhân gốc (Root Cause Analysis từ `journalctl` & `.xsession-errors`):**
  - PAM, Greeter, LightDM và `user@1001.service` khởi động bình thường lúc `08:32:33.344`; file `/home/student/.xsession-errors` ghi nhận **0 lỗi D-Bus** (`DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/1001/bus`).
  - Từ `08:32:33.449` đến `08:36:06.065` (~212 giây), kernel ghi nhận:
    - `watchdog: BUG: soft lockup - CPU#1 stuck for 198s! [snap:17323]`
    - `rcu: INFO: rcu_preempt self-detected stall on CPU (t=212592 jiffies ... ncpus=2)` trong `__pv_queued_spin_lock_slowpath`.
    - `snapd-desktop-integration.service` (tự chạy khi GNOME đăng nhập trên Ubuntu 22.04 mặc định) bị `stress-ng` mức ưu tiên `nice 0` chiếm hết 2 vCPU ảo VirtualBox, gây nghẽn spinlock paravirtual giữa nhân và Snap (`Consumed 3min 32.815s CPU time`, kích hoạt hàng loạt `SECCOMP` audit).
- **Khắc phục bài đo:** Để giữ nguyên GNOME + Snap mặc định của Ubuntu 22.04 mà không bóp nghẹt `rcu_preempt` trên 2 vCPU ảo, chuyển workload nhiễu sang `nice -n 10 stress-ng --cpu 2 --quiet` (vẫn bão hòa 100% CPU, đẩy `Load1m` từ `2.30` lên `8.58`).

---

## 4. Kết Quả Lần Chạy 2 (20/20 Chu Kỳ Thành Công)

| Chu kỳ | Phiên OS | Login -> GNOME (ms) | `started > decided_at` | Ép Pha 2 `SIGKILL` | Tổng TD (ms) | Sạch hoàn toàn | `Load1m` | Ghi chú |
| :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :--- |
| **01** | `c26` | 5887 | `True` | `True` (+152.9 ms) | 2155.1 | `True` | 2.30 | Linger N=5 OK |
| **02** | `c28` | 5298 | `True` | `True` (+186.7 ms) | 2226.8 | `True` | 2.66 | |
| **03** | `c30` | 4999 | `True` | `True` (+163.1 ms) | 2220.5 | `True` | 4.31 | |
| **04** | `c32` | 6121 | `True` | `True` (+262.2 ms) | 2314.8 | `True` | 6.25 | |
| **05** | `c34` | 6096 | `True` | `True` (+181.4 ms) | 2216.5 | `True` | 7.79 | Linger N=5 OK |
| **06** | `c36` | 6078 | `True` | `True` (+172.5 ms) | 2187.6 | `True` | 7.13 | |
| **07** | `c38` | 5815 | `True` | `True` (+133.4 ms) | 2150.0 | `True` | 6.49 | |
| **08** | `c40` | 7133 | `True` | `True` (+145.6 ms) | 2271.7 | `True` | 6.03 | |
| **09** | `c42` | 5584 | `True` | `True` (+142.7 ms) | 2181.7 | `True` | 6.44 | |
| **10** | `c44` | 6246 | `True` | `True` (+134.0 ms) | 2259.0 | `True` | 6.68 | Linger N=5 OK |
| **11** | `c46` | 5442 | `True` | `True` (+120.4 ms) | 2142.4 | `True` | 8.27 | |
| **12** | `c48` | 7031 | `True` | `True` (+132.1 ms) | 2156.7 | `True` | 8.58 | |
| **13** | `c50` | 5341 | `True` | `True` (+166.5 ms) | 2183.4 | `True` | 7.97 | |
| **14** | `c52` | 5727 | `True` | `True` (+123.9 ms) | 2151.2 | `True` | 7.21 | |
| **15** | `c54` | 5983 | `True` | `True` (+203.3 ms) | 2281.6 | `True` | 6.67 | Linger N=5 OK |
| **16** | `c56` | 5777 | `True` | `True` (+113.2 ms) | 2180.9 | `True` | 6.17 | |
| **17** | `c58` | 5341 | `True` | `True` (+174.7 ms) | 2175.2 | `True` | 6.48 | |
| **18** | `c60` | 6273 | `True` | `True` (+199.6 ms) | 2245.6 | `True` | 6.61 | |
| **19** | `c62` | 4825 | `True` | `True` (+177.7 ms) | 2289.2 | `True` | 6.48 | |
| **20** | `c64` | 4872 | `True` | `True` (+189.7 ms) | 2227.1 | `True` | 8.12 | Linger N=5 OK |

### Tổng Hợp Chỉ Số Thống Kê
- **Tổng chu kỳ hoàn thành:** **20 / 20** (0 lỗi treo D-Bus ~110s, 0 cảnh báo `user@1001.service` kẹt).
- **Tỷ lệ ép chạy Pha 2 (`kill-user -s SIGKILL`):** **20 / 20** (`100%` bắt buộc cưỡng chế do `stubborn_worker.sh` bẫy `SIGTERM`).
- **Độ trễ tiêu diệt Pha 2 (`SIGKILL`):** Min `113.2 ms` | Mean `163.8 ms` | Max `262.2 ms`.
- **Tổng thời gian Two-Phase Teardown (`GRACE_TIMEOUT 2.0s + SIGKILL`):** Min `2142.4 ms` | Mean `2210.8 ms` | **P95 `2314.8 ms`** | Max `2314.8 ms`.
- **Số lần vượt ngưỡng trần `TOTAL_TEARDOWN_TIMEOUT = 3.0s`:** **0 / 20** (còn dư biên ~685 ms ngay cả ở phân vị cao nhất và `Load1m = 8.58`).
- **Khớp chuẩn thời gian phiên OS mới (`started > decided_at`):** **20 / 20**.
- **Thử nghiệm diệt `Linger` + `Rogue Unit`:** **5 / 5 (`N=5`)**.
- **Tổng thời gian Login -> GNOME Desktop lên (`gnome-shell` + phiên active):** Min `4825 ms` | Mean `5793 ms` | **P95 `7133 ms`** | Max `7133 ms`.

---

## 5. Phát Hiện Kỹ Thuật Bổ Sung Cho Master Image & ADR-005

1. **Loại bỏ `snapd-desktop-integration` khỏi Master Image phòng lab (bổ sung vào ADR-004):**
   - Thực nghiệm Lần 1 chứng minh `snapd-desktop-integration` tự khởi chạy mỗi lần `student` login trên Ubuntu 22.04 gây tranh chấp CPU + sinh `SECCOMP` audit rất nặng (`3m32s` CPU dưới nghẽn 2 vCPU). Máy trạm lab đóng băng profile dùng chung không cần cửa hàng Snap desktop cho sinh viên -> khuyến nghị gỡ hoặc disable service này trong quy trình dựng Master Image.
2. **Phát hiện lỗi logic trong `lab-greeter-wrapper.sh` (đã sửa trong ADR-005):**
   - Trong bản nháp ADR-005 trước đó, wrapper ghi timestamp vào `/run/lab-greeter-crashes` *mỗi lần mở Greeter* trước khi `exec`, bất kể lần chạy trước thoát do lỗi hay thoát bình thường (sau khi sinh viên đăng nhập thành công). Nếu có **3 lần đăng nhập bình thường trong vòng 60 giây** (như bài test E2E hoặc giờ cao điểm đổi ca), wrapper sẽ đếm nhầm thành crash và kích hoạt fallback sang `lightdm-gtk-greeter`.
   - **Khắc phục:** Wrapper phải đợi tiến trình `lab_greeter.py` kết thúc (không dùng `exec` trực tiếp trước khi kiểm tra exit code), chỉ ghi crash log khi mã thoát khác `0`, và xóa crash log khi thoát sạch (`EXIT_CODE == 0`). Song song đó, `lab_greeter.py` đã cài đặt handler `signal.SIGTERM -> exit 0` khi LightDM kết thúc greeter để bàn giao VT cho GNOME.

---

## 6. Giới Hạn Của Bằng Chứng (Evidence Limitations)

1. **Kích hoạt đầu vào qua Socket cục bộ thay vì phần cứng ACR122U thật 20 lần:** Toàn bộ 20 chu kỳ gọi qua socket/PAM local để tự động hóa vòng lặp trên VM, không quẹt thẻ vật lý 20 lần (tầng phần cứng đầu đọc đã kiểm chứng riêng ở Spike S2).
2. **Độ ưu tiên tải nền `nice -n 10`:** Trên máy ảo VirtualBox 2 vCPU, tải nền dùng `nice -n 10` để tránh làm nghẽn `rcu_preempt` + Snap lockup như Lần 1; tải hệ thống vẫn duy trì `Load1m` `2.30`–`8.58` (vượt xa tải sử dụng thực tế của sinh viên trên máy vật lý).
3. **`lab-greeter-wrapper.sh` chưa bọc trong vòng boot LightDM của S7b:** S7b chạy trực tiếp `/usr/local/bin/lab_greeter.py` qua `lab-greeter.desktop`; logic wrapper đã sửa trong ADR-005 cần được smoke-test lại ở giai đoạn đóng gói Master Image / Walking Skeleton triển khai thật.
