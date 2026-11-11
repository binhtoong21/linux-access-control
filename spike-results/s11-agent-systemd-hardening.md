# Báo Cáo Kết Quả Spike S11: Agent Chạy Dưới Systemd Hardening Của ADR-006

- **Mã Spike:** S11 (Systemd Hardening Re-run — Timebox 0.5 giờ)
- **Ngày thực hiện:** 2026-11-11
- **Môi trường:** Ubuntu 22.04.5 LTS (`binhtong@pam`, VM của S7b/S10), systemd `249.11`, LightDM + `lab_greeter.py` qua wrapper bản S10. Agent được mô phỏng bằng harness S7b (`h3.py`, 3 chu kỳ GNOME thật) chạy trong unit tạm `systemd-run` mang đúng thuộc tính hardening của ADR-006. Probe từng thao tác: `~/spike/s10/s11_probe.py`.
- **Trạng thái:** ✅ **Đạt sau khi bổ sung `CAP_CHOWN`**
- **Ảnh hưởng ADR:** Sửa danh sách `CapabilityBoundingSet` trong **[ADR-006](../design/docs/06-architecture/decisions/ADR-006-ngon-ngu-va-techstack.md)**.

---

## 1. Vì Sao Phải Chạy Lại

ADR-006 giảm thiểu rủi ro "Python chạy root" bằng hardening systemd (`ProtectSystem=strict`, `ProtectHome=read-only`, `PrivateTmp=true`, `ReadWritePaths=/var/lib/nfc-agent /run`, `CapabilityBoundingSet=CAP_KILL CAP_DAC_OVERRIDE CAP_SETUID CAP_SETGID`). S6 và S7b đều chạy Agent **không có** các thuộc tính này, nên chưa có bằng chứng Agent còn làm được việc của nó khi bị giới hạn. Hardening sai thì Agent vẫn chạy nhưng không ai đăng nhập được bằng thẻ.

## 2. Kết Quả

### Lần 1: Đúng như ADR-006
Harness: `[01/3] ❌ LỖI: Quá thời gian chờ greeter_ready!`. Greeter không kết nối được Agent.

Probe từng thao tác trong cùng cấu hình:

| Thao tác của Agent | ADR-006 | + `CAP_CHOWN` |
|---|---|---|
| Tạo socket đẩy sự kiện và `chown` nhóm `lightdm` (`/run/nfc/greeter-push.sock`) | ❌ `PermissionError: [Errno 1] Operation not permitted` | ✅ |
| Tạo socket PAM `0660` | ✅ | ✅ |
| Ghi SQLite WAL trong `/var/lib/nfc-agent` | ✅ | ✅ |
| Ghi thư mục định danh trong `/var/lib/nfc-agent` | ✅ | ✅ |
| Đọc `/etc` | ✅ | ✅ |
| `loginctl list-sessions`, `kill-user` (D-Bus tới logind), `disable-linger` | ✅ | ✅ |
| Đổi UID sang `student` (gửi thông báo D-Bus vào phiên người dùng) | ✅ | ✅ |

### Lần 2: ADR-006 + `CAP_CHOWN`, 3 chu kỳ GNOME thật
```text
[01/3] Phiên=c18 | Login->GNOME: 4704 ms | decided_ok=True | SIGKILL=True (+176.0 ms) | Tổng TD: 2246.6 ms | Sạch=True
[02/3] Phiên=c20 | Login->GNOME: 5167 ms | decided_ok=True | SIGKILL=True (+ 94.9 ms) | Tổng TD: 2101.1 ms | Sạch=True
[03/3] Phiên=c22 | Login->GNOME: 5099 ms | decided_ok=True | SIGKILL=True (+208.6 ms) | Tổng TD: 2221.3 ms | Sạch=True
• Tổng chu kỳ hoàn thành: 3 / 3 | started > decided_at: 3 / 3 | vượt trần 3.0s: 0 / 3
```
Sau đó: đúng 1 tiến trình `lab_greeter.py`, không có mốc crash nào.

## 3. Hiệu Chỉnh Thiết Kế

- `CapabilityBoundingSet=CAP_KILL CAP_DAC_OVERRIDE CAP_SETUID CAP_SETGID CAP_CHOWN`. `CAP_CHOWN` cần để giao socket `/run/nfc/greeter-push.sock` cho nhóm `lightdm` (ADR-005 §2); thiếu nó thì mọi lần quẹt thẻ đều không tới được greeter.
- Không cần thêm quyền nào khác cho các thao tác đã thử.

## 4. Giới Hạn Bằng Chứng

- Agent được mô phỏng bằng harness S7b, chưa phải Agent Python hoàn chỉnh: chưa thử đọc PC/SC (`/run/pcscd`, cần thẻ thật, S1), chưa thử kết nối MQTT ra mạng và HTTPS đăng ký (hardening trên không giới hạn mạng nên dự kiến không ảnh hưởng).
- `stress-ng` trong harness cần `WorkingDirectory=/tmp` khi chạy dưới `ProtectSystem=strict`; đây là yêu cầu của công cụ tạo tải, không phải của Agent.
- N = 3 chu kỳ trên một VM.
