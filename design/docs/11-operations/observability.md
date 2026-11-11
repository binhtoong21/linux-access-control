# 📊 Observability

> Quy mô ~40 máy, một máy chủ: không dựng hệ thống giám sát riêng (Prometheus, ELK…). Dashboard của hệ thống là nơi quan sát chính; log dùng `journald` có sẵn của systemd. Mọi chỉ số dưới đây đều tính được từ dữ liệu đã có trong CSDL ([07-data](../07-data/data-model.md)).

## Metrics

Hiển thị trên Dashboard (`GET /workstations`, `GET /system/health`), không xuất ra hệ thống ngoài.

| Chỉ số | Cách tính | Ngưỡng cảnh báo | Hiển thị |
|---|---|---|---|
| Máy online / tổng | `workstation_statuses.connectivity` | Máy `offline` trong giờ có ca | Màn hình phòng máy |
| Máy chưa đồng bộ | `acked_version < desired_version` | `Stuck` > 10 phút khi online | Cờ `stuck_sync` |
| Trạng thái tin cậy | `trust_state` từ heartbeat | `Expired`, `ClockInvalid` | Cờ theo máy |
| Lệch đồng hồ | `clock_skew_detected` | `true` | Cờ theo máy |
| Lỗi nạp snapshot | `last_apply_error` | khác `null` | Cờ `apply_error` |
| Outbox tồn ở máy | `pending_outbox_count` trong Hello | > 1.000 | Chi tiết máy |
| Phiên quá hạn chưa kết thúc | `sessions.status = 'active'` và `now > expires_at + 10 phút` | Có | Cờ `overdue_session` |
| Mục nhật ký lỗi chưa xử lý | `ingest_rejects` với `resolved_at IS NULL` | > 0 | Cờ `ingest_rejects` |
| Cảnh báo an ninh | `workstation_alerts` trong 7 ngày | > 0 | Cờ `security_alert` |
| Tồn đọng outbox của Server | `server_outbox` `pending` | > 100 hoặc cũ hơn 5 phút | `/system/health` |
| Hạn CRL | `nextUpdate` của CRL hiện hành | < 30 ngày | `/system/health` (`crl_expiring`) |
| Tỷ lệ từ chối theo lý do | `audit_logs` gom theo `reason` trong ngày | Tăng đột biến `data_stale`, `unknown_card` | Trang nhật ký (lọc) |

## Logs

| Nơi | Ghi gì | Định dạng | Lưu |
|---|---|---|---|
| Server (`journald`, unit `nfc-server`) | Request lỗi, ingest, dựng snapshot, sinh CRL, khởi động lại broker | JSON một dòng | 30 ngày (`journald` `MaxRetentionSec`) |
| Mosquitto (`journald`) | Kết nối/ngắt, lỗi TLS (`certificate verify failed`) | Mặc định Mosquitto | 30 ngày |
| Agent (`journald`, unit `nfc-agent`) | Khởi động, recovery, nạp snapshot, lỗi đầu đọc, teardown, những gì **không** vào được nhật ký kiểm toán (BR-007: Agent không chạy hoặc không ghi được kho cục bộ) | JSON một dòng | Theo mặc định `journald` của máy |
| Greeter (`/var/log/lightdm/seat0-greeter.log`) | Lỗi giao diện, fallback của wrapper | Văn bản | Theo `logrotate` của LightDM |

Log là công cụ chẩn đoán, **không** thay cho nhật ký kiểm toán (`audit_logs`). Không ghi UID thẻ, mật khẩu, `K_m`, `fetch_code` vào log.

Mức log: `ERROR` (cần xử lý: không ghi được CSDL, không ký được snapshot), `WARN` (tự hồi phục: mất kết nối, mục outbox lỗi, lệch giờ), `INFO` (sự kiện vận hành: kết nối, nạp snapshot, duyệt máy), `DEBUG` (chỉ bật khi chẩn đoán).

Khung một dòng log:
```json
{"ts": "2026-11-11T09:30:00.123Z", "level": "WARN", "service": "nfc-agent", "ws": "ws-07",
 "event": "snapshot_rejected", "detail": {"reason": "older_version", "version": 11}}
```

## Traces

Không dùng distributed tracing. Truy vết một lần quẹt thẻ qua các khóa có sẵn:

| Khóa | Nối |
|---|---|
| `entry_id` | Bản ghi quẹt ở Edge ↔ `audit_logs` ↔ `sessions.decision_id` |
| `session_id` | `local_sessions` ↔ `session_started` / `session_ended` ↔ `sessions` |
| `snapshots.version` / `data_version` | Lần quẹt ↔ snapshot đã dùng để quyết định |
| `boot_id` | Phiên ↔ lần khởi động của máy (đối soát reboot) |

## Audit Trail

| Nhật ký | Ghi khi | Dữ liệu | Bất biến |
|---|---|---|---|
| `audit_logs` | Mỗi lần quẹt thẻ (BR-007) | Kết quả, lý do, UID (mã hóa), ảnh chụp user/thẻ/máy, profile, version dữ liệu, lịch đã khớp | Trigger chặn sửa/xóa (INV-008) |
| `sessions` | Phiên mở/đóng | User, máy, profile, các mốc thời gian, `end_reason`, `end_source` | Trạng thái kết thúc không quay về `active`; suy luận được thay một lần (INV-007) |
| `admin_audit_logs` | Mỗi thao tác ghi của Admin qua API (D-020) | Admin, thời điểm, hành động, loại + id đối tượng, giá trị trước/sau (không chứa UID thô, mật khẩu) | Chỉ ghi thêm |
| `workstation_alerts` | Cảnh báo an ninh từ máy | Loại, chi tiết | Chỉ ghi thêm |
| `ingest_rejects` | Mục nhật ký không áp dụng được | Nguyên văn (UID thay bằng blind index), lý do | Chỉ thêm cột xử lý |

**Thời hạn lưu:** `audit_logs`, `sessions`, `admin_audit_logs` giữ toàn bộ trong thời gian vận hành pilot; khi vượt hàng triệu dòng thì phân vùng theo năm học (`migrations.md` §4). Thời hạn xóa cuối cùng do đơn vị vận hành quyết định theo quy định dữ liệu cá nhân; hệ thống không tự xóa.

## Alerting

Không gửi email/chat trong MVP (cảnh báo chủ động thuộc Extension, D-003). Cảnh báo hiển thị trên Dashboard, Admin xem khi mở trang phòng máy.

| Cảnh báo | Điều kiện | Mức | Xử lý (runbook) |
|---|---|---|---|
| Máy offline trong giờ có ca | 3 heartbeat bỏ lỡ | Trung bình | Kiểm tra mạng/nguồn máy; máy vẫn cho quẹt tới hết lease |
| Máy `Expired` khi online | `trust_state = Expired` | Cao | Xem `last_apply_error`; `key_version_mismatch` → `nfc-agent reenroll` |
| `ClockInvalid` / lệch giờ | Cờ đồng hồ | Trung bình | Sửa giờ / pin CMOS / NTP (`failure-model.md` E7) |
| Đồng bộ kẹt | `stuck_sync` | Trung bình | Xem `last_apply_error`, log Agent |
| Mục nhật ký lỗi | `ingest_rejects` > 0 | Thấp | Xem nguyên văn, đánh dấu đã xử lý |
| Cảnh báo an ninh | `workstation_alerts` mới | Cao | `snapshot_signature_invalid`: kiểm tra broker; `edge_db_recovered`: xem số mục mất |
| CRL sắp hết hạn | < 30 ngày | Cao | Khởi động lại Server / chạy job CRL (S9) |
| Phiên quá hạn chưa kết thúc | `overdue_session` | Trung bình | Agent có thể treo: kiểm tra máy |

## Dashboards

| Màn hình | Mục đích |
|---|---|
| Phòng máy (theo Zone) | Online/offline, ai đang dùng, đồng bộ, các cờ ở trên (FR-042, FR-062) |
| Nhật ký | Lọc theo user, máy, zone, thời gian, kết quả, UID (FR-072) |
| Yêu cầu đăng ký | Duyệt máy, xử lý cờ trùng (FR-040) |
| Hệ thống | `/system/health`: CSDL, broker, worker, hạn CRL |
