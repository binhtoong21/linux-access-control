# 🔌 API Design (REST)

> REST API của Server NestJS (ADR-006). Hai nhóm client:
> 1. **Web Dashboard** (React SPA) của Admin, vai trò duy nhất trong MVP (D-007). Dashboard là một client của API, không có chức năng nào chỉ làm được trên giao diện (FR-081).
> 2. **Edge Agent** chỉ dùng hai endpoint đăng ký máy (Mục 6). Mọi giao tiếp còn lại của Agent đi qua MQTT ([events.md](events.md)).
>
> Bất biến và quy tắc nghiệp vụ được kiểm tra ở Server bất kể client; ràng buộc CSDL tương ứng ở [07-data](../07-data/data-model.md).

## Base URL

```
https://<server>/api/v1
```
TLS bắt buộc (NFR-SEC01). Dashboard được phục vụ cùng origin nên không cần CORS.

## Authentication

| Client | Cơ chế | Chi tiết |
|---|---|---|
| Admin (Dashboard) | Đăng nhập username/password → JWT trong cookie `HttpOnly`, `Secure`, `SameSite=Strict` | Hạn 8 giờ, không có refresh token (hết hạn thì đăng nhập lại). Mỗi request Server kiểm tra lại `admin_accounts.status`, nên vô hiệu hóa admin có hiệu lực ngay (INV-016). Mật khẩu băm bằng Argon2id/bcrypt (NFR-SEC06) |
| Agent (đăng ký máy) | `POST` không cần xác thực; `GET` trạng thái dùng `Authorization: Bearer <fetch_code>` | Agent xác thực Server bằng CA nhúng trong Master Image (D-014). `fetch_code` chỉ lưu bản băm |
| Agent (vận hành) | Không dùng REST | mTLS trên MQTT (ADR-002) |

Mọi request ghi (`POST`/`PUT`/`PATCH`/`DELETE`) từ Dashboard, kể cả `POST /auth/login`, phải có header `X-Requested-With: dashboard` (chống CSRF kèm `SameSite=Strict`); thiếu thì 403 `CSRF_HEADER_REQUIRED`. Hai endpoint đăng ký của Agent (Mục 6) được miễn.

## Quy Ước Chung

- JSON UTF-8; thời gian dạng ISO 8601 UTC (`2026-11-11T09:30:00Z`); giờ trong ngày của lịch là `HH:MM` theo `Asia/Ho_Chi_Minh`.
- Danh sách: `?limit=` (mặc định 50, tối đa 200) và `?cursor=` (con trỏ mờ trả về ở `next_cursor`). Danh sách nhỏ (zone, nhóm, admin) trả hết, không phân trang.
- Không có `DELETE` cho user và audit (XINV-001, INV-008); "xóa user" là chuyển `inactive`.
- Mọi thao tác ghi thành công được ghi vào `admin_audit_logs` cùng giao dịch (D-020).
- Thay đổi trạng thái dùng endpoint hành động (`POST /cards/{id}/disable`) thay vì `PATCH status` tự do, để Server kiểm tra đúng chuyển trạng thái hợp lệ (INV-006).

## Endpoints

### Xác thực Admin (FR-080, FR-082)
| Method | Path | Mô tả | Request | Response |
|---|---|---|---|---|
| POST | `/auth/login` | Đăng nhập | `{username, password}` | 204 + cookie; 401 `INVALID_CREDENTIALS` |
| POST | `/auth/logout` | Đăng xuất | — | 204 |
| GET | `/auth/me` | Admin hiện tại | — | 200 `{id, username, display_name}` |
| GET | `/admins` | Danh sách admin | — | 200 `Admin[]` |
| POST | `/admins` | Tạo admin | `{username, display_name, password}` | 201 `Admin`; 409 `DUPLICATE` |
| POST | `/admins/{id}/disable` · `/enable` | Vô hiệu hóa / bật lại | — | 200 `Admin`; 409 `LAST_ACTIVE_ADMIN` nếu là admin `active` cuối cùng |
| POST | `/admins/me/password` | Đổi mật khẩu của mình | `{current_password, new_password}` | 204 |

> `LAST_ACTIVE_ADMIN`: không cho vô hiệu hóa admin đang hoạt động cuối cùng, tránh hệ thống không còn ai quản trị được.

### User, Nhóm (FR-030, FR-031)
| Method | Path | Mô tả | Request | Response |
|---|---|---|---|---|
| GET | `/users` | Tìm/lọc | `?q=` (mã hoặc tên), `?status=`, `?group_id=` | 200 trang `User[]` |
| POST | `/users` | Tạo | `{external_id, full_name, email?}` | 201; 409 `DUPLICATE` (INV-002); 400 nếu `external_id` sai định dạng (VR-011) |
| GET | `/users/{id}` | Chi tiết, kèm thẻ và nhóm | — | 200 |
| PATCH | `/users/{id}` | Sửa thông tin | `{full_name?, email?}` | 200 |
| POST | `/users/{id}/deactivate` · `/activate` | Vô hiệu hóa / kích hoạt lại (BR-014) | — | 200 |
| GET | `/groups` | Danh sách | — | 200 `Group[]` (kèm số thành viên) |
| POST | `/groups` | Tạo | `{name, description?}` | 201; 409 `DUPLICATE` (INV-003) |
| PATCH | `/groups/{id}` | Sửa | `{name?, description?}` | 200 |
| DELETE | `/groups/{id}` | Xóa | — | 204; 409 `REFERENCED_BY_SCHEDULE` (BR-017) |
| GET | `/groups/{id}/members` | Thành viên | — | 200 `User[]` |
| PUT | `/groups/{id}/members` | Thêm thành viên (hàng loạt) | `{user_ids: []}` | 200 |
| DELETE | `/groups/{id}/members/{user_id}` | Bớt thành viên | — | 204 |

### Thẻ (FR-032, FR-033, FR-073)
UID chỉ đi vào API, không bao giờ được trả ra trong danh sách; chỉ xem được ở chi tiết thẻ và chi tiết nhật ký (NFR-SEC03).

| Method | Path | Mô tả | Request | Response |
|---|---|---|---|---|
| POST | `/cards` | Đăng ký thẻ cho user | `{uid, user_id}` hoặc `{from_audit_entry_id, user_id}` (FR-073: lấy UID từ bản ghi `unknown_card`) | 201 `Card`; nếu UID đã có và `unbound` thì gắn lại (200); 409 `CARD_ALREADY_BOUND` nếu đang có chủ (INV-001, VR-002); 400 `INVALID_UID` (VR-007); 400 `RANDOM_UID_NOT_SUPPORTED` (VR-013, cả khi lấy từ bản ghi `unknown_card`) |
| GET | `/cards` | Tra cứu | `?uid=` (qua blind index), `?user_id=`, `?status=` | 200 trang `Card[]` (không có UID) |
| GET | `/cards/{id}` | Chi tiết, kèm UID đã giải mã | — | 200 |
| POST | `/cards/{id}/disable` · `/enable` | Khóa / mở khóa (`active ⇄ disabled`) | — | 200; 409 `INVALID_STATE_TRANSITION` |
| POST | `/cards/{id}/unbind` | Gỡ khỏi user → `unbound` | — | 200 |
| POST | `/cards/{id}/bind` | Gắn thẻ `unbound` cho user → `active` | `{user_id}` | 200; 409 `INVALID_STATE_TRANSITION` |

### Zone và Máy trạm (FR-041, FR-042, FR-062)
| Method | Path | Mô tả | Request | Response |
|---|---|---|---|---|
| GET | `/zones` · POST `/zones` · PATCH `/zones/{id}` | Danh sách / tạo / sửa | `{name, location, description?}` | 200/201; 409 `DUPLICATE` |
| DELETE | `/zones/{id}` | Xóa (máy giữ nguyên, bỏ zone) | — | 204; 409 `REFERENCED_BY_SCHEDULE` (BR-015, BR-017) |
| GET | `/workstations` | Danh sách cho Dashboard | `?zone_id=`, `?status=`, `?connectivity=`, `?sync=in_sync\|pending\|stuck` | 200 `WorkstationSummary[]` |
| GET | `/workstations/{id}` | Chi tiết | — | 200 (xem dưới) |
| PATCH | `/workstations/{id}` | Đổi zone, ghi chú | `{zone_id?}` | 200 |
| POST | `/workstations/{id}/disable` | Vô hiệu hóa máy: thu hồi chứng chỉ, sinh lại CRL, khởi động lại broker (D-014) | `{confirm: true}` | 200; máy cũ vẫn cho quẹt tới khi lease hết (≤ 24h) |
| DELETE | `/workstations/{id}` | Xóa máy đã `disabled` | — | 204; 409 `REFERENCED_BY_SCHEDULE`; 409 `INVALID_STATE_TRANSITION` nếu còn `enrolled` |
| GET | `/workstations/{id}/profiles` | Danh mục profile máy báo lên | — | 200 `Profile[]` |
| PATCH | `/workstations/{id}/profiles/{os_username}` | Bật/tắt, chọn mặc định | `{status?, is_default?}` | 200 |

`WorkstationSummary` (đủ cho màn hình phòng máy, FR-042/062):
```json
{
  "id": "…", "mqtt_identity": "ws-01", "hostname": "lab-a-01", "zone": {"id": "…", "name": "Lab A"},
  "status": "enrolled", "connectivity": "online", "last_heartbeat_at": "2026-11-11T09:30:12Z",
  "trust_state": "Fresh", "clock_skew_detected": false,
  "sync": {"state": "in_sync", "desired_version": 13, "acked_version": 13},
  "current_session": {"user": {"external_id": "SV001", "full_name": "Nguyễn Văn A"}, "started_at": "…", "expires_at": "…"},
  "flags": ["overdue_session"]
}
```
`flags` có thể gồm: `overdue_session` (phiên quá `expires_at` mà chưa báo kết thúc, `session-expiry.md` EF-7), `stuck_sync`, `apply_error`, `missing_profile` (Schedule yêu cầu profile máy không có, D-009), `ingest_rejects`, `security_alert`.

### Đăng ký máy: phía Admin (FR-040, D-014)
| Method | Path | Mô tả | Request | Response |
|---|---|---|---|---|
| GET | `/enrollment-requests` | Danh sách | `?status=pending` (mặc định) | 200 `[{id, hostname, mac_address, machine_id, submitted_at, duplicate_mac_detected, duplicate_of: {id, mqtt_identity}?}]` |
| POST | `/enrollment-requests/{id}/approve` | Duyệt máy mới | `{mode: "new", mqtt_identity, zone_id}` | 200; 409 `DUPLICATE_REQUIRES_REINSTALL` nếu yêu cầu có cờ trùng; 409 `DUPLICATE` nếu `mqtt_identity` đã dùng; 400 nếu sai mẫu `^[A-Za-z0-9_-]{3,64}$` |
| POST | `/enrollment-requests/{id}/approve` | Duyệt cài lại máy đã có | `{mode: "reinstall"}` (máy = `duplicate_of`) | 200: `key_version + 1`, thu hồi chứng chỉ cũ, máy `disabled` trở lại `enrolled` |
| POST | `/enrollment-requests/approve-batch` | Duyệt tất cả theo Zone | `{zone_id, request_ids: [], name_prefix: "lab-a-"}` | 200 `{approved: [...], skipped: [{id, reason: "duplicate"}]}`; tên máy sinh tuần tự `lab-a-01`, `lab-a-02`… |
| POST | `/enrollment-requests/{id}/reject` | Từ chối | `{note?}` | 200 |

`approve` gửi lại cho yêu cầu đã `approved` với cùng tham số trả 200 như lần đầu (idempotent); khác tham số trả 409 `INVALID_STATE_TRANSITION`.

### Lịch (FR-020 đến FR-023)
| Method | Path | Mô tả | Request | Response |
|---|---|---|---|---|
| GET | `/schedules` | Xem theo máy, zone, nhóm, user | `?workstation_id=`, `?zone_id=`, `?group_id=`, `?user_id=`, `?status=` | 200 `Schedule[]` |
| POST | `/schedules` | Tạo | `ScheduleInput` | 201; 400 `VALIDATION_ERROR` (VR-003…005, VR-009) |
| GET · PATCH · DELETE | `/schedules/{id}` | Chi tiết / sửa / xóa | `ScheduleInput` (một phần) | 200 / 200 / 204 |
| POST | `/schedules/{id}/enable` · `/disable` | Bật / tắt (FR-021) | — | 200 |
| POST | `/schedules/validate` | Kiểm tra trước khi lưu: lỗi hợp lệ, cảnh báo xung đột profile (`ambiguous_profile` có thể xảy ra, BR-016) và máy thiếu profile (D-009) | `ScheduleInput` | 200 `{errors: [], warnings: []}` |

`ScheduleInput`:
```json
{
  "name": "CTDL - Nhóm 1",
  "subject": {"type": "group", "id": "…"},
  "target": {"type": "zone", "id": "…"},
  "valid_from": "2026-09-01", "valid_to": "2027-01-15",
  "days_of_week": ["MONDAY", "WEDNESDAY", "FRIDAY"],
  "start_time": "07:30", "end_time": "11:30",
  "target_os_username": null
}
```
`end_time` cho phép `24:00`; `start_time < end_time` trong cùng ngày (D-011). Cảnh báo xung đột profile không chặn lưu: đó là cấu hình hợp lệ, chỉ từ chối tại máy khi hai lịch cùng khớp một lúc (BR-016).

### Nhật ký, Phiên, Cảnh báo (FR-072, FR-062)
| Method | Path | Mô tả | Request | Response |
|---|---|---|---|---|
| GET | `/audit-logs` | Lọc nhật ký | `?user_id=`, `?workstation_id=`, `?zone_id=`, `?from=`, `?to=`, `?outcome=`, `?reason=`, `?card_uid=` (tra qua blind index) | 200 trang, sắp theo `occurred_at` giảm dần; **không** chứa UID |
| GET | `/audit-logs/{id}` | Chi tiết, kèm UID đã giải mã | — | 200 |
| GET | `/sessions` | Phiên | `?workstation_id=`, `?user_id=`, `?status=`, `?from=`, `?to=` | 200 trang `Session[]` (kèm `end_source`) |
| GET | `/ingest-rejects` | Mục nhật ký không áp dụng được (D-015) | `?workstation_id=`, `?resolved=false` | 200 trang |
| POST | `/ingest-rejects/{id}/resolve` | Đánh dấu đã xem | `{note?}` | 200 |
| GET | `/admin-audit-logs` | Nhật ký thao tác Admin (D-020) | `?admin_id=`, `?entity_type=`, `?entity_id=`, `?from=`, `?to=` | 200 trang |
| GET | `/workstation-alerts` | Cảnh báo từ máy (`snapshot_signature_invalid`, `edge_db_recovered`, `key_version_mismatch`, `teardown_failed_stuck_resource`) | `?workstation_id=`, `?from=` | 200 trang |

`occurred_at` là giờ của máy trạm; Dashboard hiển thị kèm `received_at` để thấy bản ghi đến muộn hoặc máy lệch giờ.

### Hệ thống
| Method | Path | Mô tả | Response |
|---|---|---|---|
| GET | `/system/health` | Tình trạng Server: CSDL, kết nối broker, worker snapshot, hạn CRL | 200 `{db: "ok", mqtt: "ok", outbox_backlog: 0, crl_next_update: "2036-11-09T…", warnings: []}`; `warnings` có `crl_expiring` khi còn dưới 30 ngày (S9) |

## 6. Endpoint Đăng Ký Dành Cho Agent (ADR-002 §7)

### `POST /workstations/enroll`
Không cần xác thực; giới hạn tần suất theo IP.
```json
// Request
{ "machine_id": "3f9a…", "hostname": "lab-a-pc07", "mac_address": "52:54:00:12:34:56",
  "csr_pem": "-----BEGIN CERTIFICATE REQUEST-----…", "agent_version": "1.0.0" }
// 201 Created
{ "request_id": "e2b0…", "fetch_code": "q9Zk…(43 ký tự base64url)", "poll_interval_sec": 5 }
```
400 `INVALID_CSR` nếu CSR không phải Ed25519 hoặc chữ ký CSR sai. Trùng MAC/`machine_id` **không** trả lỗi: yêu cầu vẫn được tạo và gắn cờ cho Admin (D-014).

### `GET /workstations/enroll/{request_id}/status`
Header `Authorization: Bearer <fetch_code>`.

| Trạng thái | Response 200 |
|---|---|
| Chờ duyệt | `{ "status": "pending", "poll_interval_sec": 5 }` |
| Đã duyệt | `{ "status": "approved", "mqtt_identity": "ws-07", "key_version": 1, "client_cert_pem": "…", "k_m": "<64 hex>", "broker": {"host": "…", "port": 8883} }` |
| Bị từ chối | `{ "status": "rejected" }` (Agent dừng hỏi; kỹ thuật viên dùng `nfc-agent reenroll`) |

401 `INVALID_FETCH_CODE` khi mã sai hoặc đã hết hiệu lực (sau Hello đầu tiên của máy). Trả `K_m` nhiều lần trước khi hết hiệu lực là chủ ý, để mất gói trả lời không làm máy kẹt (D-014).

## Error Format

```json
{
  "error": {
    "code": "REFERENCED_BY_SCHEDULE",
    "message": "Zone 'Lab A' đang được 3 lịch tham chiếu",
    "details": [{"schedule_id": "…", "name": "CTDL - Nhóm 1"}]
  }
}
```

## Error Codes

| Code | HTTP | Khi nào | Nguồn |
|---|---|---|---|
| `VALIDATION_ERROR` | 400 | Dữ liệu sai định dạng hoặc vi phạm VR; `details` liệt kê từng trường | VR-001…012 |
| `INVALID_UID` | 400 | UID không phải hex 4/7/10 byte | VR-007 |
| `RANDOM_UID_NOT_SUPPORTED` | 400 | UID ngẫu nhiên (4 byte, byte đầu `08`); thẻ này không dùng được với cơ chế so khớp UID tĩnh | VR-013, D-021 |
| `INVALID_CSR` | 400 | CSR sai định dạng, sai thuật toán | ADR-002 |
| `INVALID_CREDENTIALS` | 401 | Sai username/password | FR-080 |
| `UNAUTHORIZED` | 401 | Chưa đăng nhập, JWT hết hạn, admin bị vô hiệu hóa | INV-016 |
| `INVALID_FETCH_CODE` | 401 | Mã tải credential sai hoặc hết hiệu lực | D-014 |
| `NOT_FOUND` | 404 | Không có tài nguyên | — |
| `DUPLICATE` | 409 | Trùng mã user, tên zone/nhóm/admin, `mqtt_identity` | INV-002, INV-003, INV-016 |
| `CARD_ALREADY_BOUND` | 409 | UID đang thuộc user khác | INV-001, VR-002 |
| `REFERENCED_BY_SCHEDULE` | 409 | Xóa đối tượng còn lịch tham chiếu | BR-017 |
| `INVALID_STATE_TRANSITION` | 409 | Chuyển trạng thái không hợp lệ (thẻ, yêu cầu đăng ký, máy) | INV-006, INV-010 |
| `DUPLICATE_REQUIRES_REINSTALL` | 409 | Duyệt yêu cầu có cờ trùng thành máy mới | D-014, INV-009 |
| `LAST_ACTIVE_ADMIN` | 409 | Vô hiệu hóa admin hoạt động cuối cùng | — |
| `RATE_LIMITED` | 429 | Vượt giới hạn tần suất | — |
| `CSRF_HEADER_REQUIRED` | 403 | Request ghi thiếu header `X-Requested-With: dashboard` | Mục Authentication |
| `INTERNAL_ERROR` | 500 | Lỗi không lường trước; chi tiết chỉ ghi log server, không trả về client | — |
| `HTTP_ERROR` | 4xx khác | Lỗi giao thức chung do framework (413, 415…) | — |

## Idempotency & Concurrency

| Thao tác | Cơ chế | Xử lý khi gửi lại / xung đột |
|---|---|---|
| `POST /cards` | UID duy nhất (blind index) | Gắn lại thẻ `unbound` của cùng UID; đang có chủ thì 409 |
| `POST /enrollment-requests/{id}/approve` | Trạng thái yêu cầu | Cùng tham số trả lại kết quả cũ (200); khác tham số 409 |
| `POST /workstations/enroll` | Không idempotent | Gửi lại tạo yêu cầu mới; trùng `machine_id` với yêu cầu đang chờ được gắn cờ nên Admin thấy ngay |
| Ingest outbox (MQTT) | `entry_id` | `ON CONFLICT DO NOTHING` (XINV-006) |
| Sửa user, lịch, zone | Không khóa lạc quan | Ghi sau thắng. Chấp nhận cho MVP một vai trò với vài admin; mỗi thay đổi đều sinh event dựng lại snapshot nên trạng thái cuối luôn được phân phối đúng |

## Retry Policy

| Client → Endpoint | Chiến lược | Ghi chú |
|---|---|---|
| Agent → `POST /workstations/enroll` | Thử lại khi lỗi mạng/5xx | Backoff có jitter như MQTT (1s → 60s, ADR-002 §6) |
| Agent → `GET …/status` | Hỏi định kỳ `poll_interval_sec` | Lỗi mạng thì backoff; 401 thì dừng và ghi log |
| Dashboard → API | Không tự thử lại thao tác ghi | Hiển thị lỗi cho Admin; danh sách máy tự làm mới mỗi 10s (NFR-P03) |

Server không gọi hệ thống bên ngoài nào qua HTTP (Mosquitto là hạ tầng nội bộ, dùng MQTT).

## Rate Limiting

| Endpoint | Giới hạn | Cửa sổ |
|---|---|---|
| `POST /auth/login` | 5 lần sai theo username + IP, sau đó khóa tạm | 15 phút |
| `POST /workstations/enroll` | 10 yêu cầu theo IP | 1 phút |
| `GET /workstations/enroll/{id}/status` | 30 yêu cầu theo `request_id` | 1 phút |
| Còn lại (Admin đã đăng nhập) | Không giới hạn | — |

## Versioning Strategy

Versioning trên URL (`/api/v1`). Chỉ thêm trường mới trong cùng phiên bản; đổi nghĩa hoặc xóa trường thì tăng lên `/api/v2` và giữ v1 cho tới khi Dashboard chuyển hết. Hai endpoint đăng ký của Agent cần ổn định lâu nhất vì Agent cài trong Master Image cập nhật chậm hơn Server.
