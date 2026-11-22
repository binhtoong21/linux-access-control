# 📡 Events: Bản Tin MQTT (Server ⇄ Edge) và Domain Event Nội Bộ

> Hai loại sự kiện trong hệ thống:
> 1. **Integration message qua MQTT 5** giữa Server và Agent: hợp đồng giao tiếp xuyên tiến trình, xuyên ngôn ngữ (Node.js ⇄ Python). Định nghĩa đầy đủ ở Mục 2–4.
> 2. **Domain event nội bộ Server** (`ScheduleUpdated`, `CardDisabled`...): đi qua `server_outbox` để kích hoạt dựng lại snapshot (XINV-005). Mục 5.
>
> Kênh truyền, ACL, QoS, chữ ký: [ADR-002](../06-architecture/decisions/ADR-002-giao-thuc-mqtt-va-dinh-danh-may-tram.md), [ADR-003](../06-architecture/decisions/ADR-003-luu-tru-cuc-bo-va-xac-thuc-snapshot.md). Tài liệu này chốt **nội dung** từng bản tin.

---

## 1. Quy Ước Chung

| Quy ước | Giá trị |
|---|---|
| Mã hóa payload | JSON UTF-8. Bản tin có chữ ký được ký trên **đúng chuỗi byte gửi đi**; bên nhận thẩm định trên byte thô trước khi parse (ADR-003 §4) |
| Thời gian | UTC epoch giây, số thực (`1793049263.96`). Riêng ngày/giờ của lịch dùng `YYYY-MM-DD` và phút trong ngày theo `Asia/Ho_Chi_Minh` (BR-012) |
| Định danh máy | `{ws}` trong topic = `mqtt_identity` = CN chứng chỉ (ví dụ `ws-01`). Không dùng UUID nội bộ của server trên kênh MQTT |
| ID thực thể | UUID dạng chuỗi (`user_id`, `card_id`, `schedule_id`, `session_id`, `entry_id`) |
| Chữ ký | MQTT 5 User Property `signature = hex(HMAC-SHA256(K_m, "<tag>-v1:" ‖ payload))`, chỉ cho bản tin **Server → Edge** |
| Phiên bản lược đồ | Trường `schema` trong payload (`snapshot-v1`, `lease-v1`...). Thêm trường mới được, không đổi nghĩa/xóa trường cũ (Expand → Contract, `migrations.md` §3.1) |
| Trường lạ | Bên nhận bỏ qua trường không biết (tương thích tiến) |

## 2. Danh Mục Bản Tin MQTT

| Bản tin | Topic | Chiều | QoS / Retain | Ký | Mục |
|---|---|---|---|---|---|
| Hello | `lab/workstation/{ws}/hello` | Edge → Server | 1 / không | — | 3.1 |
| Heartbeat | `lab/workstation/{ws}/heartbeat` | Edge → Server | 0 / không | — | 3.2 |
| Outbox batch | `lab/workstation/{ws}/outbox` | Edge → Server | 1 / không | `outbox` (D-030) | 3.3 |
| Status / LWT | `lab/workstation/{ws}/status` | Edge (broker thay mặt khi đứt) → Server | 1 / **có** | — | 3.4 |
| Snapshot | `lab/workstation/{ws}/snapshot` | Server → Edge | 1 / **có** | `snapshot` | 4.1 |
| Lease | `lab/workstation/{ws}/lease` | Server → Edge | 1 / không | `lease` | 4.2 |
| Outbox ACK | `lab/workstation/{ws}/command/ack` | Server → Edge | 1 / không | `ack` | 4.3 |

```mermaid
sequenceDiagram
    autonumber
    participant A as Edge Agent
    participant B as Mosquitto
    participant S as Server
    A->>B: hello {snapshot_version, lease_nonce, profiles}
    B->>S: hello
    alt version bằng desired
        S->>B: lease {lease_duration_sec, nonce} [signature]
    else version khác desired
        S->>B: snapshot (retained) [signature]
    end
    B->>A: lease / snapshot
    loop 30s
        A->>B: heartbeat {snapshot_version, lease_nonce, trust_state}
        S->>B: lease (nếu version bằng desired)
    end
    A->>B: outbox {batch_id, from_seq, to_seq, records[]} [signature]
    S->>B: command/ack {batch_id, acked_seq} [signature]
```

---

## 3. Bản Tin Edge → Server

### 3.1. Hello
Gửi ngay sau mỗi lần kết nối (sau `SUBSCRIBE`). Server dùng để đánh dấu online, phát hiện reboot (`boot_id` đổi → Draining, XINV-008), so version để trả lease hoặc snapshot (D-016), cập nhật danh mục profile (Auto-Discovery, D-009) và vô hiệu hóa `fetch_code` của lần đăng ký vừa duyệt (D-014).

```json
{
  "schema": "hello-v1",
  "workstation_id": "ws-01",
  "boot_id": "9f2c8d14-5b1e-4c33-9a70-0d6f2e8b1c47",
  "agent_version": "1.0.0",
  "snapshot_version": 12,
  "key_version": 2,
  "lease_nonce": "7f3a9c1e5b2d4f60a8e1c3b5d7f90214",
  "pending_outbox_count": 4,
  "profiles": ["student", "labuser"],
  "local_time": 1793049263.81
}
```

| Trường | Bắt buộc | Mô tả |
|---|---|---|
| `boot_id` | ✔ | `/proc/sys/kernel/random/boot_id` |
| `snapshot_version` | ✔ | `0` khi `NoData` |
| `key_version` | ✔ | Từ `identity/` (D-017); khác server thì server ghi cảnh báo |
| `lease_nonce` | ✔ | 128-bit ngẫu nhiên hex, mới mỗi lần gửi (D-018) |
| `profiles` | ✔ | Tài khoản thuộc nhóm `labstudent`, UID ≥ 1000 có thật trên máy (INV-018) |
| `local_time` | ✔ | Để server so lệch giờ |

### 3.2. Heartbeat
Mỗi 30s và ngay sau khi nạp snapshot mới (thay cho bản tin `SnapshotApplied`). Là nguồn sự thật cho online/offline (BR-019).

```json
{
  "schema": "heartbeat-v1",
  "workstation_id": "ws-01",
  "boot_id": "9f2c8d14-5b1e-4c33-9a70-0d6f2e8b1c47",
  "snapshot_version": 12,
  "lease_nonce": "c41b0e7a92d35f8816a4e0b2c9d7f351",
  "trust_state": "Fresh",
  "local_time": 1793049293.80,
  "clock_skew_detected": false,
  "last_apply_error": null,
  "active_session_id": "a3c1f0d2-7e44-4b8e-9c1a-2f6d8e0b5a91",
  "profiles": ["student", "labuser"]
}
```

| Trường | Giá trị |
|---|---|
| `trust_state` | `NoData` \| `Fresh` \| `Expired` \| `ClockInvalid` (khớp `workstation_statuses.trust_state`) |
| `last_apply_error` | `null` hoặc mã: `signature_invalid`, `key_version_mismatch`, `older_version`, `schema_invalid` |
| `active_session_id` | Phiên `active` cục bộ hoặc `null`. Chỉ để Dashboard hiển thị; **không** dùng để đóng phiên trên server (việc đó theo XINV-008 / D-015) |

### 3.3. Outbox Batch
Tối đa 50 mục, theo thứ tự `outbox_seq` tăng dần, một lô đang chờ ACK tại một thời điểm (ADR-002 §5). Edge ký lô bằng `K_m` với tag `outbox-v1` (user property `signature`); `batch_id` là 16 byte ngẫu nhiên dạng hex, mới cho mỗi lần gửi, kể cả gửi lại (D-030). Server bỏ qua, không ACK, lô thiếu hoặc sai chữ ký.

```json
{
  "schema": "outbox-v1",
  "workstation_id": "ws-01",
  "batch_id": "3f1c9a0d5e7b42a8b6c4d2e0f1a3b5c7",
  "from_seq": 101,
  "to_seq": 103,
  "records": [ { "...": "xem các loại dưới đây" } ]
}
```

Mọi mục có chung khung:

| Trường | Mô tả |
|---|---|
| `entry_id` | UUID do Edge sinh; khóa loại trùng (XINV-006) |
| `outbox_seq` | Số thứ tự cục bộ |
| `occurred_at` | Thời điểm xảy ra theo giờ máy |
| `event_type` | `swipe_decision` \| `session_started` \| `session_ended` \| `security_alert` |
| `payload` | Theo loại, bảng dưới |

**`swipe_decision`** (BR-007: đúng một mục cho mỗi lần quẹt) → `audit_logs`
```json
{
  "entry_id": "d84f9a10-3c2b-4e6f-8a1d-5b7c9e0f2a34", "outbox_seq": 101,
  "occurred_at": 1793048324.61, "event_type": "swipe_decision",
  "payload": {
    "outcome": "granted",
    "reason": "granted",
    "detail": null,
    "card_uid": "1F0820CF",
    "reader_raw": null,
    "user": {"id": "6f1c2a3b-...", "external_id": "SV001", "full_name": "Nguyễn Văn A"},
    "card": {"id": "0b7e4d21-...", "status": "active"},
    "target_os_username": "student",
    "matched_schedule_ids": ["3a9d5e10-..."],
    "data_version": 12
  }
}
```

| `outcome` | `reason` | `detail` (ví dụ) |
|---|---|---|
| `granted` | `granted` | `null`, `superseded`, `os_session_lost` (phiên cũ bị thay) |
| `denied` | `unknown_card`, `card_disabled`, `user_inactive`, `no_schedule`, `out_of_schedule`, `data_stale`, `workstation_busy`, `ambiguous_profile`, `profile_disabled`, `profile_not_found` | `data_stale` kèm `no_data` \| `lease_expired` \| `clock_invalid` |
| `noop` | `already_active` | `null`, `extended` (phiên được gia hạn, D-033) |
| `error` | `invalid_uid`, `reader_error`, `internal_error` | — |

Trường tùy chọn `session_extension` chỉ có khi `detail = extended`: `{"session_id": "a3c1f0d2-...", "previous_expires_at": 1793055600, "expires_at": 1793059200}`. Server kéo dài `sessions.expires_at` của đúng phiên đó trên đúng máy đó, chỉ khi hạn mới muộn hơn; bản ghi trùng hay đến muộn không làm gì.

Quy tắc: `card_uid = null` khi không đọc được UID (`error`); `user`, `card` là `null` khi chưa tra được (`unknown_card`, `data_stale`, `error`). Ảnh chụp máy (`workstation_snapshot`: hostname, zone) do Server điền lúc nhận từ dữ liệu của chính nó.

**`session_started`** (FR-063) → `sessions`
```json
{ "payload": {
    "session_id": "a3c1f0d2-...", "decision_entry_id": "d84f9a10-...",
    "user_id": "6f1c2a3b-...", "card_id": "0b7e4d21-...", "os_username": "student",
    "boot_id": "9f2c8d14-...", "decided_at": 1793048324.61,
    "started_at": 1793048330.12, "expires_at": 1793055600.00 } }
```

**`session_ended`** → `sessions`
```json
{ "payload": {
    "session_id": "a3c1f0d2-...", "status": "forced_logout",
    "end_reason": "schedule_expired", "end_source": "reported",
    "ended_at": 1793055600.40 } }
```
`status` ∈ `completed`, `forced_logout`, `abandoned`; `end_source` ∈ `reported`, `reconstructed`. Phiên `discarded` không được gửi (chưa từng mở trên OS).

**`security_alert`** → `workstation_alerts`
```json
{ "payload": { "kind": "edge_db_recovered", "detail": {"salvaged_outbox_entries": 3} } }
```
`kind` ∈ `snapshot_signature_invalid`, `edge_db_recovered`, `key_version_mismatch`, `teardown_failed_stuck_resource` (ADR-008: phiên cũ không dọn được sau 5s). Tên `security_alert` giữ cho gọn; thực chất là "cảnh báo từ máy cần Admin xem".

**Chi tiết hiện thực (D-026):** lô chỉ bị bỏ qua, không ACK, khi chính lô không tin được (thiếu hoặc sai chữ ký `outbox-v1`, không phải JSON, thiếu `batch_id`, thiếu `to_seq`/`records`, `workstation_id` khác định danh trên topic, máy lạ); mọi trường hợp khác đều ACK tới `to_seq`. Mục trùng: `entry_id` đã có (audit, cảnh báo), phiên đã có theo `session_id` hoặc `decision_entry_id`, `session_ended` cho phiên đã có kết thúc `reported`. Mục lỗi (loại lạ, sai kiểu, vi phạm ràng buộc CSDL, `session_ended` cho phiên Server không biết) vào `ingest_rejects` đúng một lần dù lô được gửi lại. `session_started` đóng phiên `active` cũ của máy thành `abandoned` / `os_session_lost` / `inferred`, `ended_at = max(started_at cũ, started_at mới)`.

**Xử lý phía Server (D-015):** mỗi mục áp dụng trong một savepoint riêng; mục trùng `entry_id` bỏ qua; mục không áp dụng được vào `ingest_rejects`; lô luôn được ACK đến `to_seq`. `session_ended` thay kết quả suy luận đúng một lần; `session_started` khi máy còn phiên `active` cũ thì phiên cũ được suy luận kết thúc trước.

### 3.4. Status / LWT
Agent publish `{"status":"online"}` (retained) sau Hello; broker publish Last Will `{"status":"offline","reason":"connection_lost"}` khi kết nối đứt. Chỉ là gợi ý rút ngắn thời gian phát hiện; heartbeat vẫn là nguồn sự thật (BR-019).

---

## 4. Bản Tin Server → Edge (có chữ ký)

### 4.1. Snapshot (`snapshot-v1`)
Bản đầy đủ theo từng máy, không delta (INV-012). Server lưu nguyên byte đã ký ở `snapshots.payload_raw`.

```json
{
  "schema": "snapshot-v1",
  "workstation_id": "ws-01",
  "version": 13,
  "key_version": 2,
  "uid_scheme": "hmac-sha256-v1",
  "created_at": 1793049300.00,
  "parameters": {
    "lease_duration_sec": 86400,
    "warning_before_sec": 300,
    "max_session_duration_sec": 43200
  },
  "users": [
    {"id": "6f1c2a3b-...", "external_id": "SV001", "full_name": "Nguyễn Văn A",
     "status": "active", "group_ids": ["g-1b2c..."]}
  ],
  "cards": [
    {"match_key": "9b1f…64 hex", "card_id": "0b7e4d21-...", "user_id": "6f1c2a3b-...", "status": "active"}
  ],
  "schedules": [
    {"id": "3a9d5e10-...", "subject_type": "group", "subject_id": "g-1b2c...",
     "valid_from": "2026-09-01", "valid_to": "2027-01-15",
     "days_mask": 21, "start_minute": 450, "end_minute": 690,
     "target_os_username": null}
  ],
  "profiles": [
    {"os_username": "student", "status": "enabled", "is_default": true}
  ]
}
```

| Quy tắc nhận (Edge) | Nguồn |
|---|---|
| `workstation_id` là máy mình nhưng `key_version` khác `identity/` → bỏ, `last_apply_error = key_version_mismatch`, **không** cảnh báo. Xét **trước** chữ ký (chỉ đọc trường này, không dùng nội dung): snapshot retained từ trước khi cài lại máy được broker giao lại mang chữ ký khóa cũ, không phải tấn công (D-027) | D-017 |
| Chữ ký sai → bỏ, `security_alert(snapshot_signature_invalid)` | ADR-003 §4 |
| `workstation_id` khác máy mình → bỏ, `last_apply_error = schema_invalid` | D-017 |
| `version` bằng bản đang dùng → bỏ qua lặng lẽ (retained giao lại); nhỏ hơn → bỏ, `last_apply_error = older_version` | ADR-002 §4 |
| `version` lớn hơn → thay nguyên tử mọi bảng `snapshot_*` và cờ profile, đặt `trusted_until = max(cũ, giờ máy + lease_duration_sec)`, `last_sync_local_time = max(cũ, giờ máy)`, rồi gửi heartbeat ngay | INV-011, D-018 |

**Phạm vi nội dung (INV-012, FR-050, D-023):**

| Mảng | Gồm | Không gồm |
|---|---|---|
| `schedules` | Schedule **đang bật** có target là máy này hoặc zone hiện tại của máy | Schedule tắt (Agent không cần biết) |
| `users` | Subject trực tiếp và thành viên các nhóm subject của các Schedule trên, kể cả `inactive` (để Agent trả `user_inactive`). `group_ids` chỉ gồm nhóm là subject của các Schedule trong snapshot | User không dính Schedule nào của máy |
| `cards` | Thẻ `active` và `disabled` của các user trên (để Agent trả `card_disabled`) | Thẻ `unbound`, thẻ của user khác |
| `profiles` | Mọi profile của máy, kèm `status` và `is_default` | — |

**Dạng chuẩn tắc:** thứ tự khóa cố định như ví dụ trên; `users`, `schedules` sắp theo `id`, `cards` theo `card_id`, `profiles` theo `os_username`, `group_ids` tăng dần (so sánh chuỗi theo mã ký tự). JSON gọn, UTF-8 không escape. Cùng dữ liệu luôn cho cùng chuỗi byte, trừ `version` và `created_at`; `snapshots.content_hash` là SHA-256 của nội dung **không gồm hai trường đó**, nên version chỉ tăng khi nội dung thật sự đổi. Snapshot lớn hơn 1 MB là lỗi dựng, không được phát.

`days_mask`: Thứ Hai = 1, Thứ Ba = 2, Thứ Tư = 4, Thứ Năm = 8, Thứ Sáu = 16, Thứ Bảy = 32, Chủ Nhật = 64. `match_key = hex(HMAC-SHA256(K_m, "uid-match-v1" ‖ UID chuẩn hóa))` (ADR-007).

**Xử lý Hello / heartbeat phía Server (D-025):**

| Bước | Quy tắc |
|---|---|
| Kiểm tra | JSON hợp lệ theo `contracts/schemas`; `workstation_id` trong payload phải trùng định danh trên topic; máy phải tồn tại và `enrolled`. Sai thì bỏ qua, không trả lời, ghi log |
| Ghi trạng thái | `workstation_statuses`: `online`, `last_heartbeat_at`, `boot_id`; heartbeat ghi thêm `trust_state`, `clock_skew_detected`, `last_apply_error` do máy báo; Hello không mang các trường này nên giữ giá trị cũ và tự tính lệch giờ từ `local_time` (> 60s) |
| Version | `sync_states.acked_version` = đúng version máy báo, kể cả khi nhỏ hơn trước (máy dựng lại `edge.db`) |
| Profile | Tên mới trong `profiles` được thêm vào `workstation_profiles` (`enabled`; tên đầu tiên thành mặc định nếu máy chưa có mặc định) kèm event `WorkstationProfilesDiscovered {added}`. Profile đã biết giữ nguyên cờ của Admin; profile máy không còn báo **không** bị xóa |
| Reboot | `boot_id` khác giá trị đang lưu ⇒ `reconcile_state = Draining` (XINV-008) |
| Hello | Vô hiệu hóa `fetch_code` của các yêu cầu đăng ký đã duyệt của máy (D-014.4); `key_version` khác Server thì ghi log cảnh báo |
| Trả lời | Version máy báo = `desired_version` (≥ 1) ⇒ lease. Khác ⇒ reconcile (cấp bản đầu, hoặc nhảy qua version máy đang đi trước, D-016) rồi publish snapshot mới nhất (retained). Heartbeat lệch version chỉ được gửi lại snapshot tối đa 1 lần/60s mỗi máy; Hello luôn được trả lời |
| Offline | Mỗi 30s Server chuyển `offline` các máy `online` quá 90s không có heartbeat (BR-019) |

Snapshot version mới do worker cấp được publish ngay (retained). Publish thất bại hoặc broker đang đứt thì bỏ qua, không xếp hàng: Hello kế tiếp của máy sẽ nhận lại.

### 4.2. Lease (`lease-v1`)
Chỉ gửi khi `snapshot_version` máy báo bằng `desired_version`, trả lời từng Hello/heartbeat.

```json
{
  "schema": "lease-v1",
  "workstation_id": "ws-01",
  "desired_version": 13,
  "server_time": 1793049323.96,
  "lease_duration_sec": 86400,
  "nonce": "c41b0e7a92d35f8816a4e0b2c9d7f351"
}
```
Edge chỉ nhận khi chữ ký đúng, `desired_version` bằng version cục bộ và `nonce` là một trong 3 `lease_nonce` gần nhất đã gửi, chưa dùng (D-028.2); khi đó gia hạn như snapshot. `server_time` dùng để phát hiện lệch giờ (`clock_skew_detected` khi lệch > 60s, không chặn) (D-018), và để neo lại mốc sàn: giờ máy nhỏ hơn mốc sàn, lệch `server_time` ≤ 60s và nonce sinh ≤ 120s trước thì `trusted_until`/`last_sync_local_time` đặt lại theo giờ máy hiện tại (D-029).

### 4.3. Outbox ACK (`ack-v1`)
```json
{ "schema": "ack-v1", "command": "ack_outbox", "workstation_id": "ws-01", "batch_id": "3f1c9a0d5e7b42a8b6c4d2e0f1a3b5c7", "acked_seq": 103 }
```
ACK nhắc lại `batch_id` của lô. Edge chỉ nhận ACK có `batch_id` trùng lô đang chờ và xóa `outbox_seq <= min(acked_seq, to_seq của lô đó)`; ACK khác (đến muộn, phát lại, của lần gửi trước khi mất kết nối) không xóa gì (INV-013, D-030). Mất ACK thì sau 60s Edge gửi lại lô với `batch_id` mới; Server bỏ mục trùng theo `entry_id`.

---

## 5. Domain Event Nội Bộ Server

Không đi ra ngoài Server. Được ghi vào `server_outbox` **cùng giao dịch** với thay đổi nghiệp vụ, worker đọc bằng `FOR UPDATE SKIP LOCKED` rồi tính lại tập máy bị ảnh hưởng và dựng snapshot (XINV-005, `schedule-sync.md`).

| Event | Phát bởi | Máy bị ảnh hưởng (Distribution tính) |
|---|---|---|
| `UserUpdated`, `UserDeactivated`, `UserActivated` | Identity | Máy có Schedule mà user là subject trực tiếp hoặc qua nhóm |
| `GroupMembershipChanged` | Identity | Máy có Schedule với subject là nhóm đó |
| `CardBound`, `CardUnbound`, `CardDisabled`, `CardEnabled` | Identity | Như `UserUpdated` của chủ thẻ (cũ và mới) |
| `ScheduleCreated`, `ScheduleUpdated`, `ScheduleEnabled`, `ScheduleDisabled`, `ScheduleDeleted` | Scheduling | Máy là target hoặc thuộc zone target (cả giá trị cũ và mới khi sửa) |
| `WorkstationZoneChanged`, `ZoneDeleted` | Device | Máy đổi zone / mọi máy của zone |
| `WorkstationProfileConfigured`, `WorkstationProfilesDiscovered` | Device | Chính máy đó |
| `WorkstationEnrollmentApproved` | Device | Chính máy đó (snapshot đầu tiên hoặc sau cài lại với `key_version` mới) |
| ~~`WorkstationDisabled`~~ | Device | Không phát (D-024.2): vô hiệu hóa máy không đổi snapshot; thu hồi chứng chỉ, CRL và khởi động lại broker chạy trực tiếp sau khi commit |

Payload mang đủ dữ liệu để worker tìm máy bị ảnh hưởng cả khi bản ghi gốc đã đổi hoặc đã bị xóa:

- `ScheduleCreated`: `{after: {target_type, target_workstation_id, target_zone_id}}`; `ScheduleDeleted`: `{before: {…}}` cùng dạng.
- `ScheduleUpdated`: `{before, after}` chỉ gồm các cột đã đổi (target không đổi thì worker đọc target hiện tại từ bảng `schedules`).
- `ScheduleEnabled`, `ScheduleDisabled`: `{}`.
- `ZoneDeleted`: `{workstation_ids: [...]}` (các máy vừa bị gỡ zone); zone không có máy thì không phát event.
- `WorkstationZoneChanged`: `{before: {zone_id}, after: {zone_id}}` (`null` = không thuộc zone).
- `WorkstationProfileConfigured`: `{os_username, before, after}`, `before`/`after` chỉ gồm `status` và/hoặc `is_default` đã đổi.
- Thao tác không làm đổi dữ liệu (PATCH cùng giá trị, bật lịch đang bật) không phát event.

**Worker (D-023):** một vòng lặp trong tiến trình Server, nhịp 2s (cửa sổ gộp). Mỗi nhịp nhận các event `pending` bằng `FOR UPDATE SKIP LOCKED`; có event thì reconcile **mọi máy `enrolled`** rồi đánh dấu `processed` (MVP chưa dùng payload để thu hẹp tập máy). Ngoài ra reconcile toàn bộ lúc khởi động và mỗi giờ (EF-4). Lỗi CSDL giữa chừng: event vẫn `pending`, thử lại ở nhịp sau. Một máy không dựng được snapshot (quá 1 MB, không giải mã được UID) không chặn máy khác: event vẫn được đánh dấu `processed`, lỗi ghi log và hiện ở `/system/health` (`snapshot_build_failed`) cho tới lần reconcile thành công. `SNAPSHOT_WORKER=off` tắt vòng lặp. Publish snapshot qua MQTT thuộc M3; thu hồi chứng chỉ không đi qua outbox (D-024.2).

Khung bản ghi `server_outbox`:
```json
{
  "aggregate_type": "schedule",
  "aggregate_id": "3a9d5e10-...",
  "event_type": "ScheduleUpdated",
  "payload": {"before": {"target_zone_id": "z-1"}, "after": {"target_zone_id": "z-2"}},
  "created_at": "2026-11-11T09:30:00Z"
}
```

## 6. Bảo Đảm Giao Nhận

| Khía cạnh | Chiến lược |
|---|---|
| Thứ tự | Outbox theo `outbox_seq`, một lô chờ ACK tại một thời điểm; trong một máy giữ đúng thứ tự. Snapshot/lease không cần thứ tự nhờ quy tắc version và nonce |
| Giao nhận | At-least-once (QoS 1) cho Hello, Outbox, Snapshot, Lease, ACK; heartbeat QoS 0 vì nhịp sau bù nhịp trước |
| Idempotency | Server: `entry_id` (audit, session, alert). Edge: version snapshot, `acked_seq` lũy tiến, nonce của lease |
| Dead letter | Server: `ingest_rejects` (mục outbox không áp dụng được, vẫn ACK). Edge: không có, bản tin lỗi bị bỏ và báo qua `last_apply_error` |
| Bản tin đã gửi | Bất biến; sửa dữ liệu = phát snapshot version mới |
