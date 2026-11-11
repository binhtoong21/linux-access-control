# 🛡️ Threat Model

> Hệ thống là **cổng kiểm soát truy cập** máy trạm: quyết định ai được mở phiên trên máy nào vào lúc nào, và ghi lại điều đó. Mô hình đe dọa chỉ xét những gì làm cổng này cho sai người vào, chặn sai người, làm sai nhật ký hoặc tự khóa. Phạm vi bảo mật UID theo [D-013](../decisions.md); các quyết định chi tiết nằm ở ADR-002, ADR-003, ADR-005, ADR-007 và D-014, D-018.

## Phạm Vi

**Trong phạm vi:** quyết định đăng nhập tại máy trạm, dữ liệu snapshot/lease, kênh Server ⇄ Edge, đăng ký máy, nhật ký kiểm toán, Dashboard quản trị.

**Ngoài phạm vi (thực tế được chấp nhận của phòng máy dùng chung):**
- Dữ liệu trong `/home/<profile>` dùng chung, trình duyệt còn đăng nhập sẵn, file bài tập của người trước (D-009.4).
- Người có quyền vật lý với máy: mở case, đổi BIOS, boot từ USB. Biện pháp ngoài hệ thống: mật khẩu BIOS, khóa thứ tự boot, khóa case (khuyến nghị ở `deployment.md`).
- Thẻ bị sao chép UID: UID là định danh công khai (D-013.1). Hệ thống không tuyên bố chống clone thẻ; thẻ demo là static-UID.
- Mạng trường bị tấn công diện rộng (DoS hạ tầng): hệ thống chỉ bảo đảm máy không tự khóa nhờ lease (NFR-A01).

## Assets

| Asset | Độ nhạy | Nằm ở đâu | Mô tả |
|---|---|---|---|
| Quyết định cho vào máy | Cao | Agent (CR-001) | Mục tiêu chính của kẻ tấn công: vào máy ngoài lịch hoặc không có quyền |
| Snapshot + lease | Cao | `edge.db` (0600 root), bản tin MQTT | Ai được vào khi nào; giả được thì giả được quyết định |
| `K_m` theo máy | Cao | `identity/identity.json` (0600 root); Server dẫn xuất từ `master_key` | Ký/kiểm snapshot, lease, ACK; tính `CardMatchKey` |
| `master_key`, `K_index`, khóa AES mã hóa UID | Rất cao | Server (biến môi trường / tệp 0600, ngoài CSDL) | Lộ là dẫn xuất được mọi `K_m`, giải mã được mọi UID |
| Khóa CA nội bộ | Rất cao | Server, tệp 0600 | Ký chứng chỉ máy, ký CRL |
| Khóa riêng mTLS của máy | Cao | `identity/client.key` | Mạo danh máy trên broker |
| Nhật ký kiểm toán | Cao (toàn vẹn) | `audit_outbox` → `audit_logs` | Chứng cứ ai dùng máy; phải đủ, không sửa được |
| Dữ liệu cá nhân (họ tên, mã SV, UID) | Trung bình | Server; snapshot chỉ chứa user liên quan tới máy | Dữ liệu cá nhân theo quy định hiện hành |
| Tài khoản Admin | Cao | `admin_accounts` (mật khẩu băm) | Toàn quyền quản trị |
| Tính sẵn sàng đăng nhập | Cao | Toàn hệ thống | Tự khóa = phòng máy không dùng được |

## Threat Actors

| Actor | Động cơ | Khả năng giả định |
|---|---|---|
| Sinh viên (người dùng không đặc quyền) | Vào máy ngoài ca, dùng máy của người khác, xóa dấu vết | Quyền `student` (không sudo), có điện thoại đọc/ghi NFC, đọc được UID thẻ người khác ở cự ly gần, có thể rút điện/rút mạng máy |
| Người trong mạng LAN | Nghe lén, giả server/broker, cướp định danh máy khi đăng ký | Bắt và chèn gói tin trong LAN, giả mạo ARP/MAC |
| Người chiếm được root một máy trạm | Mở rộng sang máy khác, giả nhật ký | Đọc `edge.db`, `identity/` của **máy đó** |
| Người chiếm được broker | Giả snapshot/lease, chặn hoặc phát lại bản tin | Đọc/ghi mọi topic, không có `K_m` |
| Admin dùng sai quyền / lộ mật khẩu admin | Sửa lịch, cấp thẻ trái phép | Toàn quyền Dashboard; **không** sửa/xóa được nhật ký |

## Permission Matrix

MVP có một vai trò quản trị (D-007). Ma trận ghi cả các tác nhân máy.

| Tác nhân | Tài nguyên | Được phép | Điều kiện / giới hạn |
|---|---|---|---|
| Admin | User, nhóm, thẻ, zone, lịch, profile | Tạo, sửa, bật/tắt; "xóa" user = `inactive` | Không xóa đối tượng còn lịch tham chiếu (BR-017) |
| Admin | Máy trạm, yêu cầu đăng ký | Duyệt (máy mới / cài lại), từ chối, vô hiệu hóa, xóa máy đã `disabled` | Yêu cầu trùng chỉ duyệt thành cài lại (D-014) |
| Admin | Nhật ký, phiên, `ingest_rejects`, cảnh báo | Xem, lọc; xem UID giải mã ở trang chi tiết; đánh dấu đã xử lý mục lỗi | **Không** sửa, không xóa (INV-008, trigger CSDL) |
| Admin | Tài khoản admin | Tạo, vô hiệu hóa, đổi mật khẩu của mình | Không vô hiệu hóa admin hoạt động cuối cùng (INV-016) |
| Agent máy `{ws}` | Topic MQTT | Đọc `{ws}/snapshot`, `{ws}/lease`, `{ws}/command/#`; ghi `{ws}/hello`, `heartbeat`, `outbox`, `status` | Chỉ topic của chính CN (ACL `%u`, ADR-002) |
| Agent chưa đăng ký | REST | `POST /workstations/enroll`, `GET …/status` với `fetch_code` | Không tự duyệt; giới hạn tần suất |
| Server | Topic MQTT | Đọc mọi `hello/heartbeat/outbox/status`; ghi mọi `snapshot/lease/command` | Chứng chỉ riêng `CN = nfc-server` |
| PAM `pam_nfc.so` | Socket `/run/nfc-agent.sock` | Hỏi Agent cho một lần đăng nhập đã staged | Agent kiểm `SO_PEERCRED` UID 0 (ADR-005) |
| Greeter (`lightdm`) | Socket `/run/nfc/greeter-push.sock` | Nhận sự kiện quẹt, gửi `greeter_ready` | Socket `0770 root:lightdm` |
| Profile `student` | Máy trạm | Phiên desktop trong hạn | Không sudo, `passwd -l`, `DenyGroups labstudent` cho SSH, tắt linger, khóa lock screen/switch user (BR-020, D-006) |

## STRIDE Analysis

| Loại | Mối đe dọa | Thành phần | Biện pháp | Trạng thái |
|---|---|---|---|---|
| **S** | Dùng thẻ (hoặc UID chép) của người khác | Đầu đọc / Agent | Ngoài phạm vi chống clone (D-013). Giảm thiệt hại: chỉ vào được theo lịch của chủ thẻ, mọi lần quẹt ghi UID thật vào nhật ký, thẻ khóa được từ Dashboard | Chấp nhận có kiểm soát |
| **S** | Giả server khi máy đăng ký để lấy `K_m` hoặc đưa CA giả | Đăng ký HTTPS | CA nhúng sẵn trong Master Image, không nhận CA từ gói trả lời (D-014.3) | ✅ Thiết kế |
| **S** | Gửi yêu cầu đăng ký giả mang MAC/hostname của máy thật | Đăng ký | Admin luôn duyệt; trùng với máy đã có hoặc yêu cầu khác đang chờ thì gắn cờ, chỉ duyệt thành cài lại hoặc từ chối (D-014.1–2) | ✅ Thiết kế |
| **S** | Dùng chứng chỉ cũ (ổ đĩa máy cài lại, máy bị vô hiệu hóa) để mạo danh máy | Broker | CRL + khởi động lại broker (D-014.5) | ✅ S9 |
| **S** | Tiến trình thường giả làm PAM để lấy quyền đăng nhập | Socket PAM | `SO_PEERCRED` chỉ nhận UID 0; socket `0660 root:root` | ✅ S2 |
| **T** | Sửa snapshot trên broker hoặc chép snapshot máy khác | MQTT | HMAC theo `K_m` trên toàn byte payload, có `workstation_id` và `version` bên trong (ADR-003) | ✅ Thiết kế, S8 (parity) |
| **T** | Phát lại lease cũ để kéo dài thời hạn tin cậy | MQTT | Lease phải nhắc lại `lease_nonce` vừa gửi (D-018.4); snapshot cũ/cùng version không gia hạn | ✅ Thiết kế |
| **T** | Lùi giờ máy để vào ca đã qua; tiến giờ để vào ca sau | Đồng hồ máy | Lùi giờ: mốc sàn theo giờ máy (D-018). Tiến giờ lúc offline: chấp nhận, chỉ trong quyền sẵn có và trước `trusted_until` (ADR-001); khuyến nghị mật khẩu BIOS. Thời lượng phiên dùng `CLOCK_BOOTTIME` nên đổi giờ không kéo dài phiên | Chấp nhận có kiểm soát |
| **T** | Sửa `edge.db` để thêm thẻ hoặc xóa nhật ký | Máy trạm | Tệp `0600 root` trong thư mục `0700`; sinh viên không có root. Người đã có root một máy nằm ngoài phạm vi bảo vệ của máy đó (D-013.2) | ✅ Thiết kế |
| **R** | Chối đã dùng máy | Nhật ký | Mỗi lần quẹt đúng một bản ghi, ghi bền trước khi trả quyết định, có UID thật, ảnh chụp danh tính và version dữ liệu (BR-007); `audit_logs` chỉ ghi thêm (trigger) | ✅ Thiết kế |
| **R** | Rút điện ngay sau khi quẹt để mất dấu | Edge | Ghi nguyên tử nhật ký + phiên `pending` với `synchronous=FULL` trước khi trả quyết định (D-005) | ✅ S5 (giới hạn: 1 lần cắt điện trên VM) |
| **R** | Mất nhật ký khi `edge.db` hỏng | Edge | Cứu outbox từ tệp hỏng; phần mất được báo `edge_db_recovered` kèm số mục (D-017) | ✅ Thiết kế |
| **I** | Đọc snapshot để lấy danh sách UID | Máy trạm | Snapshot chỉ có `CardMatchKey` theo máy, không có UID; chỉ chứa user liên quan tới máy (INV-012, ADR-007) | ✅ Thiết kế |
| **I** | Lộ bản sao CSDL server | Server | UID mã hóa AES-256-GCM + blind index; mật khẩu admin băm; `master_key`/khóa AES/khóa CA không nằm trong CSDL | ✅ Thiết kế |
| **I** | Nghe lén LAN | Mạng | TLS cho REST, mTLS cho MQTT (NFR-SEC01) | ✅ S8 |
| **I** | Máy trạm này đăng ký đọc topic của máy khác | Broker | ACL `pattern read …/%u/…`; broker lọc ở egress, 0 byte rò rỉ (S8) | ✅ S8 |
| **D** | Server/broker sập, mất mạng | Toàn hệ thống | Edge quyết định cục bộ trong thời hạn lease (NFR-A01); đường mật khẩu dự phòng cho kỹ thuật viên luôn còn (BR-004) | ✅ S6 |
| **D** | Hệ thống tự khóa do chính cơ chế bảo vệ (CRL hết hạn, greeter crash lặp, hardening chặn socket) | Broker, greeter, Agent | CRL hạn dài + làm mới định kỳ + tệp luôn tồn tại (S9); tệp đếm crash ở `/var/lib/lightdm` (S10); thêm `CAP_CHOWN` (S11) | ✅ S9, S10, S11 |
| **D** | Sinh viên quên đăng xuất làm máy bận | Phiên | Chấp nhận trong MVP (A4, D-006.1); phiên tự kết thúc ở hạn | Chấp nhận |
| **D** | Dò mật khẩu admin, spam yêu cầu đăng ký | REST | Giới hạn tần suất (`api.md`) | ✅ Thiết kế |
| **E** | Sinh viên giữ tiến trình chạy tiếp sau phiên (tmux, `systemd-run --user`, linger) | Máy trạm | Two-Phase Teardown theo user slice, tắt linger, `DenyGroups labstudent` (ADR-008) | ✅ S7, S7b |
| **E** | Lỗ hổng trong Agent Python chạy root | Agent | Hardening systemd (`ProtectSystem=strict`, giới hạn capability), PAM tách riêng bằng C và tự `PAM_IGNORE` khi Agent lỗi (ADR-005, ADR-006) | ✅ S11 |
| **E** | Chiếm root một máy để giả mạo máy khác | Máy trạm | `K_m` và chứng chỉ chỉ của máy đó; ACL theo CN; `CardMatchKey` không dùng được trên máy khác (blast radius, D-013.2) | ✅ Thiết kế |

## Security Controls

| Control | Lớp | Cách hiện thực | Trạng thái |
|---|---|---|---|
| Xác thực Admin | API | Username/password (băm Argon2id/bcrypt), JWT trong cookie `HttpOnly; Secure; SameSite=Strict`, kiểm tra trạng thái admin mỗi request | Thiết kế (`api.md`) |
| Xác thực máy | MQTT | mTLS, chứng chỉ Ed25519 theo máy, CN = `mqtt_identity`, CRL | S8, S9 |
| Phân quyền | API / MQTT | Một vai trò Admin; ACL đọc/ghi theo `%u` | S8 |
| Toàn vẹn dữ liệu xuống máy | Ứng dụng | HMAC-SHA256 theo `K_m` cho snapshot/lease/ACK, nonce cho lease | Thiết kế, S8 |
| Mã hóa khi lưu | Dữ liệu | UID AES-256-GCM + blind index ở Server; `edge.db`/`identity/` dựa vào quyền tệp root | Thiết kế |
| Mã hóa đường truyền | Mạng | TLS 1.2+ (REST), mTLS (MQTT 8883) | S8 |
| Kiểm tra đầu vào | Ứng dụng | VR-001…012; regex `mqtt_identity` chống chèn ký tự wildcard vào ACL | Thiết kế |
| Giới hạn tần suất | API | Đăng nhập admin, đăng ký máy (`api.md`) | Thiết kế |
| Nhật ký bất biến | Dữ liệu | Trigger chặn `UPDATE/DELETE` trên `audit_logs` | Thiết kế (07-data) |
| Cô lập phiên | OS | Profile dùng chung không sudo, teardown theo user slice, khóa lock screen | S7b |
| Giới hạn Agent | OS | Hardening systemd | S11 |

## Quản Lý Khóa

| Khóa | Sinh ở đâu | Lưu ở đâu | Xoay vòng |
|---|---|---|---|
| `master_key` | Server, lúc cài đặt | Tệp `0600`, ngoài CSDL, sao lưu riêng (`deployment.md`) | Không xoay trong MVP; lộ thì phải đăng ký lại mọi máy |
| `K_m` | Dẫn xuất `HKDF(master_key, mqtt_identity:key_version)` | Không lưu ở Server; máy giữ trong `identity/` | Tăng `key_version` khi cài lại máy (ADR-007) |
| `K_index`, khóa AES UID | Server | Tệp `0600`, ngoài CSDL | Khóa AES có `key_id` để xoay; `K_index` không xoay trong MVP |
| Khóa CA | Server | Tệp `0600` | Không xoay trong MVP (CA 10 năm, chứng chỉ máy 3 năm) |
| Khóa mTLS máy | Máy, lúc đăng ký | `identity/client.key` | Cài lại máy → chứng chỉ mới, cũ vào CRL |

## Compliance

| Chuẩn / quy định | Áp dụng | Ghi chú |
|---|---|---|
| Quy định bảo vệ dữ liệu cá nhân hiện hành của Việt Nam | Có, ở mức tối thiểu | Dữ liệu: họ tên, mã người dùng, UID thẻ, thời điểm dùng máy. Chỉ thu thập phục vụ kiểm soát truy cập; UID mã hóa khi lưu; chỉ Admin xem được; không chia sẻ ra ngoài. Thời hạn lưu nhật ký do đơn vị vận hành quyết định (`observability.md`) |
| GDPR, SOC 2 | Không | Không phục vụ thị trường/khách hàng áp dụng |
