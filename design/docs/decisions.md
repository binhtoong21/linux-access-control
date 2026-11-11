# 📌 decisions.md

> Các quyết định về phân tích và thiết kế hệ thống, chốt trong quá trình xây dựng tài liệu 01–04. Quyết định kiến trúc và triển khai nằm ở [06-architecture/decisions](06-architecture/decisions/).

## Quyết định đã chốt

### D-001: Mô hình edge thuần
PC tự quyết định đăng nhập dựa trên snapshot cục bộ, không hỏi server tại thời điểm quẹt thẻ. Server giữ nguồn sự thật (danh tính, lịch, máy); Distribution dựng snapshot riêng cho từng máy và đẩy qua MQTT. Thay đổi chỉ có hiệu lực tại PC khi PC nhận snapshot mới.

**Nguồn:** BR-005, BR-010, BR-011; bounded-contexts (Edge, Distribution).

### D-002: Lease giữ ở mức định tính
Dữ liệu cục bộ có thời hạn tin cậy (lease): quá hạn mà không đồng bộ được thì PC từ chối mọi lần quẹt thẻ, fallback vẫn dùng được. Con số cụ thể chốt ở 06.

**Nguồn:** BR-006; NFR tham số chốt sau.

### D-003: Phạm vi MVP và Extension
- **Nice-to-have:** xác thực khuôn mặt (thư viện có sẵn, xử lý cục bộ).
- **Extension (làm sau):** buộc đăng xuất khi thu hồi thẻ/user, import Excel/CSV, điều khiển máy từ xa, API cho hệ thống ngoài, webhook, nhiều vai trò quản trị.

**Nguồn:** problem.md Goals; functional.md Extension.

### D-004: "Phân lịch" hiểu theo cách A
"Phân lịch" trong đề bài hiểu là: gán user hoặc nhóm vào máy hoặc zone theo khung giờ lặp (Schedule ba chiều: ai + ở đâu + khi nào). Không phải phân chia slot thời gian cố định cho phòng.

**Cần thầy xác nhận.**

### D-005: Kết quả ghi nhật ký là kết quả của quyết định, không phải của đăng nhập OS
Bản ghi nhật ký phản ánh quyết định của Agent (`LoginDecision`), được ghi bền vững cùng `LocalSession pending` trước khi trả quyền cho PAM (write-ahead). Nếu đăng nhập OS thất bại hoặc Agent sập, bản ghi vẫn giữ `granted`, không thêm bản ghi thứ hai hay đổi outcome. Trạng thái "granted mà chưa nhận phiên" suy ra bằng phép join qua `decision_id` (`entry_id`).
**Nguồn:** BR-007, swipe-login.md; giải quyết PD-001.

### D-006: Chính sách thay thế phiên, mô hình Profile OS dùng chung và hợp nhất lưu trữ Edge
1. **Chính sách thay thế phiên và chấp nhận rủi ro workstation_busy (BR-008, A4):** Không cho phép đá phiên tức thì khi Desktop người khác đang active và còn hạn (trả về `workstation_busy`, không làm gián đoạn người đang làm việc). Chỉ kích hoạt Two-Phase Teardown thay thế phiên (`abandoned` với `end_reason = superseded`) khi: (a) Phiên cũ đã chuyển về màn hình Greeter (người dùng chủ động logout), hoặc (b) Phiên cũ đã hết hạn ca học (`now >= expires_at`). Cùng user quẹt lại (`same_user`) thì bỏ qua tạo phiên và gửi thông báo D-Bus thời gian còn lại lên Desktop.
   - *Chấp nhận rủi ro vận hành (A4):* Nếu sinh viên bỏ quên không đăng xuất khi rời máy, máy tiếp tục ở trạng thái `workstation_busy` cho đến khi chạm hạn phiên. Đây là rủi ro được chủ động chấp nhận trong MVP để bảo đảm tính toàn vẹn phiên làm việc (tránh bị quẹt đè cướp phiên). Kỹ thuật viên xử lý các ca kẹt bằng fallback đăng xuất thủ công (chuyển VT hoặc đăng nhập quản trị). Không phát triển thêm cơ chế idle detection phức tạp.
2. **Dọn sạch tiến trình của phiên theo User Slice, KHÔNG xóa dữ liệu cục bộ (BR-009, A6):** Kết thúc phiên bằng cách dừng phiên OS và tiêu diệt 100% tiến trình thuộc user slice trước lượt tiếp theo bằng một cách duy nhất (`loginctl terminate-user <UID>`, chờ 2s, cưỡng chế `loginctl kill-user <UID> -s SIGKILL`). Đảm bảo SSHD cấu hình `DenyGroups labstudent` và tắt linger (`loginctl disable-linger`). **Phân biệt rõ: chỉ dọn tiến trình chạy ngầm, tuyệt đối KHÔNG tự động xóa thư mục `/home` hay file dữ liệu cục bộ** của sinh viên sau phiên. Dữ liệu trên máy được giữ lại phục vụ học tập; việc dọn file do giảng viên hoặc kỹ thuật viên thực hiện thủ công khi cần.
3. **Mô hình tài khoản OS dùng chung (Workstation Profile - BR-020):** Bãi bỏ giả định tạo tài khoản riêng `stu_<id>` cho từng sinh viên. Thay bằng mô hình tài khoản Linux dùng chung (`WorkstationProfile`, ví dụ `student`, `labuser`) được chuẩn bị sẵn môi trường, công cụ và dữ liệu thực hành. Phân tách triệt để:
   - **Danh tính xác thực (User/Card):** Xác định AI được phép ngồi vào máy, ghi nhận chính xác vào `AuditLog`.
   - **Profile đăng nhập (`os_username`):** Xác định môi trường Linux nào được mở.
   - Tài khoản dùng chung thuộc nhóm hạn chế, không cấp quyền sudo không mật khẩu, khóa mật khẩu cục bộ (`passwd -l`) nếu chỉ cho phép đăng nhập qua quẹt thẻ NFC.
4. **Hợp nhất kho lưu trữ cục bộ (INV-011, INV-013, INV-014):** Snapshot, Lease, LocalSession, Profile Allowlist và AuditOutbox được quản lý tập trung trong một cơ sở dữ liệu SQLite WAL duy nhất (`edge.db`), loại bỏ file JSON rời để đảm bảo tính nguyên tử ACID.
5. **Cơ chế phục hồi Greeter (BR-004):** Bỏ khẳng định "tự động chuyển về greeter chuẩn". Khi Custom Greeter gặp sự cố khởi động hoặc crash, LightDM sẽ dừng display-manager. Khôi phục thông qua script launcher wrapper kiểm tra tính khả dụng trước khi start hoặc kỹ thuật viên can thiệp thủ công qua TTY/SSH để cấu hình lại `/etc/lightdm/lightdm.conf`.
6. **Vô hiệu hóa Lock Screen và User Switching đối với Profile dùng chung (A3, P1-3):** Spike S3 xác nhận GNOME lock screen trên LightDM không hỗ trợ quẹt thẻ mở khóa và tài khoản dùng chung đã bị khóa mật khẩu (`passwd -l`), khiến người dùng có thể tự khóa mình cho đến hết ca học nếu màn hình bị khóa. Trong Master Image, bắt buộc vô hiệu hóa màn hình khóa, screensaver lock và tính năng chuyển đổi người dùng qua dconf:
   - `org.gnome.desktop.screensaver lock-enabled=false`
   - `org.gnome.desktop.lockdown disable-lock-screen=true`
   - `org.gnome.desktop.lockdown disable-user-switching=true`
   Việc tắt Switch User triệt tiêu hoàn toàn trạng thái lửng lơ "về Greeter nhưng Desktop cũ vẫn chạy ngầm", bảo đảm sinh viên chỉ có thể rời máy bằng Đăng xuất (Logout) hoặc chờ phiên tự kết thúc khi hết ca.
**Nguồn:** BR-004, BR-008, BR-009, BR-020, NFR-A02, NFR-C01, NFR-SEC07, kết luận điều chỉnh từ Spike S3-S6.

### D-007: Phạm vi vai trò hệ thống và cơ chế Fallback mật khẩu
1. **Phạm vi vai trò MVP (D-003, FR-082):** Hệ thống chỉ có duy nhất một vai trò quản trị là **Quản trị viên (Admin)**. Vai trò Giảng viên (phân quyền xem audit theo ca phụ trách) và tính năng Sơ đồ phòng máy trực quan là phần mở rộng (Extension), không thuộc phạm vi cốt lõi của MVP.
2. **Cơ chế Fallback mật khẩu (BR-004, BR-020):** Tài khoản sinh viên dùng chung bị khóa mật khẩu (`passwd -l`) đối với luồng đăng nhập thường. Fallback mật khẩu chỉ dành riêng cho **Kỹ thuật viên / Quản trị viên IT** bằng tài khoản quản trị cục bộ độc lập (ngoài phạm vi quản lý của Agent). Màn hình Custom Greeter cung cấp cả 2 ô nhập: Username và Password cho đường dự phòng này.
3. **Vai trò của hạ tầng NTP:** NTP là dịch vụ hạ tầng mạng có sẵn của OS, không phải hệ thống bên ngoài của nền tảng ứng dụng. Cờ đồng bộ NTP chỉ mang tính chất báo cáo trạng thái, không dùng làm điều kiện cổng để từ chối quẹt thẻ (ADR-001).

### D-008: Tuân thủ nghiêm ngặt khung giờ Schedule, loại bỏ buffer thời gian
Đánh giá quyền quẹt thẻ tại PC (CR-001) tuân thủ chính xác khoảng thời gian `[bắt đầu, kết thúc)` của Schedule được kích hoạt. Không tự ý áp dụng buffer thời gian 15 phút đầu/cuối ca. Hạn phiên là cuối chuỗi khung giờ liên tục không vượt quá `Max Session Duration`.

### D-009: Quản lý Profile máy trạm và cơ chế giải quyết Profile đích (Target Profile Resolution)
1. **Khai báo và Tự phát hiện Profile (Auto-Discovery, P2-1, P2-3):** Tài khoản OS dùng chung được kỹ thuật viên tạo sẵn trên máy trạm (qua Master Image hoặc `adduser`). Khi khởi động (Hello) hoặc gửi Heartbeat, Agent tự động quét danh sách tài khoản hợp lệ trên máy (các user thuộc nhóm hạn chế `labstudent`, UID ≥ 1000) và báo cáo danh mục profile hiện có lên Server (`WorkstationProfilesDiscovered`). Server quản lý metadata của profile: cờ bật/tắt (`enabled`/`disabled`) và profile mặc định (`is_default`) do Admin cấu hình.
2. **Chỉ định Profile đích qua `target_os_username` và Agent-side Resolve (A1, P2-1):** Schedule chỉ định `target_os_username` (ví dụ `student`, `labuser`) hoặc để trống để nhận profile mặc định của máy. Khi dựng Snapshot, server chỉ gửi chuỗi `target_os_username` thô kèm cờ metadata. Việc ánh xạ và thẩm định profile được thực hiện tại **Agent (Agent-side resolve)** đối chiếu với allowlist cục bộ của máy trạm. Dashboard hiển thị cảnh báo tĩnh nếu phát hiện máy trong Zone thiếu profile mà Schedule yêu cầu.
3. **Cấm mơ hồ Profile (No Ambiguity):** Khi hợp quyền nhiều Schedule khớp cho một lần quẹt (BR-016), nếu các Schedule này trỏ tới nhiều `target_os_username` khác nhau, kết quả là **mơ hồ và bị từ chối tuyệt đối** (`denied(ambiguous_profile)`). Không chọn ngầm theo thứ tự hay độ ưu tiên ngầm định.
4. **Giới hạn an toàn dữ liệu dùng chung (Non-Goals):** Hệ thống chỉ đóng vai trò Gatekeeper (kiểm soát truy cập), tuyệt đối không can thiệp, không quét, không xóa file/thư mục home cục bộ. Dữ liệu duyệt web (cookies), lịch sử terminal và file bài tập nằm trong `/home/<os_username>` là đặc thù dùng chung của phòng lab; việc dọn dẹp file định kỳ thuộc trách nhiệm của kỹ thuật viên/giảng viên (ngoài phạm vi hệ thống). Khuyến nghị sinh viên nộp bài qua LMS/hệ thống trực tuyến và chủ động đăng xuất tài khoản web cá nhân trước khi kết thúc ca.

### D-010: Quy trình Đăng ký máy tự động, Duyệt Re-enroll và Xác thực mTLS (P1-4)
1. **Chuẩn hóa Master Image (Sysprep sạch):** Đĩa mẫu được làm sạch trước khi nhân bản (clone hàng loạt qua Clonezilla/PXE): xóa trắng `/etc/machine-id` (hoặc để uninitialized theo khuyến cáo của systemd), xóa mọi credential/keypair cũ của Agent (thư mục `/var/lib/nfc-agent/identity/`: khóa, chứng chỉ, `K_m`); giữ lại chứng chỉ CA của server `/etc/nfc-agent/ca.pem` làm neo tin cậy (D-014).
2. **Khởi động lần đầu (First Boot) & Tự sinh khóa mTLS:** Khi máy trạm được nhân bản bật nguồn lần đầu, systemd tự động sinh `machine-id` mới duy nhất; Agent khởi chạy phát hiện chưa có định danh sẽ tự sinh cặp khóa Ed25519 và Certificate Signing Request (CSR), gửi bản tin đăng ký (`POST /api/v1/workstations/enroll`) gồm: `machine_id`, `hostname`, `mac_address` và `csr`.
3. **Trạng thái Chờ phê duyệt (Pending):** Server ghi nhận yêu cầu qua `EnrollmentRequest` ở trạng thái `pending`. Mọi trường hợp đăng ký lại bị trùng MAC hoặc machine-id với bản ghi cũ cũng bắt buộc rơi vào trạng thái `pending` kèm cờ `duplicate_mac_detected = true` để ngăn chặn giả mạo MAC cướp credential máy trạm; máy trạm đang chạy vẫn hoạt động bình thường, không bị tước quyền (P1-4).
4. **Phê duyệt tập trung trên Web Dashboard:** Admin mở Dashboard thấy danh sách các máy mới/đăng ký lại đang chờ duyệt, đối chiếu vị trí/tên máy và bấm phê duyệt (hỗ trợ duyệt hàng loạt). Sau khi duyệt, Server ký cấp Client Certificate mang `CN = workstation_id` và cấp khóa `K_m`. *(Bổ sung bởi D-014: bỏ EnrollmentToken, xử lý trùng giữa các yêu cầu đang chờ, CA nhúng sẵn, mã tải một lần và thu hồi chứng chỉ qua CRL.)* Mosquitto Broker xác thực máy trạm qua mTLS và phân quyền topic theo `%u`. Kỹ thuật viên không phải gõ token thủ công.

### D-011: Ràng buộc Lịch trong ngày (Single-Day Schedule Constraint)
1. **Cấm ca qua nửa đêm:** Ràng buộc chặt chẽ trong cùng một ngày lịch: `start_time < end_time` (`CHECK (start_time < end_time)`). Không hỗ trợ cấu hình ca học vắt qua nửa đêm (23:00 hôm trước sang 02:00 hôm sau) vì trái với thực tế vận hành đóng cửa phòng lab trường học trước 22:00.
2. **Chuẩn hóa Múi giờ:** Hệ thống chuẩn hóa duy nhất một múi giờ triển khai là `Asia/Ho_Chi_Minh` (UTC+7). Mọi tính toán giờ hiển thị, xếp lịch và đánh giá tại Edge đều đồng nhất theo múi giờ này.
3. **Đơn giản hóa Rule Evaluator (CR-001):** Hạn phiên được tính là cuối chuỗi khung giờ liên tục trong ngày, không cần thuật toán phức tạp nối khung giờ xuyên ngày hay bước nhảy ngày UTC/Local.

### D-012: Tách biệt Đồng hồ và Mốc sàn Cải tiến (Điểm 8)
1. **Tách biệt 2 cơ chế đồng hồ:**
   - **Bộ đếm thời lượng phiên (Session Timer):** Bắt buộc sử dụng đồng hồ đơn điệu `CLOCK_BOOTTIME`. Timer này đếm tick phần cứng kể từ lúc boot, hoàn toàn miễn nhiễm với việc đổi giờ hệ thống (bước nhảy NTP hay can thiệp `settimeofday`) và tính cả thời gian hệ thống suspend.
   - **Đánh giá Lịch & Lease:** Sử dụng giờ hệ thống (wall-clock UTC).
2. **Mốc sàn cải tiến (Điểm 8):** Loại bỏ cơ chế mốc sàn ghi đĩa liên tục gây hao mòn SSD. Thay bằng quy tắc thực tế:
   - Khi nhận snapshot hoặc gia hạn lease, Agent cập nhật `trusted_until` cùng với `last_sync_local_time`; hai giá trị luôn được ghi bền vững cùng nhau, nhưng gia hạn định kỳ chỉ ghi đĩa khi `trusted_until` tiến thêm ≥ 5 phút (ADR-003 §5). Mất điện chỉ làm lease ngắn đi và mốc sàn thấp hơn tối đa vài phút, tức là lệch về phía an toàn.
   - Mốc sàn đồng hồ được tính: `floor = last_sync_local_time - CLOCK_FLOOR_TOLERANCE` (với dung sai `CLOCK_FLOOR_TOLERANCE = 60s`); `last_sync_local_time` là **giờ của chính máy trạm** ghi lại lúc nhận snapshot mới hoặc gia hạn hợp lệ gần nhất, chỉ tiến (`max(cũ, giờ máy hiện tại)`) (sửa bởi D-018).
   - Khi quẹt thẻ lúc Offline: Nếu `local_time < floor`, từ chối ngay với lý do `data_stale (clock_invalid)` (phát hiện pin CMOS mainboard bị kiệt khiến giờ quay về 1970/2020). Nếu `local_time >= floor`, chấp nhận đánh giá lịch bình thường.
   - Khi Online: Heartbeat gửi kèm `server_time`. Nếu `|local_time - server_time| > CLOCK_SKEW_WARN_THRESHOLD` (60s), Agent ghi nhận và gửi cảnh báo `clock_skew_detected` lên dashboard để kỹ thuật viên kiểm tra pin CMOS / NTP. Agent vẫn chấp nhận gia hạn lease bình thường.

### D-013: Định vị Phạm vi Bảo mật UID Thẻ (Security Scope & Threat Model)
1. **Bản chất UID:** UID thẻ NFC là định danh công khai (Public Identifier), không phải bí mật chia sẻ (Shared Secret). Bất kỳ ai cũng có thể đọc UID bằng đầu đọc hoặc điện thoại NFC ở khoảng cách gần.
2. **Ranh giới bảo vệ (Threat Boundary):** 
   - Trước sinh viên (người dùng không đặc quyền): Quyền file hệ thống Linux (`0600 root:root` trên file SQLite WAL) và kênh truyền bảo mật TLS là lá chắn thực sự ngăn chặn việc đọc snapshot hay nghe lén mạng.
   - Trước Server dump / Rò rỉ sao lưu: Server mã hóa UID bằng AES-256-GCM và chỉ mục mù HMAC-SHA256.
   - Cơ chế HMAC theo máy (`CardMatchKey` trong [ADR-007](06-architecture/decisions/ADR-007-khoa-so-khop-uid.md)) được định vị đúng vai trò: **Khoanh vùng thiệt hại (Blast-radius reduction)** để snapshot của máy này không đối chiếu được trên máy khác khi kẻ tấn công lấy được đĩa cứng; không tuyên bố là cơ chế chống khôi phục UID đối với kẻ đã chiếm được quyền root trên chính máy đó (do UID 4 byte dễ bị vét cạn).

### D-014: Đăng ký máy luôn do Admin duyệt, xử lý trùng và thu hồi credential (bổ sung D-010)
1. **Bỏ EnrollmentToken.** Mọi `EnrollmentRequest` đều chờ Admin duyệt; Dashboard hỗ trợ "Duyệt tất cả" theo Zone. Lý do: đăng ký máy chỉ xảy ra vài lần mỗi học kỳ (clone phòng đầu kỳ, thay hoặc cài lại máy), người làm là kỹ thuật viên/Admin; token chỉ tiết kiệm một cú bấm nhưng thêm một bí mật phải bảo vệ trong Master Image, thêm bảng và thêm nhánh tự duyệt. FR-043 bỏ; BR-018, INV-010, XINV-009, UC-007 sửa theo.
2. **Trùng định danh.** Yêu cầu trùng MAC hoặc `machine_id` với máy đã có, **hoặc với một yêu cầu khác đang chờ**, đều mang cờ `duplicate_mac_detected`. Yêu cầu trùng một máy đã có chỉ được duyệt thành **cài lại chính máy đó** (cập nhật tại chỗ, tăng `key_version`) hoặc **từ chối**; không duyệt thành máy mới (giữ INV-009). "Duyệt tất cả" bỏ qua các yêu cầu có cờ.
3. **Neo tin cậy khi đăng ký.** Chứng chỉ CA của server nhúng sẵn trong Master Image; Agent chỉ gửi yêu cầu đăng ký và tải credential qua HTTPS đã xác thực bằng CA này. Không nhận CA từ chính gói trả lời đăng ký.
4. **Mã tải credential một lần.** Server sinh mã ngẫu nhiên riêng (không dùng id của yêu cầu, không đặt trong URL), chỉ lưu bản băm. Mã chỉ hết hiệu lực khi server nhận Hello đầu tiên của máy sau khi duyệt (tức máy đã kết nối được bằng chứng chỉ mới), nên mất gói trả lời giữa chừng thì máy tải lại được.
5. **Thu hồi credential.** Khi duyệt cài lại hoặc khi Admin vô hiệu hóa máy, serial chứng chỉ cũ vào danh sách thu hồi; server sinh lại tệp CRL cho Mosquitto (`crlfile`) và **khởi động lại** broker (S9: `SIGHUP` không ngắt kết nối đang mở của chứng chỉ đã thu hồi). CRL ký hạn dài, được sinh lại mỗi lần server khởi động và hằng ngày, tệp luôn tồn tại và ghi nguyên tử (S9: CRL hết hạn hoặc thiếu tệp làm broker từ chối mọi máy). Đây là cơ chế duy nhất làm cho "thu hồi credential cũ" (INV-010) có hiệu lực, vì broker không đọc CSDL.
6. **Bật lại máy đã vô hiệu hóa = đăng ký lại, không gỡ thu hồi.** Kỹ thuật viên chạy `sudo nfc-agent reenroll` trên máy (cất `identity/` cũ, sinh khóa mới, gửi yêu cầu; giữ nguyên `audit_outbox`); Admin duyệt thành cài lại chính máy đó. Chứng chỉ đã thu hồi không bao giờ dùng lại, vì máy có thể bị vô hiệu hóa do mất ổ cứng. Agent không tự đăng ký lại khi kết nối thất bại (không phân biệt được bị thu hồi với mất mạng). Hệ quả chấp nhận: máy vừa bị vô hiệu hóa vẫn cho quẹt theo snapshot cục bộ tới khi lease hết (≤ 24h).
**Nguồn:** BR-018, INV-010, XINV-009, UC-007, ADR-002, ADR-007; review sau 07-data.

### D-015: Nhận nhật ký từ Edge không bao giờ kẹt hàng đợi; báo cáo thật thay suy luận một lần
1. **Báo cáo thật thắng suy luận, kể cả khi đến muộn.** XINV-008 đã chốt "báo cáo của Agent thắng suy luận" nhưng INV-007 cũ cấm đổi trạng thái kết thúc, nên một `SessionEnded` đến sau thời gian chờ Draining bị chặn. Chốt: Session có `end_source = inferred` được thay **đúng một lần** bằng báo cáo thật (status, `ended_at`, `end_reason`, `end_source = reported`). Kết quả do Agent báo thì không đổi nữa.
2. **Mục lỗi không chặn cả lô.** Mục outbox không áp dụng được (dữ liệu sai định dạng, tham chiếu không tồn tại, xung đột trạng thái ngoài quy tắc trên) được server giữ nguyên văn kèm lý do để Admin xem; các mục khác áp dụng bình thường và lô vẫn được xác nhận. Nếu không, một mục lỗi khiến Edge gửi lại cùng lô mãi mãi và nhật ký phía sau không bao giờ lên server.
3. **Phiên mới đẩy phiên cũ đã lỗi thời.** Edge bảo đảm tối đa một phiên `active` (INV-014), nên nếu server nhận `SessionStarted` của một máy trong khi vẫn còn giữ phiên `active` khác của máy đó, phiên cũ chắc chắn đã kết thúc mà server không biết (ví dụ `edge.db` được dựng lại khi Agent khởi động lại mà máy không reboot, nên `boot_id` không đổi và XINV-008 không chạy). Server suy luận phiên cũ kết thúc (`abandoned`, `end_source = inferred`, `ended_at = max(started_at cũ, started_at mới)`) rồi mới ghi phiên mới; báo cáo thật đến sau vẫn thay được theo điểm 1. Không có quy tắc này, ràng buộc "một phiên active mỗi máy" ở server sẽ từ chối mọi phiên mới của máy đó.
**Nguồn:** INV-007, XINV-006, XINV-008, reconnect.md; review sau 07-data.

### D-016: Phiên bản snapshot không bao giờ lùi so với máy
Khi máy báo `snapshot_version` lớn hơn `desired_version` (chỉ xảy ra khi CSDL server được khôi phục từ bản sao lưu cũ), server đặt version kế tiếp `= max(desired_version, version máy) + 1`, dựng lại snapshot và gửi đi. Không có quy tắc này, Agent đúng theo INV-011 sẽ từ chối mọi snapshot "cũ hơn", server không gia hạn lease (vì `acked ≠ desired`), và cả phòng máy tự khóa sau khi lease hết.
**Nguồn:** INV-011, schedule-sync.md EF-4b, reconnect.md EF-9; review sau 07-data.

### D-017: Định danh máy là nguồn sự thật nằm ngoài `edge.db`; phục hồi khi `edge.db` hỏng
1. **Định danh tách khỏi CSDL.** `K_m`, `key_version`, chứng chỉ và tên máy (`mqtt_identity`) nằm cùng nhau trong `/var/lib/nfc-agent/identity/` và được ghi cùng lúc khi đăng ký hoặc cài lại. `edge.db` chỉ giữ bản sao `key_version` để tra nhanh, nạp lại từ `identity/` mỗi lần Agent khởi động. Nhờ vậy dựng lại `edge.db` không làm máy mang `key_version` sai rồi từ chối mọi snapshot.
2. **Khi `edge.db` hỏng:** Agent đổi tên tệp hỏng để giữ lại, cố trích các mục `audit_outbox` chưa gửi từ tệp hỏng sang tệp mới; phần không cứu được thì ghi một sự kiện cảnh báo (`edge_db_recovered`, kèm số mục mất) để Admin biết nhật ký có khoảng trống. Máy về `NoData`, đường mật khẩu dự phòng vẫn dùng được, và tự lấy lại snapshot khi online.
**Nguồn:** BR-004, BR-007, INV-013, ADR-003, migrations.md; review sau 07-data.

### D-018: Mốc sàn đồng hồ và thời hạn lease tính theo giờ của chính máy trạm (sửa D-012)
1. **Lỗi của công thức cũ.** `floor = max(snapshot.created_at, last_server_time) − 60s` lấy mốc theo **giờ server** rồi so với **giờ máy**. Máy chạy chậm hơn server quá 60s (pin CMOS yếu, NTP chưa chạy) bị `data_stale(clock_invalid)` ở mọi lần quẹt, kể cả khi online, trái với BR-012/D-012 ("lệch giờ chỉ cảnh báo, không chặn quẹt thẻ").
2. **Công thức mới.** `floor = last_sync_local_time − 60s`, với `last_sync_local_time` là giờ của chính máy lúc nhận snapshot mới hoặc gia hạn hợp lệ gần nhất, chỉ tiến. Vẫn phát hiện giờ máy bị lùi (pin CMOS chết về 1970, lùi giờ tay); lệch giờ so với server quay về đúng vai trò chỉ cảnh báo (`clock_skew_detected`). Hệ quả chấp nhận: NTP chỉnh lùi hơn 60s thì quẹt thẻ bị chặn tạm thời cho tới khi giờ thật vượt mốc sàn.
3. **Lease tính theo giờ máy, khớp BR-006.** Server gửi thời lượng `lease_duration_sec` (không gửi mốc `trusted_until` theo giờ server); Agent đặt `trusted_until = max(cũ, giờ máy lúc nhận + D)`.
4. **Chống phát lại lease.** Vì hạn tính từ lúc nhận, broker bị chiếm có thể phát lại một bản lease cũ để gia hạn mãi. Mỗi Hello/heartbeat mang một `lease_nonce` ngẫu nhiên mới; bản lease phải nhắc lại đúng một trong vài nonce gần nhất Agent đã gửi (nằm trong phần được ký HMAC) thì mới được nhận. Không phụ thuộc đồng hồ, không cần bộ đếm. Snapshot chỉ làm mới thời hạn khi có `version` mới, nên phát lại snapshot retained cũng không gia hạn được.
**Nguồn:** BR-006, BR-012, FR-056, XINV-007, D-012, ADR-001, ADR-002, lease-expiration.md; review 01–05.

### ADR-001 (Accepted): Xác thực ở edge, dữ liệu cục bộ có thời hạn tin cậy (lease)
Quy định ở Agent theo CR-001 từ snapshot cục bộ, không hỏi server khi quẹt thẻ. Dữ liệu cục bộ có thời hạn tin cậy (lease) được gia hạn qua phản hồi heartbeat khi `acked_version == desired_version`. Kiểm tra đồng hồ kết hợp hai hạn (UTC tuyệt đối bền vững và `CLOCK_BOOTTIME` cho phiên) kèm mốc sàn cải tiến `floor = last_sync_local_time - CLOCK_FLOOR_TOLERANCE`. Cần thầy xác nhận: giá trị lease `D` và việc tin RTC sau khi khởi động lại lúc offline.
**Nguồn:** [ADR-001](06-architecture/decisions/ADR-001-xac-thuc-o-edge-va-lease.md).

### ADR-002 (Accepted): Giao thức MQTT 5, phân quyền ACL, định danh máy trạm và mTLS
Chuẩn hóa giao thức MQTT 5 qua mTLS cổng 8883. Phân tách Mosquitto ACL triệt để giữa luồng đọc (`command/#`, `snapshot`, `lease`) và luồng ghi (`hello`, `heartbeat`, `outbox`, `status`), bãi bỏ wildcard lỏng lẻo. Giao thức Outbox đẩy theo lô (batch) và xác nhận lũy tiến (Cumulative ACK). Quy trình Master Image sysprep sạch (kèm CA server nhúng sẵn) tự sinh Ed25519 CSR, luôn do Admin duyệt trên Web Dashboard, phòng vệ trùng MAC/`machine_id` (P1-4), thu hồi chứng chỉ cũ qua CRL của Mosquitto (D-014). Mục outbox lỗi không chặn lô (D-015).
Lease mang thời lượng và nonce chống phát lại (D-018). Accepted sau S9.
**Nguồn:** [ADR-002](06-architecture/decisions/ADR-002-giao-thuc-mqtt-va-dinh-danh-may-tram.md), S5, S8, S9, D-010, D-014, D-018, `reconnect.md`.

### ADR-003 (Accepted): Lưu trữ cục bộ SQLite WAL, hợp nhất DB và xác thực snapshot bằng K_m
Hợp nhất toàn bộ Snapshot, Lease, Session và AuditOutbox vào một CSDL SQLite duy nhất `/var/lib/nfc-agent/edge.db` (chế độ WAL, `synchronous=FULL`). Khắc phục mâu thuẫn S5 vs D-006.4: chuyển giao việc fsync cho động cơ SQLite WAL. Bảo đảm tính nguyên tử ghi trước (Atomic Write-Ahead: ghi đồng thời Outbox và LocalSession pending trước khi trả quyền cho PAM). Xác thực toàn vẹn Snapshot, Lease và ACK bằng HMAC-SHA256 tính trên toàn bộ byte payload với khóa riêng `K_m`, chống broker bị chiếm hoặc replay snapshot giữa các máy. Định danh máy (`K_m`, `key_version`) nằm ngoài `edge.db` để phục hồi được khi DB hỏng (D-017).
**Nguồn:** [ADR-003](06-architecture/decisions/ADR-003-luu-tru-cuc-bo-va-xac-thuc-snapshot.md), S5, D-006.4, INV-011, INV-013, INV-014.

### ADR-004 (Accepted): Mô hình Profile OS dùng chung và phân tách danh tính xác thực
Phân tách danh tính sinh viên (User/Card) dùng cho kiểm soát truy cập và ghi AuditLog với Profile Linux dùng chung (`WorkstationProfile`, ví dụ `student`) để mở Desktop phục vụ học tập. Vô hiệu hóa Lock Screen và User Switching qua cấu hình dconf bắt buộc (`dconf update`) để triệt tiêu trạng thái lửng lơ; khuyến nghị gỡ/tắt `snapd-desktop-integration` khi dựng Master Image. Đã xác nhận End-to-End qua Spike S7b (20/20 chu kỳ GNOME thật trên UID `student` + SIGKILL, không treo D-Bus). Cơ chế Teardown đa pha được đặc tả tại ADR-008.
**Nguồn:** [ADR-004](06-architecture/decisions/ADR-004-mo-hinh-profile-os-dung-chung.md), D-006, S7b; giải quyết P1-2, P1-3, P2-1.

### ADR-005 (Proposed): Kiến trúc PAM module C, Lab Custom Greeter và cơ chế khôi phục
Chốt chuyển sang Display Manager LightDM. Module PAM viết bằng C thuần (`pam_nfc.so`), giao tiếp IPC không khóa qua Unix socket `/run/nfc-agent.sock` với fallback tức thì 22ms về mật khẩu cục bộ khi Agent treo/chết (BR-004, NFR-M01), bảo vệ cấp nhân bằng `SO_PEERCRED`. Xây dựng Lab Custom Greeter bằng Python GTK3 nhận tín hiệu đẩy qua `/run/nfc/greeter-push.sock` để đăng nhập 0-chạm (< 1.0s), loại trừ lỗi bấm login 2 lần. Áp dụng Startup Handshake 1.2s, bộ mã DenyReason đồng bộ và launcher wrapper script tự động fallback về GTK greeter sau 3 crash liên tiếp. Giữ Proposed cho tới khi wrapper (bản đã sửa, có chuyển tiếp SIGTERM) được chạy thử trong vòng boot LightDM thật (S7b chưa phủ).
**Nguồn:** [ADR-005](06-architecture/decisions/ADR-005-pam-greeter-va-display-manager.md), S2, S3, S3b, S6, D-006.5, D-007.2.

### ADR-006 (Accepted): Lựa chọn ngôn ngữ và techstack cho Edge Agent, Server và Dashboard
Chuẩn hóa 3 phân vùng độc lập nhằm tối thiểu hóa độ dốc học tập (tập trung năng lượng vào rủi ro Edge): Edge dùng Python >= 3.10 + C (PAM) để tận dụng một runtime duy nhất cùng Greeter GTK3 và tái cấu trúc từ bài học thực nghiệm spike S1–S7b; Server dùng NestJS/TypeScript + PostgreSQL 15 (tận dụng `node:crypto`, `@peculiar/x509`, `mqtt.js` và ánh xạ 1:1 với Ports & Adapters trong `components.md`); Dashboard dùng React + Vite. Đã kiểm chứng 3 trụ cột Node.js (Ed25519 CSR -> Client Cert, HKDF/HMAC parity với Python, MQTT 5 mTLS + ACL `%u`, PostgreSQL atomic TX) qua Spike S8; giới hạn: S8 chạy script rời trên PostgreSQL 14, chưa chạy trong NestJS + PostgreSQL 15.
**Nguồn:** [ADR-006](06-architecture/decisions/ADR-006-ngon-ngu-va-techstack.md), S3b, S5, S6, S7b, S8, D-010.

### ADR-007 (Accepted): Khóa so khớp UID thẻ và phạm vi lưu UID gốc
Server lưu UID mã hóa (AES-256-GCM) kèm chỉ mục mù (HMAC-SHA256). Snapshot chứa `CardMatchKey` = HMAC theo khóa riêng của máy (`K_m = HKDF(master_key, mqtt_identity || ":" || key_version)`, `mqtt_identity` là tên máy trong CN như `ws-01`), không chứa UID gốc. Nhật ký mang UID của lần quẹt qua TLS. Admin giải mã khi xem dashboard. Phạm vi bảo vệ: chiếm root một máy không làm lộ thẻ của người không liên quan tới máy đó.
**Nguồn:** [ADR-007](06-architecture/decisions/ADR-007-khoa-so-khop-uid.md); giải quyết PD-002.

### ADR-008 (Accepted): Quản lý vòng đời phiên và cơ chế teardown đa pha
Quy định máy trạng thái vòng đời phiên (`LocalSession`), chính sách từ chối `workstation_busy` khi Desktop đang active (A4) và quy trình Two-Phase Teardown khi thay phiên/hết hạn: tắt linger (`disable-linger`), `terminate-user` (2s), cưỡng chế `kill-user -s SIGKILL` (1s), tổng thời gian tiêu chuẩn `TOTAL_TEARDOWN_TIMEOUT = 3.0s`. Xử lý nhánh kẹt quá 3.0s: hiển thị banner vàng và retry tối đa 5.0s trước khi hủy `staged_auth`. Kết hợp Startup Handshake 1.2s với Lab Custom Greeter để triệt tiêu lỗi treo D-Bus ~110s. Đã xác nhận End-to-End qua Spike S7b (20/20 GNOME thật, 20/20 SIGKILL, tổng teardown P95/Max 2314.8 ms <= 3.0s, Linger 5/5).
**Nguồn:** [ADR-008](06-architecture/decisions/ADR-008-vong-doi-phien-va-teardown-da-pha.md), S6, S7, S7b; giải quyết BR-001, BR-008, BR-009, A6, P1-2.

## Điểm chuyển sang 06

Các quyết định sau được xác định trong 01–04 nhưng thuộc kiến trúc/triển khai, chốt bằng ADR ở 06:

| Điểm | Phát hiện từ | Ghi chú |
|------|-------------|---------|
| Giao thức MQTT 5 & mTLS: Client Certificate Ed25519, topic, QoS, Clean Start / Session Expiry, LWT với Will Delay | bounded-contexts, UC-004, reconnect.md | Chốt dùng MQTT 5 + mTLS; LWT là gợi ý bổ trợ, BR-019 vẫn là nguồn sự thật |
| Giao thức đẩy Outbox: thứ tự `outbox_seq`, kích thước lô | reconnect.md | **Chốt ở ADR-002:** lô tối đa 50 mục, ACK lũy tiến theo `outbox_seq`, mục lỗi không chặn lô (D-015) |
| Lưu trữ cục bộ: format SQLite WAL, giao dịch nguyên tử (nhật ký + pending), lưu `last_sync_local_time`, fsync vs write | BR-006, swipe-login.md, lease-expiration.md | Cần hỗ trợ transaction atomic write |
| PAM và greeter: kênh Unix domain socket, ai khởi xướng, timeout cho phép một lần, vô hiệu hóa lock screen & switch user | UC-001, swipe-login.md | Agent khóa trạng thái Waiting/Processing/Authorizing |
| Ánh xạ tài khoản OS & Recovery: tài khoản dùng chung `student`, cách nhận biết phiên OS thực tế khi restart | UC-001, swipe-login.md | Đối chiếu bảng recovery Agent restart |
| Khóa so khớp UID (PD-002): **chốt bởi ADR-007** | PD-002, domain-model.md | HMAC có khóa theo máy kèm `key_version`, server mã hóa + chỉ mục mù |
| Định danh máy & mTLS CSR: sinh cặp khóa Ed25519 lúc enroll, CSR gửi server ký | UC-007, reconnect.md | Phát hiện 2 máy cùng ID kết nối đè nhau |
| Đồng hồ: cách đọc `CLOCK_BOOTTIME`, xử lý bước nhảy NTP hợp lệ | BR-012, lease-expiration.md | Chỉ cảnh báo `clock_skew_detected`, không từ chối lease |

## Pending Decisions (phát hiện từ Use Cases)

### PD-001: Outcome khi PAM lỗi sau `granted` (ĐÃ CHỐT Ở D-005)

**Bối cảnh:** BR-007 yêu cầu đúng một bản ghi nhật ký mỗi lần quẹt, bất biến (INV-008). Bản ghi được tạo ngay khi có quyết định (`LoginDecided` → AuditOutbox, INV-013). Nếu Agent đã ghi `granted` nhưng đăng nhập OS thất bại:
- Ghi thêm bản ghi thứ hai → vi phạm "đúng một bản ghi".
- Chỉ ghi sau khi biết kết quả PAM → Agent sập giữa chừng thì mất bản ghi, vi phạm BR-007.

**Hướng xử lý dự kiến:** Giữ `granted` là kết quả của **quyết định** (domain), không phải kết quả đăng nhập OS. Session mang `entry_id` của lần quẹt. "Granted mà không có phiên" suy ra được từ dữ liệu.

**Chốt khi:** vẽ sequence "quẹt thẻ ở PC" ở 05-behavior.

**Phát hiện từ:** UC-001 EF-1.

### PD-002: Khóa so khớp UID — mâu thuẫn NFR-SEC03 (ĐÃ CHỐT Ở ADR-007)

**Bối cảnh:** NFR-SEC03 yêu cầu "UID không lưu dạng thô ở server", nhưng:
- `AuditLog.card_uid` trong domain-model giả định server có UID.
- `SnapshotContent` chứa mục thẻ theo `CardUid`.

**Hướng xử lý:** Server lưu UID mã hóa kèm chỉ mục mù; snapshot chứa `CardMatchKey` (HMAC theo máy); nhật ký mang UID qua TLS. Admin giải mã khi xem. NFR-SEC03 đã được viết lại cho khớp.

**Chốt khi:** ADR-007.

**Phát hiện từ:** UC-002, domain-model.md, NFR-SEC03.
