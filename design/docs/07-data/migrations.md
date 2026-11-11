# 🔄 Data Migrations (Server PostgreSQL & Edge SQLite WAL)

> Tài liệu quy định quy chuẩn quản lý thay đổi lược đồ dữ liệu cho cả **Central Server (PostgreSQL 15)** và **Edge Workstation (`/var/lib/nfc-agent/edge.db`, SQLite WAL)**.

---

## 1. Quy Ước Đặt Tên & Kỷ Luật Migration

### 1.1. Phía Server (PostgreSQL 15)
- **Định dạng tên file:** `YYYYMMDD_HHMMSS_<mô_tả_ngắn>.sql` (hoặc migration pair `.up.sql` / `.down.sql` trong NestJS migration runner).
- **Quy tắc bất di bất dịch:**
  1. **Không sửa migration đã chạy trên môi trường chung/production:** Mọi thay đổi sửa cột hoặc bổ sung index phải tạo file migration mới.
  2. **Transactional DDL:** Toàn bộ câu lệnh thay đổi bảng/index bọc trong `BEGIN; ... COMMIT;` (trừ `CREATE INDEX CONCURRENTLY` cho bảng lớn nếu chạy online trên production).
  3. **Bắt buộc kèm chiến lược rollback (`down`):** Mọi migration thêm bảng/cột đều phải có script hoàn tác tương ứng; riêng bước xóa cột/bảng phải tách pha (Expand-Contract).
  4. **An toàn cho bảng bất biến (`audit_logs`, `sessions`):** Trigger chống `UPDATE`/`DELETE` ở tầng CSDL KHÔNG được vô hiệu hóa trong migration nghiệp vụ thường; chỉ migration nâng cấp cấu trúc chính thức mới được `ALTER TABLE`. Down migration của baseline chỉ dùng cho môi trường dev/test; trên môi trường có dữ liệu thật không chạy down làm mất `audit_logs`.

### 1.2. Phía Edge Workstation (SQLite 3 WAL `edge.db`)
- **Định danh phiên bản schema:** Sử dụng chuẩn nội tại **`PRAGMA user_version`** của SQLite (số nguyên đơn điệu `1, 2, 3, ...`), kèm thư mục script SQL nhúng sẵn trong gói phát hành Python Agent (`migrations/001_init.sql`, `migrations/002_...sql`).
- **Thời điểm chạy:** Tự động thực thi lúc Edge Agent khởi động **trước khi gửi tín hiệu sẵn sàng tới Custom Greeter** ([reboot.md](../05-behavior/sequences/reboot.md) Nguyên tắc 2).
- **Tính nguyên tử:** Mỗi bước nâng `user_version` chạy trọn gói trong `BEGIN IMMEDIATE; ... PRAGMA user_version = <N>; COMMIT;`. Nếu mất điện giữa chừng, giao dịch dở dang bị bỏ và DB giữ nguyên phiên bản cũ.
- **PRAGMA đặt ngoài giao dịch:** `journal_mode = WAL` không đổi được bên trong giao dịch và `foreign_keys` đặt trong giao dịch không có tác dụng. Vì vậy các PRAGMA của data-model §3.1 chạy ngay khi mở kết nối, **trước** `BEGIN`; script migration chỉ chứa DDL.

---

## 2. Danh Mục Migration Baseline (v1.0)

### 2.1. Central Server (PostgreSQL 15)
| # | Migration File | Phạm vi Bảng / Đối tượng | Date | Status | Rollback |
|---|---|---|---|---|---|
| 1 | `20261111_093000_init_identity_and_device.sql` | `users`, `cards`, `groups`, `group_members`, `admin_accounts`, `zones`, `workstations`, `workstation_profiles`, `enrollment_requests`, `revoked_certificates` + Partial Unique Index `uq_ws_default_profile` & CHECK `chk_cards_owner_unbound` | 2026-11-11 | Pending | ✅ (`DROP TABLE ... CASCADE`) |
| 2 | `20261111_093100_init_scheduling_and_distribution.sql` | `schedules` (XOR subject/target + Recurrence checks), `snapshots` (`payload_raw BYTEA`, `hmac_signature`), `sync_states`, `server_outbox` + partial index pending | 2026-11-11 | Pending | ✅ (`DROP TABLE ... CASCADE`) |
| 3 | `20261111_093200_init_operations_and_triggers.sql` | `workstation_statuses`, `sessions` (CHECK `chk_sessions_lifecycle` + `uq_sessions_active_ws`), `audit_logs`, `ingest_rejects` + Trigger `trg_audit_logs_append_only` (`INV-008`) & `trg_sessions_immutable_terminal` (`INV-007`, cho phép `inferred → reported` một lần) | 2026-11-11 | Pending | ✅ chỉ dev/test (`DROP TRIGGER / TABLE`) |

### 2.2. Edge Agent (SQLite 3 WAL — `/var/lib/nfc-agent/edge.db`)
| `user_version` | Migration Script | Nội dung Lược đồ & Chỉ mục | Rollback / Khôi phục |
|---|---|---|---|
| `0 → 1` | `edge_001_init.sql` | (PRAGMA `WAL`, `synchronous=FULL` đặt lúc mở kết nối, không nằm trong script) Tạo `agent_meta`, `local_liveness`, `snapshot_meta`, `snapshot_users`, `snapshot_user_groups`, `snapshot_cards`, `snapshot_schedules`, `local_workstation_profiles`, `local_sessions` (kèm 2 partial unique indexes thực thi `INV-014`), `audit_outbox` (`AUTOINCREMENT`) | Nếu nâng cấp thất bại hoặc `PRAGMA quick_check` lỗi -> thực hiện quy trình Emergency Quarantine mục 3.2 |

---

## 3. Chiến Lược Migration & Phục Hồi Sự Cố

### 3.1. Chiến Lược Triển Khai Không Gián Đoạn (Expand → Migrate → Contract)
Do 40–100 máy trạm trong phòng lab có thể tắt/bật không đồng bộ khi Server nâng cấp:
1. **Expand (Mở rộng trước):** Mọi thay đổi schema của payload JSON (`SnapshotContent`, `OutboxBatch`) đều giữ tương thích ngược (chỉ thêm trường mới có giá trị mặc định, tuyệt đối không xóa/đổi tên trường đang dùng). Khi đổi thuật toán `CardMatchKey` (ví dụ nâng lên Option 4 trong [ADR-007](../06-architecture/decisions/ADR-007-khoa-so-khop-uid.md)), Server nâng trường **`uid_scheme`** thay vì ghi đè phá chuẩn cũ.
2. **Co-exist & Rollout (Cùng tồn tại):** Triển khai bản Edge Agent mới qua APT repo nội bộ / Ansible trong giờ bảo trì. Khi máy trạm khởi động, `PRAGMA user_version` tự nâng cấp cấu trúc `edge.db` cục bộ mà không mất `audit_outbox` chưa đồng bộ.
3. **Contract (Thu gọn sau):** Chỉ dọn bỏ cột cũ trên Server hoặc ngừng hỗ trợ schema cũ sau khi `workstation_statuses` xác nhận 100% máy trạm đã báo về phiên bản Agent mới.

### 3.2. Quy Trình Khôi Phục Khẩn Cấp Khi Hỏng `edge.db` (Defense-in-Depth)
Spike S5 mới cho thấy SQLite WAL + `synchronous=FULL` sống sót qua **một** lần cắt điện cưỡng chế (`SysRq b`, sau 545 vòng ghi) trên máy ảo; chưa có bằng chứng trên ổ vật lý. Vì vậy vẫn cần quy trình phục hồi khi DB hỏng (D-017):
1. Lúc khởi động Daemon, Agent chạy **`PRAGMA quick_check(1);`**.
2. Nếu kiểm tra thất bại hoặc `SQLITE_CORRUPT`:
   - Di chuyển tệp hỏng để chẩn đoán: `edge.db` → `edge.db.corrupt.<unix_ts>` (kèm `-wal`, `-shm`).
   - Khởi tạo tệp `edge.db` mới sạch từ `edge_001_init.sql` (`version = 0` → trạng thái `NoData`), rồi ghi `agent_meta` từ `/var/lib/nfc-agent/identity/identity.json` (`mqtt_identity`, `key_version`). Không dùng giá trị mặc định cho `key_version`: nếu máy đã cài lại (`key_version = 2`) mà DB mới mang 1, mọi snapshot sẽ bị từ chối và máy tự khóa.
   - Cứu nhật ký chưa gửi: đọc `audit_outbox` từ tệp hỏng (`sqlite3 .recover` hoặc đọc từng dòng, bỏ qua trang hỏng) và chèn lại vào DB mới theo thứ tự cũ; `entry_id` giữ nguyên nên server tự loại trùng nếu có mục đã gửi. Số mục không cứu được ghi trong một sự kiện `security_alert` (`edge_db_recovered`) để Admin biết nhật ký có khoảng trống.
   - Phiên đang dở (`local_sessions`) không cứu. Nếu lúc đó vẫn còn phiên OS của profile `labstudent` (Agent khởi động lại mà máy không reboot), Agent kết thúc phiên OS đó theo bảng recovery của `swipe-login.md`, vì không còn hạn để giám sát. Phía server, phiên `active` cũ được suy luận kết thúc theo XINV-008 khi máy báo lại.
   - Tiếp tục mở Unix socket PAM trả `denied(data_stale / no_data)` theo `BR-004` để **Greeter và đường đăng nhập mật khẩu bảo trì vẫn hoạt động bình thường**, tuyệt đối không treo máy (Nguyên tắc 7 của [reboot.md](../05-behavior/sequences/reboot.md)).
   - Ngay khi kết nối MQTT 5 mTLS (`Hello` báo `snapshot_version: 0`), Server tự động đẩy lại Snapshot mới nhất để máy trạm phục hồi mà không cần kỹ thuật viên can thiệp. Chỉ khi thư mục `identity/` cũng hỏng mới phải đăng ký lại máy.

---

## 4. Chính Sách Lưu Trữ Lâu Dài & Giới Hạn Dung Lượng (Retention & Housekeeping)

| Bảng dữ liệu | Nơi lưu | Chính sách tăng trưởng & Dọn dẹp | Lý do |
|---|---|---|---|
| `snapshots` (`payload_raw`) | Server PostgreSQL | Chỉ giữ lại tối đa **5 phiên bản gần nhất** cho mỗi máy trạm (`version > desired_version - 5`), dọn định kỳ bằng job nền | Tránh phình dung lượng BLOB `BYTEA` qua nhiều học kỳ khi lịch thay đổi thường xuyên; dữ liệu nguồn vẫn nằm ở Scheduling/Identity |
| `audit_logs` | Server PostgreSQL | Lưu trữ bất biến (`INV-008`); chuẩn bị phương án Partition theo năm học (`RANGE (occurred_at)`) khi vượt ngưỡng hàng triệu dòng | Đảm bảo truy xuất lịch sử kiểm toán phục vụ đào tạo & đối soát |
| `audit_outbox` | Edge SQLite | Tự xóa ngay lập tức sau mỗi gói `command/ack` (`DELETE FROM audit_outbox WHERE outbox_seq <= :acked_seq;`) | Giữ kích thước `edge.db` luôn gọn nhẹ (< 10 MB theo ADR-003) |
| `ingest_rejects` | Server PostgreSQL | Giữ cho tới khi Admin xem và đánh dấu đã xử lý; không tự xóa | Số lượng rất nhỏ; là dấu vết các mục nhật ký không áp dụng được (D-015) |
| `local_sessions` | Edge SQLite | Xóa các phiên đã kết thúc (`status IN ('completed', 'forced_logout', 'abandoned', 'discarded')`) có `ended_at < now - 30 days` | Phục vụ tra cứu nhanh & recovery tức thì, không để phình tệp trên máy trạm |
| WAL Checkpoint | Edge SQLite | `PRAGMA wal_autocheckpoint = 1000` kết hợp chạy `PRAGMA wal_checkpoint(TRUNCATE);` định kỳ lúc máy rảnh (ở Greeter) | Ngăn tệp `edge.db-wal` tăng kích thước bất thường sau đợt mất mạng kéo dài |
