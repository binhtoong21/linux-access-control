# Kế hoạch spike

## Nguyên tắc

- **Mỗi spike trả lời một câu hỏi có/không**, có tiêu chí đạt rõ ràng và có timebox. Quá timebox mà chưa xong thì tự nó đã là kết quả: phương án đó quá đắt.
- **Code bỏ đi.** Dùng ngôn ngữ nào nhanh nhất (Python + pyscard cho đầu đọc, C cho PAM). Ngôn ngữ của Agent chính thức quyết ở ADR sau.
- **Ghi kết quả bằng một mẫu cố định:** câu hỏi, cách thử, số liệu, kết luận, ADR bị ảnh hưởng, giả định nào trong 01-05 bị lung lay.
- **An toàn khi thử PAM và greeter:** làm trong VM (chụp snapshot trước mỗi thử nghiệm), luôn mở sẵn một phiên SSH hoặc TTY root. Thử PAM trên một service riêng (`/etc/pam.d/nfctest` + `pamtester`) trước khi đụng vào service đăng nhập thật.

## Thứ tự và thời gian (khoảng 2-3 tuần)

| Spike | Câu hỏi | Timebox | Rủi ro |
|---|---|---|---|
| S0 | Môi trường | 0,5 ngày | Thấp |
| S1 | Đầu đọc và PC/SC (Đạt một phần) | 2 ngày | Trung bình (phần cứng) |
| S2 | PAM và Agent | 3 ngày | Cao |
| S3 | Greeter và màn hình khóa | 4 ngày | **Cao nhất** |
| S4 | Ánh xạ tài khoản OS và kết thúc phiên | 3 ngày | Cao |
| S5 | Agent, MQTT, lưu trữ nguyên tử | 3 ngày | Trung bình |
| S6 | Walking skeleton | 3 ngày | Tích hợp | ✅ Đạt |
| S7 | Teardown liên tiếp cùng UID & Linger (Đạt một phần cgroup) | 1 ngày | Cao (chốt chặn ADR-004) | ⚠️ Đạt một phần |
| S7b | Teardown thật qua GNOME/LightDM & SIGTERM Trap | 1 ngày | Cao (xác nhận ADR-004/008) | ✅ Đạt (20/20) |
| S8 | Kiểm chứng Mật mã, mTLS & Giao dịch Node.js | 0,5 ngày | Trung bình (xác nhận ADR-006) | ✅ Đạt (3/3) |
| S9 | Thu hồi chứng chỉ máy trạm bằng `crlfile` của Mosquitto | 0,5 giờ | Trung bình (xác nhận D-014, ADR-002) | ✅ Đạt (3 phát hiện) |
| S10 | Smoke-test wrapper greeter trong vòng boot LightDM | 1 giờ | Cao (BR-004, xác nhận ADR-005) | ✅ Đạt (sau khi sửa lỗi tự khóa) |
| S11 | Agent chạy dưới systemd hardening của ADR-006 | 0,5 giờ | Trung bình (xác nhận ADR-006) | ✅ Đạt (thêm `CAP_CHOWN`) |

Nên đặt mua hoặc mượn đầu đọc ngay hôm nay vì có thời gian chờ, S1 chạy song song với S0. Trình tự S2 → S3 → S4 vì chúng phụ thuộc nhau. S5 có thể làm xen.

## S0: Môi trường

Ubuntu 22.04 trong VM (QEMU hoặc VirtualBox), có USB passthrough cho đầu đọc, cài LightDM, pcscd, mosquitto, pamtester. Một máy thật cho vòng cuối. Tiêu chí: VM chụp snapshot được, thấy đầu đọc từ trong VM.

## S1: Đầu đọc và PC/SC

**Câu hỏi:** Lấy UID ổn định qua pcsclite chưa, và phát hiện "thẻ vừa xuất hiện" đúng theo BR-007c chưa?

Cần thử:
- Lệnh lấy UID chuẩn (APDU `FF CA 00 00 00`) với thẻ 4 byte, 7 byte nếu có.
- Để thẻ nằm yên trên đầu đọc: chỉ ra **một** sự kiện, không lặp.
- Rút và cắm đầu đọc lúc daemon đang chạy; quẹt hai thẻ nhanh liên tiếp; thẻ không đọc được hoặc thẻ lạ.
- Xung đột driver kernel với đầu đọc (một số dòng cần blacklist module; đây là lỗi thường gặp, nên ghi lại).
- Nếu có hai dòng đầu đọc: so thứ tự byte (liên quan rủi ro đảo byte trong ADR-007).

**Đạt khi:** 100 lần quẹt, 0 lần lỡ, 0 sự kiện trùng khi để thẻ nằm yên; phục hồi sau rút/cắm trong vài giây; UID cùng một thẻ giống nhau giữa các lần.

**Kết quả bổ sung (2026-11-11):** Thẻ static UID 4 byte đọc ổn định (`1F0820CF` 5/5), `SCardGetStatusChange` phát hiện đúng 8/8 lần đặt và nhấc thẻ, nhưng 3/8 lần kết nối thất bại khi thẻ vừa chạm → Agent phải thử kết nối lại trước khi ghi `reader_error`. Còn mở: 100 lần quẹt, hotplug, thẻ 7 byte. Xem [s1-reader-pcsc.md](s1-reader-pcsc.md).

**Ảnh hưởng:** FR-001, EF-2 trong swipe-login, ADR-007 (VR-007).

## S2: PAM và Agent

**Câu hỏi:** Một PAM module tối giản nói chuyện với Agent qua socket, mà không bao giờ chặn đường dự phòng, được không?

Cần thử, trên service `nfctest` trước:
- Agent chạy, trả "cho phép một lần" với `entry_id` và hạn ngắn: PAM thành công.
- Agent chết, hoặc socket không tồn tại: PAM trả kết quả bỏ qua, chuỗi PAM rơi xuống mật khẩu cục bộ (NFR-M01, BR-004).
- Agent **treo**, không trả lời: module timeout trong ngưỡng đã định.
- Dùng lại `entry_id` lần hai, hoặc quá hạn: bị từ chối.
- Ai kiểm tra danh tính của tiến trình nói chuyện với socket (quyền file socket, `SO_PEERCRED`).
- Sau khi ổn mới gắn vào một service đăng nhập thật (qua TTY, rồi qua LightDM).

**Đạt khi:** tất cả các ca trên đúng; không ca nào làm kẹt máy; thời gian từ lúc Agent cho phép đến lúc PAM trả kết quả ở mức không cảm nhận được.

**Ảnh hưởng:** BR-004, NFR-M01, swipe-login nguyên tắc 4; ADR "PAM và greeter".

## S3: Greeter và màn hình khóa (spike quan trọng nhất)

**Câu hỏi:** Có thể hiển thị đúng các trạng thái của FR-010 và đăng nhập **không cần gõ username** không?

Cần thử:
- Chốt display manager. Ubuntu mặc định dùng GDM, khó tùy biến; LightDM có đường đi (greeter tùy chỉnh qua `liblightdm`, hoặc web greeter). Hệ quả triển khai: máy phòng lab có thể phải đổi sang LightDM.
- Có bắt đầu xác thực khi chưa biết username được không, và PAM module có đặt được `PAM_USER` sau khi Agent xác định chủ thẻ không. **Đây là điểm tôi chưa chắc và cần kiểm chứng thật.**
- Greeter nhận sự kiện đẩy từ Agent (không bàn phím): chờ quẹt, đang xử lý, thành công, từ chối kèm lý do, `data_stale` kèm hướng dẫn dùng đường dự phòng.
- Nút hoặc cách vào đường dự phòng (đăng nhập mật khẩu cục bộ) luôn có.
- **Màn hình khóa:** quẹt thẻ khi máy đang có phiên của người khác (BR-008, `superseded`). Màn hình khóa là thành phần khác greeter, nhiều khả năng cần PAM service riêng và cơ chế riêng để nhận quẹt thẻ. Ghi riêng một mục.

**Phương án lùi nếu chưa làm được greeter tùy chỉnh:** hiển thị trạng thái bằng thông điệp văn bản qua hội thoại PAM. FR-010 giảm cấp nhưng vẫn chạy được.

**Đạt khi:** quẹt thẻ ở greeter thật vào được desktop và thấy ít nhất trạng thái thành công và từ chối kèm lý do; đường dự phòng dùng được khi Agent tắt.

**Ảnh hưởng:** FR-010, FR-011, BR-008; ADR "PAM và greeter" (quyết định hiện thực được hay phải hạ cấp).

## S4: Ánh xạ tài khoản OS và kết thúc phiên

**Câu hỏi:** Người quẹt thẻ đăng nhập vào tài khoản Linux nào, và kết thúc phiên sạch ra sao?

So sánh hai phương án trên cùng một kịch bản:
- **A: tài khoản dùng chung theo máy hoặc theo pool**, dọn sạch home sau mỗi phiên.
- **B: tài khoản theo user, Agent tạo khi áp snapshot**, ánh xạ `external_id` sang tên tài khoản.

Với mỗi phương án đo:
- Thư mục home: giữ hay xóa, và dữ liệu của người trước có lộ cho người sau không.
- Xác định "phiên OS tương ứng với LocalSession" khi Agent restart (cách gắn `entry_id` vào phiên).
- Kết thúc: `loginctl terminate-session`, `KillUserProcesses=yes`, tiến trình nền (tmux, script) có bị dọn không, và đăng xuất bị kẹt thì cưỡng bức ra sao.
- Gửi cảnh báo trước hạn vào phiên desktop của user (Agent chạy root, cần địa chỉ D-Bus của user).

**Đạt khi:** chọn được một phương án, với đủ năm việc trên chạy được; có bằng chứng bằng lệnh và log.

**Ảnh hưởng:** BR-009, INV-014, INV-017, FR-005; ADR "Ánh xạ tài khoản OS" (nên đứng trước ADR-007 về độ ưu tiên).

## S5: Agent, MQTT và lưu trữ nguyên tử

**Câu hỏi:** Daemon chịu được mất kết nối và mất điện, không hỏng dữ liệu cục bộ?

Cần thử:
- Mosquitto với TLS và ACL theo máy; client tự kết nối lại với lùi dần.
- Kích thước snapshot thử với 10, 50, 200 mục: có qua được một message MQTT không, retained hay hỏi khi kết nối.
- Hello và heartbeat một cấu trúc, nhận phản hồi gia hạn kèm `server_time`.
- Ghi snapshot kiểu file tạm + `fsync` + đổi tên; chạy vòng lặp `kill -9` và tắt nguồn cứng VM giữa lúc ghi, kiểm tra luôn đọc được bản cũ hoặc bản mới hoàn chỉnh.
- Một giao dịch duy nhất ghi cả bản ghi nhật ký và LocalSession `pending` (SQLite WAL là ứng viên); chạy cùng kiểu kill giữa chừng.
- Đồng hồ: một phép kiểm tra `now >= max(received_at, last_alive_at)`; thử máy về giờ 1970.

**Đạt khi:** 200 vòng kill/tắt nguồn, 0 lần hỏng dữ liệu; reconnect phục hồi mà không gây bão kết nối.

**Ảnh hưởng:** ADR giao thức MQTT, ADR lưu trữ cục bộ, NFR-A04, EF-1 trong reboot.md, ADR-003.

## S6: Walking skeleton

Ghép S1 đến S5 thành một luồng xuyên suốt với snapshot viết tay:
quẹt thẻ → Agent đánh giá CR-001 → ghi nhật ký → PAM cho vào → phiên chạy → hết hạn thì đăng xuất → máy sống lại sau khi rút điện. Kèm ca từ chối, ca `data_stale`, ca dự phòng. Chưa cần server thật, chưa cần dashboard.

**Đạt khi:** demo hết kịch bản trên một máy thật, quay lại video làm bằng chứng.

## S7: Teardown liên tiếp cùng UID & Linger (Cgroup tầng nhân)

Kiểm chứng tốc độ giải phóng cgroup `user-<UID>.slice` và `/run/user/<UID>` khi lặp 20 lần chu kỳ teardown trên cùng UID `student` dưới tải CPU 100%, và phản ứng dập tắt `enable-linger`.
**Kết quả:** Đạt một phần (cgroup giải phóng < 170ms; diệt sạch linger). Giới hạn: chưa đo trên môi trường đồ họa GNOME/LightDM thật.

## S7b: Teardown thật qua GNOME/LightDM & SIGTERM Trap

**Câu hỏi:** Khi đăng nhập thật qua Custom Greeter vào Desktop GNOME trên cùng UID `student`, có tiến trình bẫy `SIGTERM` để ép kích hoạt `kill-user -s SIGKILL`, tổng thời gian từ lúc quẹt thẻ đến khi Desktop mới nạp xong là bao nhiêu dưới tải CPU 100%?
**Đạt khi:** 20 chu kỳ lặp lại thành công 100%, không dính lỗi treo D-Bus ~110s, đo đạc phân vị P95 độ trễ teardown thật.
**Kết quả (2026-11-11):** **✅ Đạt 20/20** trên Ubuntu 22.04 GNOME + LightDM + `pam_nfc.so` + `lab_greeter.py` (1.2s Handshake), ép chạy Pha 2 `SIGKILL` **20/20** (`113.2`–`262.2 ms`), tổng teardown Min `2142.4 ms` | Mean `2210.8 ms` | P95/Max `2314.8 ms` (`0/20` vượt trần `3.0s`), Login -> GNOME Mean `5793 ms` (P95 `7133 ms`), Linger **5/5 (`N=5`)**, `started > decided_at` **20/20**. Phát hiện thêm nghẽn CPU của `snapd-desktop-integration` (Lần chạy 1) và sửa lỗi logic đếm crash trong `lab-greeter-wrapper.sh` (ADR-005). Xem [spike-results/s7b-teardown-gnome-e2e.md](s7b-teardown-gnome-e2e.md).
**Ảnh hưởng:** Xác nhận chính thức **ADR-004** và **ADR-008** lên trạng thái `Accepted`.

## S8: Kiểm chứng Mật mã, mTLS & Giao dịch Node.js (Server Spike)

**Câu hỏi:** Nền tảng Node.js / NestJS có thể ký CSR Ed25519, kết nối MQTT 5 mTLS với Mosquitto phân quyền ACL `%u`, và thực thi giao dịch PostgreSQL nguyên tử không?
**Cần thử:**
- Cấp Client Certificate mang `CN = workstation_id` từ CSR Ed25519 (dùng `@peculiar/x509` hoặc OpenSSL CLI).
- Dùng `mqtt.js` kết nối mTLS cổng 8883 vào Mosquitto, kiểm tra ACL `%u` lấy từ CN (`use_identity_as_username true`).
- Giao dịch PostgreSQL nguyên tử lưu schedule và event outbox.
**Đạt khi:** Cả 3 bài test chạy pass trong 0.5 ngày.
**Kết quả (2026-11-11):** **✅ Đạt 3/3** trên Node.js `v20.20.2`, Mosquitto `2.0.11`, PostgreSQL `14.24`: (1) `@peculiar/x509` + `reflect-metadata` + `crypto.webcrypto` xác thực & ký Client Cert từ CSR Ed25519 (`Valid: true`) và `HKDF+HMAC` khớp Python 3 `100%`; (2) `mqtt.js` mTLS `8883` nhận tin có MQTT 5 `User Property`, nhận `0` tin rò rỉ từ `ws-other-99`, chặn `PUBLISH` trái phép với `135 (0x87)` (đồng thời phát hiện `acl_file` lọc `read` ở egress thay vì chặn `SUBACK` — đã hiệu chỉnh vào ADR-002); (3) giao dịch `pg` `COMMIT` + `ROLLBACK` sạch `schedules=1, outbox_events=1`. Xem [spike-results/s8-server-crypto-mtls-pg.md](s8-server-crypto-mtls-pg.md).
**Ảnh hưởng:** Xác nhận chính thức **ADR-006** lên trạng thái `Accepted`.

## S9: Thu hồi chứng chỉ bằng CRL (Mosquitto `crlfile`)

**Câu hỏi:** Mosquitto 2.0.11 có từ chối chứng chỉ máy đã thu hồi mà vẫn nhận chứng chỉ mới cùng CN không; nạp lại CRL thế nào; có tình huống CRL làm tự khóa toàn hệ thống không?
**Kết quả (2026-11-11):** **✅ Đạt** trên Mosquitto `2.0.11` + OpenSSL `3.0.2`: thu hồi theo serial, chứng chỉ mới cùng CN `ws-01` vẫn vào được; `SIGHUP` nạp lại CRL nhưng **không ngắt** kết nối đang mở của chứng chỉ đã thu hồi (phải khởi động lại broker); CRL **hết hạn** làm broker từ chối mọi client; **thiếu tệp** CRL thì broker không khởi động. Xem [spike-results/s9-mosquitto-crl.md](s9-mosquitto-crl.md).
**Ảnh hưởng:** Hiệu chỉnh ADR-002 §1 và D-014 điểm 5 (khởi động lại broker, CRL hạn dài + làm mới định kỳ, tệp luôn tồn tại và ghi nguyên tử).

## S10: Smoke-test wrapper greeter (ADR-005)

**Câu hỏi:** `lab-greeter-wrapper.sh` có rơi về `lightdm-gtk-greeter` sau 3 crash, không đếm nhầm đăng nhập bình thường, và chuyển tiếp SIGTERM không để lại tiến trình mồ côi không?
**Kết quả (2026-11-11):** **✅ Đạt sau khi sửa**: bản trong ADR ghi tệp đếm ở `/run` mà user `lightdm` không ghi được, nên LightDM crash lặp tới khi systemd dừng hẳn (màn hình đen, không fallback). Chuyển sang `/var/lib/lightdm`: 3 crash thì rơi về greeter chuẩn; 3 lần đăng nhập GNOME thật qua harness S7b không kích hoạt fallback, chỉ còn 1 tiến trình greeter. Xem [spike-results/s10-greeter-wrapper.md](s10-greeter-wrapper.md).
**Ảnh hưởng:** Sửa ADR-005 (đường dẫn tệp đếm, cách gắn wrapper qua `.desktop`, ràng buộc với giới hạn khởi động lại systemd); nâng ADR-005 lên `Accepted`.

## S11: Agent dưới systemd hardening (ADR-006)

**Câu hỏi:** Với `ProtectSystem=strict`, `ProtectHome=read-only`, `PrivateTmp`, `ReadWritePaths` và `CapabilityBoundingSet` của ADR-006, Agent có còn mở socket cho greeter/PAM, ghi `edge.db`, gọi logind dọn phiên được không? (S6, S7b chạy không có hardening.)
**Kết quả (2026-11-11):** **✅ Đạt sau khi sửa**: đúng như ADR-006 thì `chown` socket đẩy sự kiện cho nhóm `lightdm` bị chặn (`EPERM`), greeter không kết nối được, 0 lần đăng nhập. Thêm `CAP_CHOWN`: 3/3 chu kỳ GNOME thật đạt, teardown ≤ 2246.6 ms. Xem [spike-results/s11-agent-systemd-hardening.md](s11-agent-systemd-hardening.md).
**Ảnh hưởng:** Bổ sung `CAP_CHOWN` vào ADR-006.

## Từ kết quả spike đến ADR

| Kết quả | ADR được viết |
|---|---|
| S2, S3 | PAM và greeter (có thể kèm lựa chọn display manager) |
| S4 | Ánh xạ tài khoản OS |
| S5 | Giao thức MQTT; lưu trữ cục bộ; snapshot (ADR-003) |
| S1 | Bổ sung ADR-007 (thứ tự byte, loại đầu đọc) |
| S7, S7b | ADR-004 (Mô hình profile dùng chung) & ADR-008 (Vòng đời phiên & Teardown đa pha) |
| S8 | ADR-006 (Lựa chọn techstack Server NestJS / Node.js) |
| S9 | ADR-002 (thu hồi chứng chỉ qua CRL), D-014 |
| S10 | ADR-005 (wrapper greeter và fallback) |
| S11 | ADR-006 (systemd hardening của Agent) |

## Quy tắc quyết định

- Spike nào làm lung lay giả định trong 01-05 thì ghi vào mục "giả định bị ảnh hưởng" và sửa tài liệu sau, theo đúng quy tắc file context không phải sự thật tuyệt đối.
- Hết timebox mà chưa đạt: quyết định ngay giữa hạ cấp (như FR-010 qua PAM text) hay kéo dài, và ghi lý do.
- Đừng thêm spike mới cho đến khi S6 chạy.