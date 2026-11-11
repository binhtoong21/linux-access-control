# Báo Cáo Kết Quả Spike S10: Smoke-Test `lab-greeter-wrapper.sh` Trong Vòng Boot LightDM Thật

- **Mã Spike:** S10 (Greeter Wrapper Smoke-Test — Timebox 1 giờ)
- **Ngày thực hiện:** 2026-11-11
- **Môi trường:** Ubuntu 22.04.5 LTS (`binhtong@pam`, VM cũng là môi trường S7b), LightDM + `lab_greeter.py` (GTK3) của S7b, `lightdm-gtk-greeter`, systemd `lightdm.service` (`Restart=always`). Script: `~/spike/s10/s10_wrapper.sh`; harness đăng nhập GNOME thật: `~/spike/s7b/s7b_e2e_harness.py` rút còn 3 chu kỳ.
- **Trạng thái:** ✅ **Đạt sau khi sửa 1 lỗi tự khóa trong wrapper**
- **Ảnh hưởng ADR:** Sửa đường dẫn tệp đếm crash và mô tả cấu hình greeter trong **[ADR-005](../design/docs/06-architecture/decisions/ADR-005-pam-greeter-va-display-manager.md)**; nâng ADR-005 lên `Accepted`.

---

## 1. Câu Hỏi Cần Chứng Minh

S7b chạy `lab_greeter.py` trực tiếp, chưa qua wrapper. Cần trả lời trong vòng boot LightDM thật:
1. 3 crash liên tiếp trong 60s có rơi về `lightdm-gtk-greeter` (BR-004: đường dự phòng trên màn hình vật lý luôn khả dụng) không?
2. 3 lần đăng nhập bình thường liên tiếp có bị đếm nhầm thành crash không?
3. Wrapper có chuyển tiếp `SIGTERM` của LightDM cho greeter, không để lại tiến trình mồ côi không?

## 2. Thiết Lập

- `/usr/share/xgreeters/lab-greeter.desktop`: `Exec=/usr/local/bin/lab-greeter-wrapper.sh` (`99-lab-greeter.conf` giữ `greeter-session=lab-greeter`).
- Kịch bản crash: thay tạm `lab_greeter.py` bằng script `sys.exit(1)`, khởi động lại LightDM, quan sát 60s.
- Kịch bản đăng nhập: khôi phục `lab_greeter.py` thật, chạy harness S7b 3 chu kỳ (quẹt thẻ giả lập → GNOME `student` → teardown hai pha), tải `stress-ng --cpu 2` nice 10.

## 3. Kết Quả

| Phần | Kịch bản | Kết quả | Đánh giá |
|---|---|---|---|
| A | Wrapper đúng như ADR-005 (`CRASH_LOG=/run/lab-greeter-crashes`), greeter crash lặp | Log greeter: `/run/lab-greeter-crashes: Permission denied` (greeter chạy dưới user `lightdm`, `/run` là `root 0755`). Không mốc crash nào được ghi → không bao giờ fallback. LightDM thoát `status=1` lặp lại, systemd: `Start request repeated too quickly`, `lightdm=failed` suốt 60s, `gtk_greeter=0` | ❌ **Tự khóa: màn hình đen, không có đường dự phòng đồ họa** |
| B | `CRASH_LOG=/var/lib/lightdm/lab-greeter-crashes` (thư mục nhà của `lightdm`), greeter crash lặp | Sau 3 crash: `lightdm-gtk-greeter` chạy, `lightdm=active` ổn định suốt 60s; systemd dừng ở `restart counter is at 3` (dưới giới hạn 5) | ✅ |
| C | Bản B + greeter thật, 3 lần đăng nhập GNOME liên tiếp | Harness 3/3 chu kỳ (`decided_ok=True`, `Sạch=True`, teardown 2087–2246 ms, Login→GNOME 5498–10137 ms); sau đó `crash_log=none`, `gtk_greeter=0`, đúng **1** tiến trình `lab_greeter.py` (con của wrapper mới) | ✅ Không đếm nhầm, không mồ côi |

## 4. Phát Hiện & Hiệu Chỉnh

1. **Tệp đếm crash phải nằm ở nơi user `lightdm` ghi được.** Đổi `/run/lab-greeter-crashes` → `/var/lib/lightdm/lab-greeter-crashes`. Đây là lỗi tự khóa: đúng lúc cần fallback nhất (greeter hỏng) thì không có fallback.
2. **Ngưỡng fallback phụ thuộc giới hạn khởi động lại của systemd.** `lightdm.service` mặc định cho phép 5 lần khởi động trong 10s; ngưỡng 3 crash đang nằm dưới giới hạn này. Không được nâng ngưỡng lên ≥ 5 (hoặc phải nới `StartLimitBurst` tương ứng).
3. **Cấu hình greeter:** LightDM chọn greeter theo tên tệp `.desktop` trong `/usr/share/xgreeters/`; wrapper được gắn qua dòng `Exec=` của tệp đó, không phải qua `greeter-session = lab-greeter-wrapper` như bản ADR cũ ghi.
4. Thông báo `Excess arguments.` xuất hiện trong log greeter khi `lightdm-gtk-greeter` được `exec` từ wrapper; không ảnh hưởng hoạt động.

## 5. Giới Hạn Bằng Chứng

- Mỗi kịch bản chạy N = 1 trên một VM; kịch bản crash dùng greeter thoát ngay (`sys.exit(1)`), chưa thử greeter treo (không thoát) — trường hợp treo không được wrapper xử lý, vẫn cần kênh TTY/SSH (BR-004).
- Trạng thái VM sau spike: greeter chạy qua wrapper bản đã sửa; bản gốc lưu ở `/usr/local/bin/lab_greeter.py.orig` và `/usr/share/xgreeters/lab-greeter.desktop.orig`.
