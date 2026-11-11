# ✅ functional.md

## Quy ước
- FR-XXX; Priority MoSCoW; Scope: MVP / Extended / Nice-to-have; Status: Draft.
- Module: 00 Login trên PC, 01 Màn hình login, 02 Lịch, 03 User-Nhóm-Thẻ, 04 Máy-Zone, 05 Sync, 06 Health, 07 Audit, 08 Quản trị.
- "Dữ liệu cục bộ" là snapshot mà PC nhận từ server (module Sync).

## Module 00: Đăng nhập trên PC
| ID | Yêu cầu | Priority | Scope | Notes |
|----|---------|----------|-------|-------|
| FR-001 | Đăng nhập bằng thẻ NFC tại màn hình login Linux | Must | MVP | Agent đọc UID qua PC/SC, chuẩn hóa UID (VR-007), tích hợp Custom Greeter và PAM trên LightDM |
| FR-002 | PC tự quyết định cho vào dựa trên dữ liệu cục bộ, không hỏi server khi quẹt | Must | MVP | Thứ tự xử lý ở CR-001 |
| FR-003 | Phân biệt lý do từ chối | Must | MVP | Thẻ chưa đăng ký, thẻ bị khóa, tài khoản bị vô hiệu hóa, không có lịch trên máy này, ngoài khung giờ, máy đang bận (`workstation_busy`), xung đột profile (`ambiguous_profile`), profile bị vô hiệu hóa hoặc không tồn tại (`profile_disabled`, `profile_not_found`), dữ liệu cục bộ hết hạn tin cậy hoặc chưa có (xem BR-011, CR-001) |
| FR-004 | Đường đăng nhập dự phòng cục bộ | Must | MVP | Tài khoản quản trị cục bộ mật khẩu riêng, nằm ngoài nền tảng, không tạo phiên (BR-004). Hỗ trợ khôi phục về greeter chuẩn khi gặp sự cố kéo dài qua script launcher hoặc TTY/SSH |
| FR-005 | Cảnh báo trước khi hết khung giờ và tự đăng xuất khi hết hạn phiên | Must | MVP | Cảnh báo qua D-Bus, tự đăng xuất và dọn sạch toàn bộ tiến trình của phiên OS theo user slice (`loginctl terminate-user`, chờ 2s, cưỡng chế `kill-user -s SIGKILL`, BR-009, D-006, A6); tuyệt đối không xóa thư mục home hay file dữ liệu cục bộ |
| FR-006 | Xác thực khuôn mặt (phương thức bổ sung) | Could | Nice-to-have | Thư viện có sẵn, xử lý cục bộ |
| FR-007 | Quản lý Profile tài khoản OS dùng chung theo Allowlist | Must | MVP | Hỗ trợ tài khoản Linux dùng chung (`WorkstationProfile`), tự phát hiện qua Auto-Discovery (D-009). Cung cấp giao diện Admin xem danh mục profile do Agent báo cáo, cấu hình bật/tắt (`enabled`/`disabled`) và đặt profile mặc định (`is_default`) cho từng máy trạm; cảnh báo trên Dashboard nếu có máy trong Zone thiếu profile mà Schedule yêu cầu (P2-1, P2-2) |

## Module 01: Màn hình login
| ID | Yêu cầu | Priority | Scope | Notes |
|----|---------|----------|-------|-------|
| FR-010 | Màn hình chờ quẹt thẻ, hiển thị các trạng thái: chờ quẹt, đang xử lý, thành công, bị từ chối kèm lý do | Must | MVP | Custom Greeter chạy cục bộ, nhận sự kiện đẩy từ Agent qua IPC để mở phiên 0-chạm; hỗ trợ khôi phục về greeter chuẩn nếu gặp lỗi kéo dài |
| FR-011 | Thông báo khi máy chưa có dữ liệu hợp lệ hoặc đã hết thời hạn tin cậy, hướng dẫn dùng đường dự phòng | Must | MVP | |
| FR-012 | Hiển thị thời gian còn lại của phiên | Must | MVP | Gửi thông báo D-Bus khi người dùng đang active quẹt lại thẻ của chính mình (`same_user`, BR-008(a), CR-001 bước 8a) |
| FR-013 | Phản hồi trạng thái khi máy đang có phiên hoạt động | Must | MVP | Báo hiệu tại đầu đọc (LED/còi) khi từ chối người khác lúc máy bận; chỉ thay thế phiên khi đã về greeter hoặc hết hạn (BR-008) |

## Module 02: Lịch
| ID | Yêu cầu | Priority | Scope | Notes |
|----|---------|----------|-------|-------|
| FR-020 | Tạo, sửa, xóa Schedule: gồm ai (đúng một user hoặc một nhóm), ở đâu (đúng một máy hoặc một zone), khi nào (ngày trong tuần, giờ bắt đầu và kết thúc trong cùng một ngày, khoảng ngày hiệu lực tùy chọn) và Profile đích tùy chọn (`target_os_username`) | Must | MVP | Giờ `[bắt đầu, kết thúc)` với bắt đầu < kết thúc trong cùng ngày, không hỗ trợ ca qua nửa đêm (D-011). Nếu không chỉ định `target_os_username` thì nhận profile mặc định của máy (A1, D-009) |
| FR-021 | Bật/tắt Schedule mà không xóa | Must | MVP | Dòng tắt bị bỏ qua khi đánh giá |
| FR-022 | Xem lịch theo máy, zone, nhóm, user | Must | MVP | Giúp admin kiểm tra ai được vào đâu lúc nào |
| FR-023 | Kiểm tra hợp lệ khi lưu | Must | MVP | VR-003 đến VR-005 |

## Module 03: User, Nhóm, Thẻ
| ID | Yêu cầu | Priority | Scope | Notes |
|----|---------|----------|-------|-------|
| FR-030 | Quản lý user: tạo, sửa, vô hiệu hóa, kích hoạt lại (không xóa cứng) | Must | MVP | external_id, họ tên, email, trạng thái |
| FR-031 | Quản lý nhóm và thành viên | Must | MVP | Một user thuộc nhiều nhóm |
| FR-032 | Đăng ký UID thẻ, gắn/gỡ thẻ cho user | Must | MVP | Một user nhiều thẻ, một thẻ một user (BR-013) |
| FR-033 | Vô hiệu hóa và bật lại thẻ | Must | MVP | Có hiệu lực tại PC sau khi nhận snapshot mới (BR-010) |

## Module 04: Máy và Zone
| ID | Yêu cầu | Priority | Scope | Notes |
|----|---------|----------|-------|-------|
| FR-040 | Đăng ký máy theo Zero-Touch Auto-Enrollment: máy gửi yêu cầu PendingApproval khi boot từ Master Image, Admin duyệt trên Dashboard (từng máy hoặc hàng loạt theo Zone) | Must | MVP | Cấp credential riêng biệt cho máy, không dùng MAC/Hostname làm credential (D-010, BR-018) |
| FR-041 | CRUD Zone (phòng), gán/gỡ máy vào zone | Must | MVP | Mỗi máy tối đa một zone (BR-015) |
| FR-042 | Xem danh sách máy, lọc theo zone và trạng thái | Must | MVP | |
| FR-043 | ~~Quản lý enrollment token~~ (bỏ theo D-014: mọi yêu cầu đăng ký đều do Admin duyệt) | — | Đã bỏ | Thay bằng duyệt hàng loạt theo Zone trong FR-040 |

## Module 05: Sync (đồng bộ server → PC)
| ID | Yêu cầu | Priority | Scope | Notes |
|----|---------|----------|-------|-------|
| FR-050 | Server tạo snapshot riêng cho từng máy, chỉ gồm dữ liệu liên quan tới máy đó | Must | MVP | BR-011; bao gồm cả thẻ bị khóa và user bị vô hiệu hóa để PC phân biệt lý do từ chối (FR-003) |
| FR-051 | Server đẩy snapshot qua MQTT khi dữ liệu liên quan thay đổi | Must | MVP | Lịch, nhóm, thành viên, thẻ, trạng thái user |
| FR-052 | PC nhận, kiểm tra, lưu cục bộ và chuyển sang bản mới một cách nguyên tử | Must | MVP | Bản hỏng thì giữ bản cũ |
| FR-053 | Máy mới online hoặc kết nối lại nhận ngay bản mới nhất | Must | MVP | |
| FR-054 | PC báo phiên bản đang dùng; server biết máy nào chưa cập nhật | Must | MVP | Admin thấy máy chưa nhận thay đổi |
| FR-055 | Dữ liệu cục bộ có thời hạn tin cậy (làm mới khi nhận snapshot hợp lệ hoặc xác nhận gia hạn từ server cho cùng phiên bản); quá hạn mà không đồng bộ được thì ngừng cho vào bằng thẻ | Must | MVP | BR-006; giá trị chọn sau |
| FR-056 | PC kiểm tra tính hợp lý của đồng hồ (`local_time >= floor` với `floor = last_sync_local_time - CLOCK_FLOOR_TOLERANCE` để tránh RTC pin CMOS chết; vi phạm từ chối quẹt thẻ với `data_stale (clock_invalid)`); khi online đối chiếu giờ với server qua Heartbeat, nếu lệch quá `CLOCK_SKEW_WARN_THRESHOLD` (60s) thì gửi cảnh báo `clock_skew_detected` lên Dashboard nhưng không từ chối gia hạn lease hay quẹt thẻ | Must | MVP | D-012, BR-012, Điểm 8 |
| FR-057 | PC tự kết nối lại MQTT khi mất kết nối | Must | MVP | |

## Module 06: Health
| ID | Yêu cầu | Priority | Scope | Notes |
|----|---------|----------|-------|-------|
| FR-060 | PC gửi heartbeat định kỳ qua MQTT | Must | MVP | Kèm phiên bản dữ liệu (FR-054) và định danh lần khởi động |
| FR-061 | Server đánh dấu offline khi quá số lần heartbeat liên tiếp bị bỏ lỡ | Must | MVP | BR-019 |
| FR-062 | Dashboard hiển thị máy online/offline và ai đang dùng | Must | MVP | "Đang dùng" suy ra từ phiên đang mở (FR-063) |
| FR-063 | PC báo mở và đóng phiên cho server | Must | MVP | PC đã có kết nối MQTT sẵn; chi phí gửi thêm sự kiện phiên rất thấp; cần thiết để dashboard hiển thị "ai đang dùng" (FR-062) và phục vụ audit |

## Module 07: Audit
| ID | Yêu cầu | Priority | Scope | Notes |
|----|---------|----------|-------|-------|
| FR-070 | PC ghi mỗi lần quẹt thẻ vào nhật ký cục bộ, giữ qua mất mạng và khởi động lại | Must | MVP | BR-007 |
| FR-071 | PC đẩy nhật ký lên server khi có kết nối; server loại trùng theo id | Must | MVP | |
| FR-072 | Xem và lọc nhật ký theo user, máy, zone, thời gian, kết quả, UID thẻ (tra qua chỉ mục mù, ADR-007) | Must | MVP | |
| FR-073 | Đăng ký thẻ từ bản ghi `unknown_card` (admin chọn bản ghi, gắn cho user) | Should | MVP | UID đã có sẵn trong nhật ký; gần như miễn phí |

## Module 08: Quản trị
| ID | Yêu cầu | Priority | Scope | Notes |
|----|---------|----------|-------|-------|
| FR-080 | Admin đăng nhập dashboard | Must | MVP | Tài khoản đầu tiên tạo khi cài server |
| FR-081 | REST API cho mọi chức năng quản lý; dashboard là một client của API | Must | MVP | |
| FR-082 | Tài khoản quản trị: tạo, vô hiệu hóa | Should | MVP | Một vai trò duy nhất; không vô hiệu hóa được admin hoạt động cuối cùng (INV-016) |
| FR-083 | Ghi và xem nhật ký thao tác của Admin (ai, lúc nào, sửa gì) | Should | MVP | D-020; chỉ ghi thêm |

## Extension (đã hạ xuống, giữ để mở rộng sau)
| Nhóm | FR cũ | Ghi chú |
|------|-------|---------|
| Import/Export | FR-014, 035, 061, 081 | Excel/CSV |
| Tích hợp ngoài | FR-082, 083, 092 | API client, webhook, vai trò Api_* |
| Thu hồi nâng cao | FR-050, FR-102 | Buộc đăng xuất khi thu hồi thẻ/user |
| Điều khiển từ xa | FR-051 đến 054 | Lock, restart, shutdown, thông báo |
| An ninh nâng cao | FR-101, 043, 063, 096 | Chống dò thẻ (sẽ ở agent), cảnh báo chủ động (email/chat). *Đã đưa vào MVP:* nhật ký thao tác admin (FR-083, D-020), thu hồi định danh máy (BR-018d, D-014) |
| Vận hành | FR-006, 007, 044 | Idle, gia hạn phiên, room map |
| Bỏ hẳn | FR-062, 070, 071 | Thống kê, kiểm kê phần cứng |

## Traceability: Goal → FR
| Goal | FR |
|------|----|
| G1 | FR-001, 003, 004, 005, 007 |
| G2 | FR-020 đến 023, 030 đến 033 |
| G3 | FR-050 đến 057 |
| G4 | FR-002, 055, 056 |
| G5 | FR-010 đến 013 |
| G6 | FR-060 đến 063 |
| D1 đến D7 | FR-007, 030 đến 033, 040 đến 043, 070 đến 072, 080 đến 082 |