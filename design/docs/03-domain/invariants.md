# 🔒 invariants.md

## Quy ước
- INV-XXX: bất biến trong một Aggregate. XINV-XXX: xuyên Aggregate hoặc Context.
- Mỗi invariant phải được enforce bằng logic, không chỉ ghi tài liệu.
- Cột Nguồn truy ngược về BR/VR/FR.

## Invariants
| ID | Invariant | Aggregate | Nguồn |
|----|-----------|-----------|-------|
| INV-001 | CardUid duy nhất toàn hệ thống, kể cả thẻ `unbound`; UID `unbound` thì gắn lại thay vì tạo mới | Card | BR-013, VR-002 |
| INV-002 | `User.external_id` duy nhất và không rỗng | User | VR-001 |
| INV-003 | `Zone.name` và `Group.name` duy nhất (sau trim, không phân biệt hoa thường) và không rỗng; `Zone.location` không rỗng | Zone, Group | VR-006 |
| INV-004 | Schedule đủ ba chiều: `subject` (đúng một User hoặc Group), `target` (đúng một Workstation hoặc Zone), `recurrence` | Schedule | VR-005, BR-001 |
| INV-005 | RecurrenceRule: `valid_from ≤ valid_to` (nếu có), `days_of_week` không rỗng, `start_time < end_time` trong cùng một ngày (không qua nửa đêm); TimeOfDay trong 00:00 đến 24:00 và `start_time < end_time` | RecurrenceRule | VR-003, VR-004, VR-009, BR-012, D-011 |
| INV-006 | Vòng đời Card: `unbound ⇔ owner rỗng`. Chuyển hợp lệ: register → `active`; `active ⇄ disabled`; `active/disabled → unbound`; `unbound → active`. Thẻ `unbound` không cho vào | Card | BR-013 |
| INV-007 | Session: `active ⇔ ended_at rỗng`. Mọi status khác phải có `ended_at ≥ started_at` và `end_reason`. Trạng thái kết thúc không quay về `active`. Kết thúc do server **suy luận** (`end_source = inferred`) được thay **đúng một lần** bằng báo cáo thật đến muộn từ Agent (XINV-008, D-015); kết thúc do Agent báo cáo thì không đổi nữa | Session | Thiết kế, D-015 |
| INV-008 | AuditLog chỉ ghi thêm, không sửa, không xóa. Mỗi `entry_id` có đúng một bản ghi | AuditLog | BR-007, NFR-SEC05 |
| INV-009 | `Workstation.mac_address` duy nhất (sau chuẩn hóa) | Workstation | VR-008 |
| INV-010 | Đăng ký máy: mọi yêu cầu được ghi nhận qua `EnrollmentRequest` ở trạng thái `pending` và chỉ thành `approved` khi Admin duyệt (không tự động duyệt). Yêu cầu trùng MAC hoặc `machine_id` với máy đã có hoặc với yêu cầu khác đang chờ mang cờ `duplicate_mac_detected`; yêu cầu trùng một máy đã có chỉ được duyệt thành cài lại chính máy đó hoặc bị từ chối. Credential cũ chỉ bị thu hồi và `key_version` chỉ tăng khi Admin duyệt | EnrollmentRequest, Workstation | BR-018, D-010, D-014 |
| INV-011 | Phiên bản Snapshot tăng dần theo từng máy. LocalSnapshot chỉ được thay bằng bản có phiên bản lớn hơn, thay nguyên tử; bản không hợp lệ thì giữ bản cũ. Phía server, phiên bản cấp mới luôn lớn hơn mọi phiên bản máy đã từng báo lên, kể cả sau khi khôi phục dữ liệu server từ bản sao lưu (D-016) | Snapshot, LocalSnapshot | BR-011, D-016 |
| INV-012 | Nội dung Snapshot của một máy chỉ gồm dữ liệu liên quan tới máy đó: các Schedule có Target là máy hoặc zone của máy, cùng user, nhóm, thẻ của các Subject đó, và metadata allowlist profile OS (`target_os_username`, `enabled`, `is_default`, `key_version`) của máy trạm | Snapshot | BR-011, NFR-SEC03 |
| INV-013 | Mỗi lần quẹt thẻ ở Edge tạo đúng một bản ghi trong AuditOutbox với `entry_id` duy nhất; bản ghi chỉ bị loại khỏi hàng đợi sau khi server xác nhận | AuditOutbox | BR-007 |
| INV-014 | Tối đa một LocalSession `active` và một LocalSession `pending` trên một máy; quẹt đè khi desktop đang active và phiên còn hạn bị từ chối `workstation_busy`; chỉ thay thế phiên (`superseded`) khi đã về greeter hoặc phiên cũ hết hạn; khởi động lại thì đối chiếu với phiên OS thực tế | LocalSession | BR-008 |
| INV-015 | LocalSession tự kết thúc khi chạm hạn sớm hơn của hai hạn: UTC tuyệt đối (`expires_at`) và hạn theo đồng hồ đo `CLOCK_BOOTTIME`, không phụ thuộc kết nối với server. Dọn sạch toàn bộ tiến trình của phiên OS (`loginctl terminate-user`, cưỡng chế `SIGKILL` theo user slice), tuyệt đối không xóa thư mục home hay file dữ liệu cục bộ | LocalSession | BR-009, FR-005 |
| INV-016 | `AdminAccount.username` duy nhất; tài khoản `disabled` không đăng nhập được; luôn còn ít nhất một tài khoản `active` (không vô hiệu hóa được admin hoạt động cuối cùng) | AdminAccount | VR-010, D-019 |
| INV-017 | LocalSession chỉ chuyển sang trạng thái kết thúc khi phiên OS tương ứng đã thật sự kết thúc hoặc không còn | LocalSession | Thiết kế |
| INV-018 | WorkstationProfile: `os_username` hợp lệ theo allowlist của máy trạm (tài khoản thuộc nhóm hạn chế `labstudent` được Auto-Discovery phát hiện và đồng bộ với Server); không cấp quyền sudo không mật khẩu; khóa mật khẩu cục bộ (`passwd -l`) nếu chỉ xác thực qua thẻ. PAM và Agent từ chối phục vụ profile ngoài allowlist hoặc UID < 1000 | WorkstationProfile, LocalWorkstationProfile | BR-020, NFR-SEC07, D-009 |

## Cross-Aggregate Invariants
| ID | Invariant | Aggregates liên quan | Cách xử lý | Nguồn |
|----|-----------|---------------------|------------|-------|
| XINV-001 | User không bị hard-delete; "xóa" là `inactive`. Thẻ của user giữ nguyên trạng thái, việc chặn do XINV-002 | User, Card | Không có thao tác xóa User | BR-014 |
| XINV-002 | Đăng nhập bị từ chối tuyệt đối nếu thẻ `disabled` hoặc `unbound`, hoặc user `inactive`, bất kể Schedule | Card, User, Schedule | LoginEvaluationService kiểm tra thẻ và user trước Schedule | BR-002, BR-003 |
| XINV-003 | Không xóa User, Group, Workstation, Zone nếu còn Schedule tham chiếu, dù Schedule bật hay tắt | Schedule, các aggregate được tham chiếu | DeletionGuard hỏi Scheduling trước khi xóa | BR-017 |
| XINV-004 | Xóa Zone không xóa Workstation; chỉ gỡ liên kết zone | Zone, Workstation | `ZoneDeleted` → Device gỡ zone, Distribution dựng lại snapshot | BR-015 |
| XINV-005 | Mọi thay đổi ở Identity, Device, Scheduling làm đổi nội dung snapshot của một máy thì cuối cùng máy đó phải có Snapshot phiên bản mới (không để lệch âm thầm) | Identity, Device, Scheduling, Distribution | SnapshotBuilder lắng nghe mọi event thay đổi; SyncState theo dõi máy chưa cập nhật | BR-010, FR-050 đến 054 |
| XINV-006 | Nhận nhật ký từ Edge là idempotent theo `entry_id`; nhật ký có thể đến muộn và không theo thứ tự. Một bản ghi không áp dụng được (dữ liệu sai, xung đột trạng thái) không được chặn hàng đợi: server giữ lại nguyên văn để Admin xem, vẫn xác nhận để Edge tiếp tục gửi phần sau (D-015) | AuditOutbox, AuditLog | AuditIngestService loại trùng, tách bản ghi lỗi | BR-007, D-015 |
| XINV-007 | Mọi khung giờ được đánh giá theo múi giờ của triển khai (`Asia/Ho_Chi_Minh` UTC+7); Edge kiểm tra đồng hồ tối thiểu (`now >= floor` với `floor = last_sync_local_time - CLOCK_FLOOR_TOLERANCE`, dung sai 60s), nếu lùi về quá khứ (pin CMOS kiệt) thì từ chối `data_stale(clock_invalid)`; online thì đối chiếu `server_time` qua Heartbeat (lệch > 60s gửi cảnh báo `clock_skew_detected` nhưng không chặn lease) | Schedule, LocalSnapshot | LoginEvaluationService | BR-012, D-011, D-012 |
| XINV-008 | Máy khởi động lại (`boot_id` đổi): suy luận chuyển các Session `active` của máy trên server sang `abandoned` (`inferred`) chỉ áp dụng sau khi outbox của máy đã hết (hoặc quá thời gian chờ). Báo cáo thật từ Agent thắng suy luận. Thời điểm kết thúc suy luận: `ended_at = max(started_at, lần cuối nghe từ máy ở boot cũ)`, đảm bảo `ended_at ≥ started_at` (INV-007). Ngoài ra, khi nhận `SessionStarted` mới trong khi máy còn phiên `active` khác trên server, phiên cũ được suy luận kết thúc (`abandoned`, `inferred`) trước khi ghi phiên mới (D-015) | Session, WorkstationStatus | WorkstationLivenessService chờ outbox rỗng trước khi suy luận | BR-008 |
| XINV-009 | Đăng ký agent: ghi nhận qua `EnrollmentRequest` (Zero-Touch). Nếu trùng máy đã có thì giữ nguyên máy đang chạy, yêu cầu ở `pending` kèm cờ `duplicate_mac_detected` chờ Admin duyệt; chỉ khi Admin duyệt cài lại mới thu hồi credential cũ (broker từ chối chứng chỉ cũ), tăng `key_version` và cấp Client Cert mới. Máy bị `disabled` cũng bị broker từ chối chứng chỉ | EnrollmentRequest, Workstation | AgentEnrollmentService, DeviceService | BR-018, D-010, D-014 |
| XINV-010 | Chưa có snapshot hoặc quá thời hạn tin cậy thì mọi lần quẹt thẻ ở Edge bị từ chối `data_stale`; fallback vẫn dùng được | LocalSnapshot | LoginEvaluationService bước 1 | BR-004, BR-006 |

## Traceability: Rules → Domain
| Rule | Được bảo đảm bởi |
|---|---|
| BR-001, BR-016 | LoginEvaluationService (không phải invariant tĩnh), INV-004 |
| BR-002, BR-003 | XINV-002 |
| BR-004 | Ngoài domain (kiến trúc agent và PAM) |
| BR-005 | Cấu trúc: LoginEvaluationService thuộc context Edge |
| BR-006 | XINV-010, INV-011 |
| BR-007 | INV-008, INV-013, XINV-006 |
| BR-008 | INV-014, XINV-008 |
| BR-009 | INV-015 |
| BR-010 | XINV-005 |
| BR-011 | INV-011, INV-012 |
| BR-012 | INV-005, XINV-007 |
| BR-013 | INV-001, INV-006 |
| BR-014 | XINV-001 |
| BR-015 | Cấu trúc (`zone` chỉ một giá trị), XINV-004 |
| BR-017 | XINV-003 |
| BR-018 | INV-010, XINV-009 |
| BR-020 | INV-018 |
| VR-001 | INV-002 |
| VR-002, VR-007 | INV-001, Value Object CardUid |
| VR-003, VR-004, VR-009 | INV-005 |
| VR-005 | INV-004 |
| VR-006 | INV-003 |
| VR-008 | INV-009 |
| VR-010 | INV-016 |
| VR-011 | INV-002 |
| VR-012 | INV-018 |

## Notes
- Enforcement có thể bổ sung bằng ràng buộc ở tầng Data (07), nhưng domain không phụ thuộc database.
- XINV-005 là bất biến quan trọng nhất của mô hình edge: nó biến "đồng bộ" từ một chi tiết kỹ thuật thành cam kết của domain.