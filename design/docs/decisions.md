# 📌 decisions.md

> Các quyết định về phân tích và thiết kế hệ thống, chốt trong quá trình xây dựng tài liệu 01–08 (D-014 trở đi phát sinh khi review 06–08). Quyết định kiến trúc và triển khai nằm ở [06-architecture/decisions](06-architecture/decisions/).

## Quyết định đã chốt

### D-001: Mô hình edge thuần
PC tự quyết định đăng nhập dựa trên snapshot cục bộ, không hỏi server tại thời điểm quẹt thẻ. Server giữ nguồn sự thật (danh tính, lịch, máy); Distribution dựng snapshot riêng cho từng máy và đẩy qua MQTT. Thay đổi chỉ có hiệu lực tại PC khi PC nhận snapshot mới.

**Nguồn:** BR-005, BR-010, BR-011; bounded-contexts (Edge, Distribution).

### D-002: Lease giữ ở mức định tính
Dữ liệu cục bộ có thời hạn tin cậy (lease): quá hạn mà không đồng bộ được thì PC từ chối mọi lần quẹt thẻ, fallback vẫn dùng được. Con số cụ thể chốt ở 06.

**Nguồn:** BR-006. Giá trị đã chốt (D = 24h) ở [Bảng Tham Số](11-operations/deployment.md#bảng-tham-số).

### D-003: Phạm vi MVP và Extension
- **Nice-to-have:** xác thực khuôn mặt (thư viện có sẵn, xử lý cục bộ).
- **Extension (làm sau):** buộc đăng xuất khi thu hồi thẻ/user, import Excel/CSV, điều khiển máy từ xa, API cho hệ thống ngoài, webhook, nhiều vai trò quản trị.

**Nguồn:** problem.md Goals; functional.md Extension.

### D-004: "Phân lịch" hiểu theo cách A
"Phân lịch" trong đề bài hiểu là: gán user hoặc nhóm vào máy hoặc zone theo khung giờ lặp (Schedule ba chiều: ai + ở đâu + khi nào). Không phải phân chia slot thời gian cố định cho phòng.

**Đã chốt:** đây là cách hiểu duy nhất khớp với đề bài ("phân lịch, quản lý lịch") và với mô hình Schedule ba chiều toàn bộ thiết kế dựa vào.

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
4. **Mã tải credential một lần** (làm rõ bởi D-032). Server sinh mã ngẫu nhiên riêng (không dùng id của yêu cầu, không đặt trong URL), chỉ lưu bản băm. Mã chỉ hết hiệu lực khi server nhận Hello đầu tiên của máy sau khi duyệt (tức máy đã kết nối được bằng chứng chỉ mới), nên mất gói trả lời giữa chừng thì máy tải lại được.
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

### D-018: Mốc sàn đồng hồ và thời hạn lease tính theo giờ của chính máy trạm (sửa D-012; điểm 2 sửa bởi D-029)
1. **Lỗi của công thức cũ.** `floor = max(snapshot.created_at, last_server_time) − 60s` lấy mốc theo **giờ server** rồi so với **giờ máy**. Máy chạy chậm hơn server quá 60s (pin CMOS yếu, NTP chưa chạy) bị `data_stale(clock_invalid)` ở mọi lần quẹt, kể cả khi online, trái với BR-012/D-012 ("lệch giờ chỉ cảnh báo, không chặn quẹt thẻ").
2. **Công thức mới.** `floor = last_sync_local_time − 60s`, với `last_sync_local_time` là giờ của chính máy lúc nhận snapshot mới hoặc gia hạn hợp lệ gần nhất, chỉ tiến. Vẫn phát hiện giờ máy bị lùi (pin CMOS chết về 1970, lùi giờ tay); lệch giờ so với server quay về đúng vai trò chỉ cảnh báo (`clock_skew_detected`). Hệ quả chấp nhận: NTP chỉnh lùi hơn 60s thì quẹt thẻ bị chặn tạm thời cho tới khi giờ thật vượt mốc sàn.
3. **Lease tính theo giờ máy, khớp BR-006.** Server gửi thời lượng `lease_duration_sec` (không gửi mốc `trusted_until` theo giờ server); Agent đặt `trusted_until = max(cũ, giờ máy lúc nhận + D)`.
4. **Chống phát lại lease.** Vì hạn tính từ lúc nhận, broker bị chiếm có thể phát lại một bản lease cũ để gia hạn mãi. Mỗi Hello/heartbeat mang một `lease_nonce` ngẫu nhiên mới; bản lease phải nhắc lại đúng một trong vài nonce gần nhất Agent đã gửi (nằm trong phần được ký HMAC) thì mới được nhận. Không phụ thuộc đồng hồ, không cần bộ đếm. Snapshot chỉ làm mới thời hạn khi có `version` mới, nên phát lại snapshot retained cũng không gia hạn được.
**Nguồn:** BR-006, BR-012, FR-056, XINV-007, D-012, ADR-001, ADR-002, lease-expiration.md; review 01–05.

### D-019: Các quy tắc quản trị chốt khi đặc tả API (08-api)
1. **Admin đặt tên máy khi duyệt.** `mqtt_identity` (ví dụ `ws-07`) do Admin nhập khi duyệt máy mới, không lấy từ hostname vì hostname trong image clone có thể trùng. "Duyệt tất cả" theo Zone sinh tên tuần tự theo tiền tố (`lab-a-01`, `lab-a-02`…) và bỏ qua yêu cầu có cờ trùng (D-014). Cài lại máy giữ nguyên tên cũ.
2. **Không vô hiệu hóa admin đang hoạt động cuối cùng**, để hệ thống không rơi vào trạng thái không còn ai quản trị (INV-016).
3. ~~Chỉ xóa được máy đã `disabled` và không còn Schedule tham chiếu (BR-017).~~ **Đã thay bằng D-024.1: không có thao tác xóa máy.** Vô hiệu hóa để chứng chỉ bị thu hồi; máy vẫn cho quẹt theo snapshot cục bộ tới khi lease hết (D-014.6).
4. **Kiểm tra lịch khi lưu chỉ cảnh báo, không chặn** các cấu hình có thể dẫn tới `ambiguous_profile` hoặc máy thiếu profile: chúng hợp lệ về dữ liệu, chỉ bị từ chối tại máy khi hai lịch cùng khớp một lúc (BR-016, D-009).
5. **UID thẻ không hiện trong danh sách**, chỉ hiện ở chi tiết thẻ và chi tiết nhật ký; tra cứu theo UID đi qua blind index (NFR-SEC03, ADR-007). Đăng ký thẻ được từ một bản ghi `unknown_card` mà không cần gõ lại UID (FR-073).
6. **Hai admin sửa cùng lúc thì bản lưu sau thắng**, không khóa bản ghi. Đủ cho MVP một vai trò với vài admin; mọi thay đổi đều sinh event dựng lại snapshot nên trạng thái cuối luôn được phân phối đúng (XINV-005).
7. **Cảnh báo an ninh từ máy** (`snapshot_signature_invalid`, `edge_db_recovered`, `key_version_mismatch`) lưu ở `workstation_alerts`, tách khỏi `audit_logs`, để giữ BR-007 "mỗi lần quẹt đúng một bản ghi".
**Nguồn:** [08-api/api.md](08-api/api.md), [08-api/events.md](08-api/events.md), INV-016, BR-016, BR-017, D-014.

### D-020: Ghi nhật ký thao tác của Admin
Mỗi thao tác ghi của Admin qua API (tạo/sửa/bật/tắt user, thẻ, nhóm, lịch, zone, profile; duyệt/từ chối đăng ký; vô hiệu hóa/xóa máy; tạo/vô hiệu hóa admin) được ghi vào `admin_audit_logs`: ai, lúc nào, hành động, đối tượng, giá trị trước/sau. Chỉ ghi thêm, ghi cùng giao dịch với thay đổi. Lý do: `audit_logs` chỉ ghi lần quẹt thẻ; nếu không có bảng này thì việc cấp thẻ hay sửa lịch trái phép không để lại dấu vết, và mối đe dọa "Admin dùng sai quyền" trong threat model không có biện pháp. Không chứa UID thô và mật khẩu.
**Nguồn:** [09-security/threat-model.md](09-security/threat-model.md), [11-operations/observability.md](11-operations/observability.md).

### D-021: Chặn đăng ký thẻ UID ngẫu nhiên; độ dài UID không bị giới hạn thêm
Hệ thống so khớp thẻ bằng UID (ADR-007) nên chỉ cần UID **tĩnh**; thẻ 4, 7, 10 byte dùng lẫn được (VR-007). Thẻ UID ngẫu nhiên (4 byte, byte đầu `08` theo ISO/IEC 14443-3; Spike S1 thấy ở CCCD) trước đây vẫn đăng ký được rồi bị từ chối `unknown_card` ở mọi lần quẹt sau mà Admin không rõ lý do. Từ nay `POST /cards` từ chối với `RANDOM_UID_NOT_SUPPORTED` (VR-013). Chỉ kiểm ở server khi đăng ký; Agent không đổi. Giới hạn: chỉ nhận diện được UID ngẫu nhiên theo đúng quy ước `08`; thẻ đổi UID theo cách khác vẫn rơi vào `unknown_card`.
**Nguồn:** [02-requirements/business-rules.md](02-requirements/business-rules.md) VR-013, [08-api/api.md](08-api/api.md), S1.

### D-022: Tắt hoặc bỏ profile mặc định của máy không bị chặn, chỉ cảnh báo
Admin được tắt profile đang là mặc định, hoặc để máy không có profile mặc định (`PATCH /workstations/{id}/profiles/{os_username}`); server không trả 409. Hệ quả (Schedule không chỉ định `target_os_username` bị từ chối tại máy đó) hiện qua cờ `missing_profile` trên danh sách máy. Lý do:
1. Trạng thái "máy không có profile mặc định dùng được" vẫn xảy ra dù server có chặn (máy mới đăng ký chưa báo profile, image thiếu tài khoản, profile biến mất trên máy), nên cờ `missing_profile` đằng nào cũng là cơ chế chính.
2. Nhất quán với D-019.4: cấu hình dẫn tới máy thiếu profile là hợp lệ về dữ liệu, chỉ cảnh báo.
3. Không phải tự khóa: Agent đồng bộ snapshot độc lập với đăng nhập nên bật lại trên Dashboard là máy nhận cấu hình mới; kỹ thuật viên vẫn vào bằng mật khẩu.
4. Có nhu cầu thật: ngừng cho quẹt thẻ vào một máy có tài khoản dùng chung bị hỏng mà không phải tắt lịch của cả zone.

Yêu cầu cho Dashboard (M4): profile mặc định là nút chọn một (không bỏ chọn được); tắt profile đang là mặc định phải qua hộp xác nhận nêu rõ hệ quả.
**Nguồn:** [08-api/api.md](08-api/api.md) "Zone và Máy trạm", FR-007, D-009, D-019.

### D-033: Rà soát tính thực tế trước M4: gia hạn phiên bằng quẹt lại, nhập danh sách hàng loạt, phạm vi còn lại của M4
Rà soát toàn dự án ở tầng nghiệp vụ (2026-11-18): đi qua một học kỳ vận hành của bối cảnh pilot để tìm chỗ thiết kế không khớp cách vận hành thật, cùng kiểu với lần bỏ mô hình tài khoản Linux riêng cho từng người (D-006). Nguyên tắc chung: **mã nguồn chỉ mang khái niệm trung lập** (user, nhóm, zone, lịch, máy dùng chung); điều đặc thù của trường học (lớp, buổi thi, ngày lễ, thẻ sinh viên) chỉ nằm trong kịch bản vận hành pilot, không thành tính năng.

1. **Gia hạn phiên đang chạy bằng cách quẹt lại (sửa BR-008a, BR-009; làm rõ BR-010).** Trước đây hạn phiên tính một lần lúc quyết định; người dùng cần thêm giờ (buổi làm việc kéo dài, Admin đã sửa lịch) thì quẹt lại chỉ nhận `noop(already_active)` với hạn cũ và bị đăng xuất cưỡng bức đúng hạn cũ, mất việc chưa lưu. Nay khi chính user đang có phiên quẹt lại (CR-001 bước 8a) và thẻ đã qua bước 1–6 trên snapshot hiện tại:
   - Agent tính lại hạn theo bước 7 nhưng chỉ trên các Schedule khớp cùng profile với phiên đang chạy, và mức trần hạn phiên tối đa tính từ **lúc phiên được quyết định**, không từ lần quẹt này (quẹt nhiều lần không đẩy trần ra mãi). Profile đích ở bước 6 khác profile của phiên thì không gia hạn.
   - Chỉ kéo dài, không bao giờ rút ngắn: hạn mới lớn hơn hạn cũ thì nhận, ngược lại giữ nguyên.
   - Chỉ áp dụng khi phiên `active`, Desktop còn sống và chưa chạm hạn (cả UTC lẫn `CLOCK_BOOTTIME`). Phiên đã hết hạn thì giữ luồng cũ (dọn rồi `granted` một phiên mới).
   - Hạn đo `CLOCK_BOOTTIME` cộng thêm đúng phần UTC được kéo dài, không dựng lại từ giờ hệ thống (giờ máy vừa được chỉnh không được cấp thêm thời lượng).
   - Kết quả vẫn là `noop(already_active)` (BR-007 không đổi: đúng một bản ghi cho lần quẹt). Có gia hạn thì cùng giao dịch ghi hạn mới vào LocalSession và phát sự kiện `session_extended` (`session_id`, `decision_entry_id`, hạn cũ, hạn mới) vào outbox; Server cập nhật hạn của Session để Dashboard và cờ quá hạn đúng. Định dạng nằm ở `contracts/` (`outbox-v1` thêm loại sự kiện; Edge và Server nâng cấp cùng lúc như D-030.3).
   - Cảnh báo trước hạn được đặt lại theo hạn mới; thông báo D-Bus nêu rõ hạn mới (hoặc hạn hiện tại nếu không gia hạn được).
   - Nhận snapshot mới vẫn không tự đổi phiên đang chạy (BR-010): lịch bị rút ngắn hay tắt không cắt phiên, lịch kéo dài chỉ có tác dụng khi người dùng quẹt lại. Quy trình: Admin sửa lịch → kiểm tra máy đã nhận bản mới → người dùng quẹt lại trước hạn cũ. Gia hạn làm máy bận lâu hơn; tranh chấp với lượt kế tiếp do người vận hành xử lý, hệ thống không phân xử.
   - Không chọn tự gia hạn khi nhận snapshot: mọi lần sửa lịch sẽ tác động lên mọi phiên đang chạy mà không ai chủ động yêu cầu.
2. **Nhập user và nhóm hàng loạt từ CSV vào MVP (FR-034; trước là Extension).** Một tổ chức có hàng trăm đến hàng nghìn người dùng mỗi kỳ; tạo từng người trên Dashboard là không làm được. Cột trung lập: `external_id`, `full_name`, `email`, `groups` (tên nhóm, ngăn bằng `;`), `card_uid` (tùy chọn). Quy tắc:
   - Có bước chạy thử trả kết quả từng dòng (tạo / cập nhật / không đổi / lỗi) trước khi áp dụng. Áp dụng là tất cả hoặc không: còn dòng lỗi thì không ghi gì.
   - Chạy lại cùng tệp không tạo trùng (khóa là `external_id`). Nhóm chưa có thì tạo. Thành viên nhóm chỉ thêm, không bớt (dọn danh sách cũ là thao tác riêng của Admin).
   - Thẻ: UID mới hoặc đang `unbound` thì gắn; đã gắn đúng user đó thì không đổi; đang thuộc user khác thì báo lỗi dòng, không bao giờ chuyển chủ thẻ ngầm. VR-007, VR-013 áp dụng như đăng ký từng thẻ.
   - User `inactive` có trong tệp không tự kích hoạt lại (chỉ cảnh báo).
   - Ghi một mục `admin_audit_logs` cho mỗi lần áp dụng; event Identity vào `server_outbox` cùng giao dịch như thao tác lẻ (D-023).
   - Thực hiện ở Server (endpoint) cộng một trang tải tệp trên Dashboard, vì Admin vận hành qua Dashboard, không qua shell của máy chủ.
3. **Phản hồi khi máy đang bận (sửa FR-013).** Người khác quẹt lúc Desktop đang mở thì Greeter không hiển thị, nên `workstation_busy` không có phản hồi nào. Nay Agent gửi thông báo D-Bus lên Desktop đang mở ("máy đang có người dùng"), cùng kênh với thông báo `noop`. LED/còi của đầu đọc không bắt buộc vì phụ thuộc từng loại đầu đọc.
4. **Phạm vi còn lại của M4.** API đã đủ nhưng Dashboard mới có Đăng nhập và Máy trạm, nên Admin chưa tự vận hành được. M4 phải có: Identity (user, nhóm, thẻ, gắn thẻ từ bản ghi `unknown_card`), nhập CSV, Provisioning (zone, duyệt đăng ký / cài lại, profile), Lịch (CRUD, kiểm tra, cảnh báo; nói rõ các lịch cộng quyền và nối chuỗi), Lịch sử (nhật ký, phiên, bản ghi bị từ chối khi ingest). Trang Máy trạm hiển thị thêm trạng thái lease và thời điểm heartbeat cuối: `in_sync` không cho biết lease còn hạn (máy tắt cả cuối tuần).
5. **Tham số vận hành.** Thời lượng lease, thời gian cảnh báo và hạn phiên tối đa hiện là hằng số trong mã Server (`SNAPSHOT_PARAMETERS`); đổi phải sửa mã và triển khai lại. Tài liệu sửa theo đúng thực tế; không làm trang Settings ở MVP.
6. **Chỉ ghi vào kịch bản vận hành pilot (M5), không thêm tính năng:** quên thẻ (gắn tạm thẻ mượn cho đúng user đó rồi gỡ, không tạo user "khách" dùng chung, đợi máy nhận snapshot); người dùng bỏ đi không đăng xuất (máy bận tới hết phiên; nhật ký xác định người mở phiên, không chứng minh người đang ngồi); mở lịch sớm chỉ khi phòng trống, không thành quy tắc chung (hai lịch chồng nhau cộng quyền và có thể nối dài phiên); lịch là hợp quyền nên lịch mới không ghi đè lịch cũ, buổi đặc biệt (thi) phải tắt lịch thường chồng giờ; ngày nghỉ, buổi bù (`valid_from = valid_to`), cuối kỳ dọn thành viên nhóm và đặt `valid_to`; người hướng dẫn là user thường có lịch riêng; người dùng mới được cấp quyền chỉ vào được máy đã nhận snapshot mới (giới hạn của mô hình edge thuần).
7. **Giả định lưu trữ bền trên máy trạm.** Agent cần `/var/lib/nfc-agent`, `/etc/nfc-agent` và `/etc/machine-id` giữ qua khởi động lại. Cơ chế phục hồi ổ đĩa mỗi lần khởi động phải chừa các đường dẫn này; nếu không, máy mất định danh hoặc mất nhật ký chưa gửi. Gói M5 ghi rõ yêu cầu này.
8. **Đóng băng tính năng bảo mật mới.** Cơ chế đồng hồ, lease, nonce, ký outbox, CRL đã ở mức trần cho ~40 máy và đều gắn với lỗi thật tìm ra ở E2E hoặc review; giữ nguyên. Từ nay không thêm tính năng bảo mật mới; lỗi làm quyết định sai hoặc khóa máy vẫn sửa. Mã hóa UID được trình bày là bảo vệ quyền riêng tư dữ liệu (D-013), không phải chống sao chép thẻ.
9. **Không làm:** cơ chế ngày ngoại lệ / ngày nghỉ trong lịch (ngày đóng cửa thừa một khung được phép không gây hại, còn sửa thì chạm contracts và Edge); tự gia hạn khi nhận snapshot; điều khiển LED đầu đọc; trang Settings; gỡ các cơ chế bảo mật đã làm.
**Nguồn:** rà soát nghiệp vụ 2026-11-18 (Claude + Codex), `edge/nfc_agent/domain/evaluation.py` (nhánh `noop`), `server/src/distribution/snapshot-content.ts` (`SNAPSHOT_PARAMETERS`), `dashboard/src/main.tsx` (các route hiện có).

### D-032: Hello bằng khóa cũ không làm mất hiệu lực mã tải credential mới (làm rõ D-014.4)
Sau khi Admin duyệt cài lại, `key_version` tăng nhưng kết nối cũ của máy (chứng chỉ cũ) còn sống tới khi broker khởi động lại. Một Hello đi qua kết nối đó trong khoảng ấy từng làm mất hiệu lực `fetch_code` mới; máy cài lại không tải được credential, rơi vào `enroll-stopped` và cần kỹ thuật viên chạy lại `reenroll`. Nay server chỉ vô hiệu hóa `fetch_code` khi Hello báo đúng `key_version` hiện tại; Hello khác `key_version` chỉ ghi cảnh báo. Đây là kiểm tra nhất quán, không phải bằng chứng mật mã: máy cố ý khai sai `key_version` vẫn không lấy được gì vì `fetch_code` chỉ tải được qua HTTPS. Thử lại `BROKER_RESTART_CMD` khi thất bại để sau (hiện chỉ ghi log, CRL hằng ngày và lần khởi động broker kế tiếp vẫn áp dụng thu hồi).
**Nguồn:** D-014.4, D-024, [08-api/api.md](08-api/api.md) đăng ký máy; review dự án 2026-11-17 (Codex).

### D-031: Dừng Agent không kết thúc phiên; khôi phục luôn dọn desktop không ai theo dõi (làm rõ D-017)
1. **Dừng Agent (SIGTERM) không đóng phiên.** Trước đây SIGTERM đóng phiên đang chạy thành `abandoned(workstation_rebooted, reported)`. Nhưng SIGTERM cũng đến khi chỉ khởi động lại dịch vụ (nâng cấp gói, `nfc-agent reenroll`): desktop vẫn chạy, Agent mới không còn phiên nào để theo dõi, coi desktop là mồ côi và đăng xuất sinh viên giữa ca; server nhận kết thúc `reported` nên không sửa được. Nay Agent chỉ ghi `last_alive_at` lúc dừng. Cùng `boot_id` thì lần khởi động sau tiếp tục theo dõi phiên; khác `boot_id` thì phiên đóng `abandoned(workstation_rebooted, reconstructed)` với `ended_at = max(started_at, last_alive_at)` = lúc Agent dừng. Signal handler chỉ đặt cờ dừng, việc ghi đĩa chạy sau khi vòng lặp xử lý thoát (ghi trong handler có thể chen giữa một giao dịch SQLite đang mở).
2. **Khôi phục luôn đối chiếu desktop không ai theo dõi.** Vòng dọn phiên OS không có LocalSession (D-017) chạy ở mọi lần khởi động, kể cả khi `edge.db` không có liveness (`edge.db` vừa dựng lại trong lúc desktop đang chạy). Lỗi cũ: trường hợp đó bị coi là reboot và vòng dọn bị bỏ qua, desktop chạy không có hạn giờ.
3. **Dọn thất bại thì thử lại, nhưng chỉ đúng desktop đó.** Agent nhớ mã phiên logind của desktop mồ côi và thử teardown lại mỗi nhịp theo dõi; nếu desktop đó đã mất, hoặc profile đang chạy một phiên khác (ví dụ phiên mới vừa được cấp quyền), thì bỏ, không bao giờ đụng tới phiên mới.
Bằng chứng: test đơn vị Edge; E2E restart dịch vụ trên vm2 (2026-11-17).
**Nguồn:** D-017, ADR-008, [swipe-login.md](05-behavior/sequences/swipe-login.md) "Recovery khi Agent khởi động lại", [reboot.md](05-behavior/sequences/reboot.md); review dự án 2026-11-17 (Codex).

### D-030: Lô outbox do máy ký, ACK chỉ xóa đúng lô nó nêu tên (sửa D-026, threat model N6)
1. **Lô outbox mang chữ ký của máy.** Edge ký mỗi lô bằng `K_m`: `hex(HMAC-SHA256(K_m, "outbox-v1:" ‖ byte của lô))`, gửi trong user property MQTT 5 `signature`, giống chiều xuống. Server kiểm chữ ký với `key_version` hiện tại của máy trước khi đọc lô; thiếu hoặc sai thì bỏ qua, không lưu gì, không ACK. Lỗi cũ: broker bị chiếm gửi một khung `outbox` giả (`records: []`, `to_seq` rất lớn) lên topic của máy, server không lưu gì nhưng vẫn ký ACK hợp lệ, Edge xóa nhật ký chưa từng lên server. HMAC trên ACK không bảo vệ được gì vì chính server ký giúp. Kiểm từng mục vẫn theo D-026 (savepoint, mục lỗi vào `ingest_rejects`); chỉ khung lô được kiểm cứng.
2. **`batch_id` ngẫu nhiên, ACK nhắc lại.** `batch_id` là 16 byte ngẫu nhiên (hex), mới cho mỗi lần gửi, kể cả gửi lại. `ack-v1` thêm trường bắt buộc `batch_id`. Edge chỉ nhận ACK có `batch_id` trùng lô đang chờ, và chỉ xóa tới `min(acked_seq, to_seq của lô đó)`. ACK đến muộn, phát lại, hay của lần gửi trước khi mất kết nối đều không xóa gì. Điều này cũng đóng lỗ còn lại của D-028.3: khi không cứu được mốc `outbox_seq` từ `edge.db` hỏng, số thứ tự bắt đầu lại từ 1 nhưng một ACK cũ còn xếp hàng ở broker không còn khớp lô nào.
3. **Giới hạn.** Chỉ chiều outbox có toàn vẹn độc lập với broker; Hello/heartbeat vẫn chỉ dựa vào mTLS + ACL (broker bị chiếm có thể báo sai trạng thái máy, không xóa hay giả được nhật ký). `ack-v1` đổi định dạng mà không tăng phiên bản vì chưa có máy nào chạy thật ngoài môi trường dev; Edge và Server phải nâng cấp cùng lúc.
**Nguồn:** D-015, D-026, D-028.3, [09-security/threat-model.md](09-security/threat-model.md), [10-failure/failure-model.md](10-failure/failure-model.md) N6, `contracts/` (`outbox-v1`, `ack-v1`).

### D-029: Máy có giờ từng chạy nhanh tự hồi phục khi online; bộ hẹn giờ đồng bộ dùng đồng hồ đơn điệu (sửa D-018)
1. **Lỗi của D-018.2.** Mốc sàn `last_sync_local_time` chỉ tiến. Máy đồng bộ lúc RTC đang chạy nhanh (ví dụ +3 ngày sau khi cài image, NTP chưa chạy) rồi được NTP chỉnh lùi thì mọi lần quẹt bị từ chối `data_stale(clock_invalid)` khoảng 3 ngày, **kể cả khi online**, vì lease và snapshot đều lấy `max`. "Chặn tạm thời" của D-018.2 không có giới hạn thời gian.
2. **Neo lại theo lease mới.** Một lease qua đủ các kiểm tra của D-018.4/D-028.2 (chữ ký, đúng máy, đúng version, nonce của chính máy chưa dùng), mà nonce được sinh không quá `NONCE_MAX_AGE = 120 s` trước (đồng hồ đơn điệu) và `server_time` lệch giờ máy không quá 60 s, trong lúc giờ máy nhỏ hơn mốc sàn, thì đặt lại `trusted_until = giờ máy + D` và `last_sync_local_time = giờ máy`, ghi xuống đĩa ngay. Các trường hợp khác giữ nguyên quy tắc chỉ tiến. Snapshot không bao giờ hạ mốc sàn. Vẫn phát hiện được giờ máy bị lùi khi offline (pin CMOS chết); chỉ khi server xác nhận giờ máy đã đúng thì mốc mới được hạ.
3. **Bộ hẹn giờ dùng đồng hồ đơn điệu.** Nhịp heartbeat, thời gian chờ ACK và tuổi nonce đo bằng `time.monotonic`. Lỗi cũ: sau khi giờ máy lùi 3 ngày, `now − last_heartbeat` âm nên máy không gửi heartbeat trong 3 ngày dù vẫn kết nối.
**Nguồn:** D-012, D-018, D-028.2, [lease-expiration.md](05-behavior/sequences/lease-expiration.md), [10-failure/failure-model.md](10-failure/failure-model.md) E7; review dự án 2026-11-17 (Claude + Codex).

### D-028: Sửa ba lỗ của Edge tìm ra khi review chéo bằng Codex (sau M3)
1. **Lượt quẹt trong lúc một đăng nhập đang diễn ra không được làm mồ côi đăng nhập đó** (làm rõ D-027.6). "Đang đăng nhập" là phiên `pending` mà PAM đã dùng quyền: `AuthGate` nhớ mục đã giao cho PAM và trả nó ra ngay trong lúc thu hồi quyền chưa dùng (cùng một khóa). Trước khi đánh giá, Agent đối chiếu phiên trước; nếu vẫn đang đăng nhập thì CR-001 bước 8 coi phiên đó là phiên hiện tại còn sống: cùng người dùng thì `noop(already_active)`, người khác thì `workstation_busy`. Chỉ quyền PAM chưa dùng mới bị lượt quẹt mới thay (D-027.6 giữ nguyên). Desktop lên sau khi khung giờ đã hết vẫn được nhận phiên rồi đăng xuất đúng hạn (session-expiry EF-5), không bị bỏ mà không báo; teardown kẹt thì giữ phiên `pending` (INV-017). Lỗi cũ: lượt quẹt thứ hai trong khoảng ~1 s giữa lúc PAM dùng quyền và nhịp theo dõi phiên xóa phiên đang lên, desktop chạy không có hạn giờ.
2. **Nonce của lease chỉ dùng một lần và mất theo kết nối** (làm rõ D-018.4). Danh sách nonce bị xóa khi mất kết nối và trước Hello lúc kết nối lại; lease được nhận thì nonce của nó bị bỏ. Lỗi cũ: trong lúc mất kết nối không sinh nonce mới nên nonce cũ còn hiệu lực mãi; broker bị chiếm có thể cắt máy cho lease hết hạn rồi phát lại lease cũ ngay sau khi nối lại để gia hạn thêm 24 h mà không cần Server.
3. **Phục hồi `edge.db` giữ số thứ tự outbox** (làm rõ D-017.2). Mục cứu được chèn lại với `outbox_seq` gốc, và `sqlite_sequence` của `audit_outbox` được đặt tối thiểu bằng mốc cao nhất của tệp hỏng (kể cả khi outbox cũ đã trống), trước khi ghi cảnh báo `edge_db_recovered`. Lỗi cũ: đánh số lại từ 1, nên một ACK cũ còn xếp hàng ở broker (phiên MQTT `clean_start=False`) hoặc ACK lặp của lô gửi lại xóa mất mục chưa gửi và chính cảnh báo phục hồi.

Bằng chứng: test đơn vị Edge (150 passed); chưa chạy lại E2E trên vm2. Cả ba lỗi do Codex review tìm ra trên code đã qua review và E2E M3.
**Nguồn:** D-017, D-018, D-027, ADR-008, [session-expiry.md](05-behavior/sequences/session-expiry.md), [09-security](09-security/).

### D-027: Agent tự đăng ký, đồng bộ MQTT và kết quả E2E của M3 (M3.4–M3.6)
1. **Đăng ký chặn khởi động Agent** khi chưa có định danh và có `[server] url`: máy chưa có `K_m` thì không làm được gì khác; trong lúc chờ duyệt, PAM và greeter rơi về mật khẩu (BR-004). Khóa riêng và yêu cầu đang chờ (`request_id`, `fetch_code`) được giữ trên đĩa, khởi động lại thì tiếp tục đúng yêu cầu đó.
2. **Bị từ chối thì đứng chờ, không thoát:** Agent ghi tệp `enroll-stopped` và ngủ. Thoát sẽ làm systemd khởi động lại mỗi giây và mỗi lần gửi một yêu cầu mới. `nfc-agent reenroll` xóa tệp này.
3. **Kiểm chứng chỉ trước khi nhận**: CN phải đúng tên được duyệt và khóa công khai phải là khóa của máy; sai thì không ghi `identity/`. `identity/` (tên, `key_version`, `K_m`, địa chỉ broker, `client.key`, `client.crt`) được ghi vào thư mục tạm rồi đổi tên một lần (D-017).
4. **Lease ghi xuống đĩa khi `trusted_until` tiến ≥ 5 phút** (ADR-003 §5); đánh giá quẹt thẻ đọc giá trị trên đĩa nên có thể chậm tối đa 5 phút, chỉ theo hướng chặt hơn.
5. **Một lô outbox chờ ACK tại một thời điểm**; không có ACK sau 60s, hoặc sau khi kết nối lại, thì gửi lại lô đó (Server loại trùng).
6. **Lần quẹt được cho vào thay quyền chưa dùng** (swipe-login EF-9b). Lỗi tìm thấy ở E2E: chạm thẻ hai lần trước khi PAM dùng quyền thì lần hai lỗi ràng buộc "một `pending`" và mất bản ghi nhật ký, vi phạm BR-007. Đã sửa: `pending` cũ chuyển `discarded` trong cùng giao dịch.
7. **Snapshot mang `key_version` khác là `key_version_mismatch`, không phải cảnh báo** (xét trước chữ ký). Lỗi tìm thấy ở E2E: khi duyệt cài lại, Server khởi động lại broker để thu hồi chứng chỉ; snapshot mới được cấp đúng lúc broker khởi động lại nên không gửi được, broker lên lại vẫn giữ snapshot retained ký bằng khóa cũ, và Agent đã có khóa mới ghi một `snapshot_signature_invalid` giả. Hello ngay sau đó vẫn tự sửa.
8. **Giới hạn đã chấp nhận:** paho tự nối lại 1s → 60s nhưng không có jitter của ADR-002 §6 (đủ cho ~40 máy); khi tắt máy có kế hoạch Agent không chờ 5s đẩy outbox, phần còn lại gửi sau lần khởi động tới.

**Bằng chứng E2E (2026-11-16, vm2 Ubuntu 22.04, Python 3.10, cryptography 3.4.8, paho 2.2.0; Server dev + Mosquitto `2.0.18-openssl` trên host):** Agent không có định danh tự gửi yêu cầu (hostname, MAC, `machine_id` thật của vm2), Admin duyệt thành `e2e-ws-01`, Agent nhận chứng chỉ, kết nối mTLS; snapshot đầu bị từ chối `older_version` vì `edge.db` còn version dev cũ, Server thấy Hello báo version đó và cấp version lớn hơn (D-016), máy về `online / in_sync / Fresh`; quẹt thẻ cho vào, `unknown_card`, `noop(already_active)` lên `audit_logs` đúng; bản ghi M1 cũ tham chiếu user không có ở Server vào `ingest_rejects` mà không chặn lô (D-015); đổi lịch thì khoảng 2s sau máy nạp snapshot mới; tắt broker hơn 2 phút: máy vẫn quyết định cục bộ, Server đánh `offline`, bật lại thì tự kết nối và outbox về 0; vô hiệu hóa máy: serial vào CRL, broker khởi động lại, máy bị từ chối kết nối nhưng vẫn quyết định cục bộ (D-014.6); `nfc-agent reenroll` + duyệt cài lại: `key_version` 2 rồi 3, máy kết nối lại. Chưa phủ: thẻ thật trên đầu đọc thật (S1), phiên hết giờ và teardown qua đồng bộ, nhiều máy cùng lúc.
**Nguồn:** ADR-002 §2–§7, D-014, D-016, D-017, D-018, [08-api/events.md](08-api/events.md) §4.1, [swipe-login.md](05-behavior/sequences/swipe-login.md).

### D-026: Nhận nhật ký từ máy và API đọc lịch sử (M3.3)
1. **ACK luôn tới `to_seq` khi lô tin được**, kể cả khi mọi mục đều lỗi; chỉ không ACK khi chính lô không tin được (không phải JSON, thiếu trường khung, sai định danh, máy lạ). Một mục lỗi không bao giờ làm kẹt hàng đợi của máy (D-015.2).
2. **Phiên kết thúc suy luận sau reboot:** máy ở `Draining` quá 5 phút thì mọi phiên `active` của lần khởi động cũ thành `abandoned` / `workstation_rebooted` / `inferred`, `ended_at = max(started_at, min(expires_at, lúc Server thấy boot mới))`. Server không biết chính xác lúc máy tắt nên đây là cận trên hợp lý: phiên không thể kéo dài quá hạn của nó, cũng không thể sau lúc máy đã khởi động lại. Báo cáo thật đến sau vẫn thay được một lần. Chưa dùng `pending_outbox_count = 0` trong Hello để kết thúc chờ sớm.
3. **`ingest_rejects` không chứa UID thô** (sửa chỗ mâu thuẫn giữa D-015 "giữ nguyên văn" và NFR-SEC03): `card_uid` thành `"[redacted]"` kèm blind index để vẫn tra theo thẻ.
4. **Lọc nhật ký theo ảnh chụp lúc ghi** (`workstation_snapshot`, `user_snapshot`), không theo dữ liệu hiện tại: đổi tên, đổi zone sau đó không viết lại lịch sử.
5. **Phân trang keyset** theo `(thời gian, id)` giảm dần, con trỏ giữ thời gian tới micro giây.

Giới hạn: chưa kiểm với Agent thật gửi outbox (M3.6).
**Nguồn:** [08-api/events.md](08-api/events.md) §3.3, [08-api/api.md](08-api/api.md), D-015, XINV-006, XINV-008, INV-007, NFR-SEC03.

### D-025: Cổng MQTT phía Server và quy tắc trả lời Hello / heartbeat (M3.2)
1. **Server kiểm bản tin nhận được bằng chính `contracts/schemas` lúc chạy** (Ajv), không viết lại luật ở mã nguồn; `contracts/` là nguồn sự thật thật sự cho cả hai phía.
2. **`acked_version` lưu đúng giá trị máy báo, không lấy max.** Máy dựng lại `edge.db` báo version 0 phải được gửi lại snapshot; nếu giữ max thì Server tưởng máy đã đồng bộ và chỉ gửi lease (máy sẽ từ chối vì version không khớp).
3. **Gửi lại snapshot có giới hạn:** heartbeat lệch version tối đa 1 lần/60s mỗi máy (máy đang từ chối snapshot sẽ không bị dội bản 1 MB mỗi 30s); Hello luôn được trả lời.
4. **Không xếp hàng bản tin khi broker đứt.** Snapshot là retained và Hello tự sửa lệch; lease chỉ có giá trị tức thời.
5. **Profile do máy báo chỉ được thêm, không bị xóa hay đổi cờ**: cờ bật/tắt, mặc định là quyết định của Admin (D-022).
6. **Broker phải liên kết OpenSSL.** Image `eclipse-mosquitto:2.0.18` mặc định liên kết LibreSSL 3.7 và không yêu cầu thuật toán chữ ký Ed25519 khi bắt tay mTLS, nên chứng chỉ máy trạm Ed25519 không dùng được (broker báo "peer did not return a certificate"). Dev đổi sang `eclipse-mosquitto:2.0.18-openssl`; production dùng Mosquitto của Ubuntu (OpenSSL), đã kiểm ở S8.

Bằng chứng: test tích hợp với Mosquitto dev (2026-11-16): Server kết nối bằng chứng chỉ `nfc-server`, máy trạm giả `ws-dev-01` (Ed25519) gửi Hello và nhận snapshot retained có chữ ký đúng, gửi heartbeat và nhận lease có chữ ký đúng. Giới hạn: chưa nhận outbox (M3.3); chưa kiểm với Agent thật (M3.6).
**Nguồn:** [08-api/events.md](08-api/events.md) §4, ADR-002 §1–§4, D-014, D-016, D-018, S8.

### D-024: Các quy tắc chốt khi hiện thực đăng ký máy và thu hồi chứng chỉ (M3.1)
1. **Không có thao tác xóa máy (sửa D-019.3).** Mọi máy đã vô hiệu hóa đều có dòng trong `revoked_certificates` (phải nằm trong CRL mãi) và thường có nhật ký, phiên tham chiếu tới nó; các bảng đó không cho xóa (nhật ký append-only), nên `DELETE /workstations/{id}` luôn thất bại. `disabled` là trạng thái cuối; máy vẫn nằm trong CSDL để giữ lịch sử, Dashboard mặc định ẩn máy `disabled`. Bình chốt 2026-11-15.
2. **Thu hồi chứng chỉ chạy trực tiếp, không qua `server_outbox`.** Sau khi giao dịch vô hiệu hóa hoặc duyệt cài lại commit, Server ghi lại tệp CRL rồi chạy lệnh khởi động lại broker (`BROKER_RESTART_CMD`). Lệnh rỗng hoặc lỗi không làm hỏng thao tác: thu hồi đã lưu, CRL đã ghi, log cảnh báo; lưới an toàn là sinh lại CRL lúc khởi động và hằng ngày (D-014.5). Không phát event `WorkstationDisabled`, vì worker outbox chỉ dựng snapshot.
3. **Cùng máy, cùng khóa gửi lại yêu cầu thì thay yêu cầu cũ đang chờ** (cũ chuyển `rejected`), không gắn cờ trùng: cùng khóa công khai chứng tỏ cùng một máy đang thử lại sau khi mất gói trả lời, và Admin không phải dọn tay yêu cầu lặp.
4. **Duyệt cài lại vô hiệu hóa mọi `fetch_code` cũ của máy đó.** `K_m` được dẫn xuất theo `key_version` hiện tại lúc trả lời, nên mã cũ còn hiệu lực sẽ tải được `K_m` mới.
5. **Duyệt hàng loạt đặt tên `<prefix><NN>`** nối tiếp số lớn nhất đã dùng; mỗi yêu cầu một giao dịch riêng; mọi yêu cầu có cờ đều bị bỏ qua.
6. **Server là CA.** Khóa CA là EC P-256 (`CA_CERT_FILE`, `CA_KEY_FILE`); chứng chỉ máy 3 năm, serial ngẫu nhiên 128 bit; CRL hạn 10 năm, ghi tệp tạm rồi đổi tên. Thư viện `@peculiar/x509` 1.14.3 (bản 3.x chỉ có ESM, không chạy với jest CJS); CRL phải mang nhãn PEM `X509 CRL` thì OpenSSL và Mosquitto mới đọc.

Giới hạn: `fetch_code` chưa bị vô hiệu hóa bởi Hello đầu tiên (M3.2); khởi động lại broker thật chưa được kiểm (M3.6).
**Nguồn:** [08-api/api.md](08-api/api.md), ADR-002 §7, D-014, D-019, S8, S9.

### D-023: Phạm vi nội dung snapshot, cách cấp version và worker dựng snapshot
1. **Nội dung tối thiểu theo máy** (INV-012): chỉ Schedule đang bật của máy hoặc zone của máy; user là subject trực tiếp hoặc qua nhóm subject (kể cả `inactive`); thẻ `active`/`disabled` của các user đó; mọi profile của máy. `group_ids` của user chỉ gồm nhóm là subject trong chính snapshot đó, để máy không biết các nhóm không liên quan.
2. **Chuẩn tắc và hash:** thứ tự khóa và thứ tự mảng cố định; `content_hash` không gồm `version` và `created_at`. Version chỉ tăng khi hash khác bản mới nhất.
3. **Cấp version:** `max(version mới nhất đã lưu, desired_version, acked_version) + 1`. Máy báo version lớn hơn mọi bản server đang giữ (server khôi phục từ bản sao lưu cũ, D-016) thì được cấp bản mới dù nội dung không đổi. Máy `enrolled` chưa có snapshot luôn nhận v1, kể cả nội dung rỗng, để thoát `NoData`.
4. **Reconcile theo mức:** có event thì reconcile mọi máy `enrolled`, cộng thêm lúc khởi động và mỗi giờ; chưa thu hẹp theo payload event (đủ cho ~40 máy). Lỗi dựng của một máy không chặn máy khác và không giữ event lại.
5. **`master_key` là tệp** `KEYS_DIR/km-master.key`, cùng cơ chế với khóa UID.

Giới hạn: M2.5 mới dựng, ký và lưu snapshot; chưa publish MQTT, chưa cập nhật `acked_version` (M3). Đã kiểm chéo một snapshot do Server dựng với mã thật của Agent (kiểm chữ ký, nạp vào `edge.db`, đánh giá quẹt thẻ) bằng script chạy tay, chưa thành test tự động trong CI.
**Nguồn:** [08-api/events.md](08-api/events.md) §4.1, §5, [schedule-sync.md](05-behavior/sequences/schedule-sync.md), [11-operations/deployment.md](11-operations/deployment.md), INV-011, INV-012, D-016.

### ADR-001 (Accepted): Xác thực ở edge, dữ liệu cục bộ có thời hạn tin cậy (lease)
Quy định ở Agent theo CR-001 từ snapshot cục bộ, không hỏi server khi quẹt thẻ. Dữ liệu cục bộ có thời hạn tin cậy (lease) được gia hạn qua phản hồi heartbeat khi `acked_version == desired_version`. Kiểm tra đồng hồ kết hợp hai hạn (UTC tuyệt đối bền vững và `CLOCK_BOOTTIME` cho phiên) kèm mốc sàn cải tiến `floor = last_sync_local_time - CLOCK_FLOOR_TOLERANCE`. Đã chốt: `D = 24h`; tin RTC sau khi khởi động lại lúc offline nếu `local_time >= floor` (D-018).
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

### ADR-005 (Accepted): Kiến trúc PAM module C, Lab Custom Greeter và cơ chế khôi phục
Chốt chuyển sang Display Manager LightDM. Module PAM viết bằng C thuần (`pam_nfc.so`), giao tiếp IPC không khóa qua Unix socket `/run/nfc-agent.sock` với fallback tức thì 22ms về mật khẩu cục bộ khi Agent treo/chết (BR-004, NFR-M01), bảo vệ cấp nhân bằng `SO_PEERCRED`. Xây dựng Lab Custom Greeter bằng Python GTK3 nhận tín hiệu đẩy qua `/run/nfc/greeter-push.sock` để đăng nhập 0-chạm (< 1.0s), loại trừ lỗi bấm login 2 lần. Áp dụng Startup Handshake 1.2s, bộ mã DenyReason đồng bộ và launcher wrapper script tự động fallback về GTK greeter sau 3 crash liên tiếp. Spike S10 xác nhận wrapper trong vòng boot LightDM thật, sau khi chuyển tệp đếm crash từ `/run` (greeter user `lightdm` không ghi được, gây tự khóa màn hình đen) sang `/var/lib/lightdm`; ngưỡng 3 crash phải nhỏ hơn giới hạn khởi động lại của systemd.
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
