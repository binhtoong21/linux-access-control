# 📏 business-rules.md

## Quy ước
BR-XXX là quy tắc nghiệp vụ bất biến, độc lập công nghệ. Cột "Cũ" là mã rule trước khi làm lại, để truy vết.

## Rules
| ID | Rule | Mô tả | Cũ |
|----|------|-------|----|
| BR-001 | Cho vào khi có Schedule khớp | Cho đăng nhập khi thẻ `active`, user `active` và tồn tại ít nhất một Schedule `enabled` khớp: ai (user hoặc nhóm chứa user) + ở đâu (máy hoặc zone chứa máy) + khi nào (thời điểm hiện tại nằm trong khung giờ). Không khớp thì từ chối | BR-001 |
| BR-002 | Thẻ `disabled` hoặc `unbound` bị từ chối tuyệt đối | Bất kể Schedule | BR-002 |
| BR-003 | User `inactive` bị từ chối tuyệt đối | Mọi thẻ của user đều bị từ chối | BR-003 |
| BR-004 | Fallback luôn khả dụng | Luôn có ít nhất một đường đăng nhập cục bộ dự phòng (tài khoản quản trị cục bộ, mật khẩu riêng từng máy, ngoài phạm vi Agent quản lý). Không tạo phiên. Nếu Custom Greeter gặp sự cố khởi động hoặc crash lặp kéo dài, hệ thống hỗ trợ khôi phục về `lightdm-gtk-greeter` chuẩn qua launcher wrapper hoặc kênh bảo trì TTY/SSH để đường dự phòng trên màn hình vật lý luôn khả dụng | BR-004 |
| BR-005 | Quyết định đăng nhập thuộc về PC | PC quyết định dựa trên dữ liệu cục bộ, không hỏi server tại thời điểm quẹt thẻ | Mới |
| BR-006 | Dữ liệu cục bộ có thời hạn tin cậy | Mỗi lần nhận snapshot hợp lệ hoặc xác nhận gia hạn từ server cho cùng phiên bản làm mới thời hạn. Hạn tính từ lúc Agent nhận, thời lượng do server cấp. "Còn hạn" nghĩa là chưa tới `trusted_until` (UTC tuyệt đối). Quá hạn hoặc đồng hồ không hợp lý (ví dụ: `now < snapshot.created_at` do pin CMOS kiệt, BR-012) thì PC từ chối mọi lần quẹt thẻ với lý do "dữ liệu hết hạn" (`data_stale`); fallback vẫn dùng được. PC chưa từng nhận snapshot cũng bị từ chối như vậy. Thời hạn tin cậy chỉ áp dụng cho lần quẹt thẻ mới; phiên đang active không bị ảnh hưởng và vẫn kết thúc theo BR-009 (phiên sử dụng `CLOCK_BOOTTIME`) | Mới |
| BR-007 | Mỗi lần quẹt thẻ ghi đúng một bản ghi nhật ký | (a) Kết quả ghi là kết quả của quyết định, không phải của đăng nhập OS; (b) Bản ghi được ghi bền vững trước khi quyết định được trả về (gồm cả outcome `granted`, `denied`, `error`, và `noop` khi `same_user` quẹt lại); (c) Một lần quẹt là một lần thẻ xuất hiện trên đầu đọc khi màn hình đang ở trạng thái chờ quẹt và Agent không đang xử lý lần khác. Bản ghi do PC sinh với id duy nhất, chứa ảnh chụp danh tính và máy, phiên bản dữ liệu đã dùng, bất biến. Server loại trùng theo id; bản ghi có thể đến muộn. Hai ngoại lệ có chủ đích không sinh AuditLog (để dấu vết ở log hệ thống) là khi Agent không chạy và không ghi được kho cục bộ | BR-005 |
| BR-008 | Một máy tối đa một phiên active | Máy khởi động lại thì phiên cũ coi như đã kết thúc (`abandoned`, `workstation_rebooted`). Quy tắc quẹt thẻ khi máy đang có phiên (chỉ đánh giá sau khi thẻ đã qua các bước kiểm tra thẻ, lịch và profile hợp lệ theo CR-001): (a) Nếu thẻ thuộc về chính user đang active (`same_user`): không kill phiên, trả về `noop(already_active)`, gửi thông báo D-Bus thời gian còn lại lên Desktop, ghi một bản ghi nhật ký kiểm toán với outcome `noop` (BR-007); (b) Nếu thẻ của user khác quẹt khi Desktop đang active và phiên còn hạn: từ chối với lý do `workstation_busy`, báo hiệu tại đầu đọc (LED/còi), không làm gián đoạn người đang làm việc (chấp nhận rủi ro sinh viên quên logout làm máy bận đến hết phiên trong MVP, xử lý qua fallback); (c) Nếu thẻ của user khác quẹt khi máy đang ở Greeter (đã logout) hoặc phiên hiện tại đã hết hạn: trả về `granted`, thay thế phiên (`abandoned`, `superseded`), quyết định ghi bền vững trước khi kích hoạt Two-Phase Teardown dọn sạch phiên cũ để mở phiên mới | BR-007 |
| BR-009 | Phiên kết thúc đúng hạn | Hạn phiên là cuối chuỗi khung giờ liên tục trong cùng một ngày (CR-001 bước 7), tính một lần lúc quyết định. Hạn thực tế là hạn sớm hơn của hạn UTC và hạn theo đồng hồ đo (`CLOCK_BOOTTIME`). PC cảnh báo trước hạn qua D-Bus và tự đăng xuất khi chạm hạn, không phụ thuộc server. Dọn sạch toàn bộ tiến trình của phiên OS trước lượt tiếp theo (`loginctl terminate-user` theo user slice, cưỡng chế `SIGKILL`; yêu cầu cấu hình SSHD `DenyGroups labstudent` và tắt linger). **Tuyệt đối không tự động xóa thư mục `/home` hay dữ liệu file cục bộ** sau phiên. Muốn tiếp tục sau khi hết chuỗi hoặc chạm hạn tối đa thì quẹt lại | BR-035 |
| BR-010 | Thay đổi chỉ có hiệu lực khi PC nhận snapshot mới | Sửa lịch, thành viên nhóm, khóa thẻ, vô hiệu hóa user chỉ ảnh hưởng các lần quẹt sau khi PC nhận bản mới. Không buộc đăng xuất phiên đang chạy | BR-036 |
| BR-011 | Snapshot theo từng máy, có phiên bản | Chỉ chứa dữ liệu liên quan tới máy đó, phiên bản tăng dần. Bao gồm cả thẻ bị khóa và user bị vô hiệu hóa để PC phân biệt được lý do từ chối cụ thể (FR-003). PC không nhận bản cũ hơn bản đang dùng. Hỏng hoặc không hợp lệ thì giữ bản cũ | Mới |
| BR-012 | Khung giờ trong ngày theo múi giờ triển khai & Đồng hồ hợp lý | Một múi giờ chuẩn cho triển khai (`Asia/Ho_Chi_Minh`, UTC+7). Khung giờ trong cùng một ngày `[bắt đầu, kết thúc)` với bắt đầu < kết thúc, không hỗ trợ ca qua nửa đêm (D-011). Đồng hồ đơn điệu (`CLOCK_BOOTTIME`) bắt buộc dùng cho timer thời lượng phiên (D-012). Đánh giá lịch lúc quẹt thẻ yêu cầu giờ hiện tại ≥ `snapshot.created_at` (phát hiện pin CMOS kiệt khiến giờ hệ thống lùi về quá khứ); khi online đối chiếu với `server_time` qua Heartbeat, lệch quá ngưỡng thì cảnh báo kỹ thuật viên | BR-033 |
| BR-013 | Quy tắc thẻ | Một thẻ gắn một user tại một thời điểm; một user có nhiều thẻ. Ba trạng thái `unbound`, `active`, `disabled`. Gỡ liên kết thì về `unbound` và có thể gắn lại | BR-010, 011, 013 |
| BR-014 | User không xóa cứng | "Xóa" nghĩa là `inactive`, kích hoạt lại được. Lịch sử nhật ký giữ nguyên | BR-012 |
| BR-015 | Quy tắc zone | Một máy thuộc tối đa một zone. Zone là danh sách phẳng. Xóa zone không xóa máy. Schedule theo zone áp dụng cho mọi máy hiện trong zone | BR-020 đến 022 |
| BR-016 | Nhiều Schedule khớp thì hợp quyền và cấm mơ hồ Profile | Chỉ cần một Schedule khớp là đủ điều kiện vào. Tuy nhiên, nếu nhiều Schedule cùng khớp trong khung giờ hiện tại mà trỏ tới các profile đích khác nhau (`target_os_username`), kết quả là mơ hồ và bị từ chối tuyệt đối (`ambiguous_profile`). Không có deny; không có Schedule thì từ chối mặc định. Schedule tắt bị bỏ qua | BR-030 đến 032 |
| BR-017 | Không xóa đối tượng đang được Schedule tham chiếu | Áp dụng cho user, nhóm, máy, zone, dù Schedule bật hay tắt | BR-034 |
| BR-018 | Đăng ký máy trạm qua Quy trình Tự động (Zero-Touch) hoặc Token | (a) Master Image được làm sạch (`/etc/machine-id` uninitialized, không chứa credential); bật nguồn lần đầu Agent tự sinh cặp khóa riêng biệt và gửi yêu cầu đăng ký (`PendingApproval`) kèm hostname và MAC; Admin phê duyệt tập trung trên Web Dashboard và gán Zone để cấp credential (D-010); (b) Hỗ trợ token đăng ký theo lô (batch enrollment token) có hạn dùng và số lần dùng tối đa | BR-041 |
| BR-019 | Phát hiện offline bằng heartbeat | Quá số lần heartbeat liên tiếp bị bỏ lỡ (cấu hình được) thì máy offline | CR-002 |
| BR-020 | Quản lý Profile tài khoản OS dùng chung trên máy trạm | (a) Máy trạm hỗ trợ tài khoản Linux dùng chung (`WorkstationProfile`, ví dụ `student`, `labuser`), không cá nhân hóa tài khoản riêng theo sinh viên; (b) Mỗi máy trạm tự động quét và khai báo danh sách profile được phép (allowlist thuộc nhóm `labstudent`) với server qua Auto-Discovery (D-009); Agent và PAM từ chối đăng nhập vào profile không nằm trong allowlist hợp lệ (`profile_not_found`, `profile_disabled`); (c) Tài khoản dùng chung không cấp quyền sudo không mật khẩu, chỉ thuộc nhóm hạn chế; khóa mật khẩu cục bộ (`passwd -l`) nếu chỉ cho phép đăng nhập qua quẹt thẻ; (d) Tách biệt hoàn toàn danh tính xác thực (User/Card) cho audit và Profile OS cho môi trường desktop | Mới |

## Calculation Rule: CR-001 Đánh giá đăng nhập tại PC
1. **Kiểm tra dữ liệu & đồng hồ:** Chưa có snapshot, hoặc quá thời hạn tin cậy `trusted_until` (UTC), hoặc giờ hiện tại < mốc sàn đồng hồ `floor = max(snapshot.created_at, last_server_time - 60s)` (BR-006, BR-012, D-012) → từ chối `data_stale` (chi tiết `clock_invalid`).
2. **Tra thẻ:** Tra thẻ theo `CardMatchKey` (tính từ UID theo ADR-007). Không có hoặc `unbound` → từ chối `unknown_card`. Trạng thái `disabled` → từ chối `card_disabled`.
3. **Tra chủ thẻ:** Chủ thẻ mang trạng thái `inactive` → từ chối `user_inactive`.
4. **Khớp Schedule theo đối tượng:** Lấy các Schedule `enabled` khớp user hoặc nhóm của user, và máy hoặc zone của máy. Rỗng → từ chối `no_schedule`.
5. **Khớp khung giờ:** Lọc các Schedule có khung giờ chứa thời điểm hiện tại `now` trong cùng một ngày (D-011). Rỗng → từ chối `out_of_schedule`.
6. **Xác định Profile đích (Agent-side resolve):** Tập hợp các `target_os_username` từ các Schedule khớp ở bước 5 (nếu Schedule không chỉ định thì lấy default profile của máy trạm).
   - Nếu tập hợp có từ 2 `os_username` khác nhau trở lên → từ chối `ambiguous_profile` (BR-016).
   - Tra cứu profile được chọn trong allowlist cục bộ của máy trạm: không có → từ chối `profile_not_found`; `status = disabled` → từ chối `profile_disabled`.
7. **Tính toán hạn phiên:** Hạn phiên là cuối chuỗi khung giờ liên tục bắt đầu từ thời điểm hiện tại trong cùng một ngày từ các Schedule khớp và cùng profile đích, không vượt quá thời điểm hiện tại cộng `Max Session Duration`. Hạn gắn với cả UTC tuyệt đối (`expires_at`) và hạn đo `CLOCK_BOOTTIME`.
8. **Đánh giá trạng thái phiên hiện tại trên máy (BR-008):**
   - (a) Nếu máy đang có phiên Desktop active của **chính user này** (`same_user`): trả về kết quả `noop(already_active)`. Gửi thông báo D-Bus thời lượng còn lại lên Desktop, ghi nhận một bản ghi nhật ký kiểm toán với outcome `noop` (BR-007), không tạo phiên mới.
   - (b) Nếu máy đang có phiên Desktop active của **user khác** và phiên còn hạn: trả về kết quả `denied(workstation_busy)`. Phát tín hiệu bận tại đầu đọc (còi/LED), ghi nhận bản ghi nhật ký `denied(workstation_busy)`, không làm gián đoạn phiên làm việc của người trước.
   - (c) Nếu máy đang ở màn hình Greeter (người trước đã đăng xuất) HOẶC phiên hiện tại đã hết hạn ca học (`now >= expires_at`): trả về kết quả `granted`. Agent ghi bền vững bản ghi nhật ký kiểm toán (`granted`, `target_os_username`) và tạo `LocalSession pending` (write-ahead), sau đó kích hoạt Two-Phase Teardown tiêu diệt phiên cũ (nếu có, chuyển `abandoned(superseded)`) trước khi bàn giao quyền đăng nhập `staged_auth` cho Greeter/PAM mở phiên mới.

## Validation Rules
| ID | Đối tượng | Quy tắc |
|----|----------|---------|
| VR-001 | User.external_id | Duy nhất, không rỗng |
| VR-002 | Card.uid | Duy nhất; UID `unbound` thì gắn lại; UID đang có chủ thì báo lỗi |
| VR-003 | Schedule giờ | Bắt đầu < kết thúc trong cùng một ngày (không qua nửa đêm); `start_time < end_time` |
| VR-004 | Schedule ngày hiệu lực | Từ ≤ đến (nếu có) |
| VR-005 | Schedule | Đủ ba chiều: đúng một user hoặc một nhóm; đúng một máy hoặc một zone; một khung giờ lặp; target_os_username hợp lệ (nếu có) |
| VR-006 | Zone.name, Group.name | Duy nhất sau khi trim, không phân biệt hoa thường, không rỗng |
| VR-007 | Card.uid định dạng | Hex hợp lệ, 4, 7 hoặc 10 byte; chuẩn hóa trước khi so sánh |
| VR-008 | Workstation.mac_address | Hợp lệ, duy nhất |
| VR-009 | Schedule.days_of_week | Ít nhất một ngày |
| VR-010 | AdminAccount.username | Duy nhất, không rỗng |
| VR-011 | User.external_id định dạng an toàn | Chỉ chứa ký tự chữ thường không dấu, số, dấu gạch dưới hoặc gạch ngang (`^[a-z0-9_-]{1,24}$`); không trùng tên hệ thống (root, sudo, admin...) |
| VR-012 | WorkstationProfile.os_username | Hợp lệ theo chuẩn POSIX username, tồn tại trên máy trạm, không phải tài khoản root/system UID < 1000 |

## Notes
- BR-001 và CR-001 là rule phức tạp nhất, cần test nhiều tổ hợp, đặc biệt BR-016 và biên giờ BR-012.
- BR-004 và BR-020 là các rule an toàn cốt lõi bảo vệ tính khả dụng và an ninh hệ điều hành máy trạm.
- BR-005, BR-006, BR-011 là ba rule đặc trưng của mô hình edge.