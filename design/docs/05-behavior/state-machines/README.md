# 🔄 State Machines

## Mục đích
Vòng đời các thực thể có trạng thái. Hai máy trạng thái nằm trong sequence tương ứng: **LocalSession** ở `session-expiry.md`, **trạng thái tin cậy của Agent** ở `lease-expiration.md`. File này gồm phần còn lại.

## 1. Card (INV-006)

```mermaid
stateDiagram-v2
    [*] --> Active: Đăng ký UID kèm chủ (CardBound)
    Active --> Disabled: Khóa thẻ (CardDisabled)
    Disabled --> Active: Bật lại (CardEnabled)
    Active --> Unbound: Gỡ liên kết (CardUnbound)
    Disabled --> Unbound: Gỡ liên kết (CardUnbound)
    Unbound --> Active: Gắn cho một user (CardBound)
```

- `unbound ⇔ owner rỗng`. Thẻ `unbound` không cho vào (XINV-002).
- Gắn lại từ `unbound` luôn thành `active`, không giữ `disabled` cũ.
- Vô hiệu hóa **user** không đổi trạng thái thẻ (XINV-001); việc chặn do bước 3 của CR-001.
- Mọi chuyển trạng thái phát event cho Distribution (XINV-005); hiệu lực ở PC sau khi nhận snapshot mới (BR-010).

## 2. EnrollmentToken (INV-010, BR-018)

```mermaid
stateDiagram-v2
    [*] --> Active: Admin tạo token
    Active --> Revoked: Admin thu hồi
    Revoked --> [*]
```

Trạng thái lưu chỉ có `active` và `revoked`. **Dùng được** là hàm tính ra tại thời điểm dùng:

`usable = (status = active) ∧ (chưa quá expires_at) ∧ (số lượt dùng < max_uses)`

Dashboard hiển thị: `Dùng được`, `Hết hạn`, `Hết lượt`, `Đã thu hồi` (tính ra, FR-043). Một lần đăng ký thành công tiêu thụ đúng một lượt trong cùng thao tác phê duyệt cấp định danh (XINV-009). Nếu yêu cầu đăng ký bị trùng MAC, token được giữ nguyên chưa tiêu thụ cho đến khi Admin phê duyệt. `revoked` là trạng thái cuối, không bật lại.

## 3. WorkstationStatus: kết nối (BR-019)

```mermaid
stateDiagram-v2
    [*] --> Offline: WorkstationEnrollmentApproved
    Offline --> Online: Hello hoặc heartbeat (WorkstationWentOnline)
    Online --> Offline: Bỏ lỡ quá số heartbeat quy định (WorkstationWentOffline)
    Online --> Online: Heartbeat làm mới last_heartbeat
```

- Hello có `boot_id` khác lần trước thì phát `WorkstationRebooted` ở **mọi** trường hợp (cả `Offline → Online` lẫn `Online → Online` khi máy khởi động nhanh hơn ngưỡng offline), rồi vào đối soát bên dưới.
- Phát hiện từ Last Will (nếu ADR chọn dùng) chỉ là gợi ý rút ngắn thời gian vào `Offline`; heartbeat vẫn là nguồn sự thật.
- Máy chưa từng kết nối giữ `Offline` với `last_heartbeat` rỗng; dashboard hiển thị "chưa từng kết nối".

## 3b. Đối soát sau reboot (phía server, theo từng máy)

```mermaid
stateDiagram-v2
    [*] --> Idle
    Idle --> Draining: Hello có boot_id mới (WorkstationRebooted)
    Draining --> Idle: Outbox hết hoặc quá thời gian chờ
```

Khi `Draining → Idle`, các Session `active` còn lại của boot cũ chuyển `abandoned` (`workstation_rebooted`, `end_source = inferred`, `ended_at = max(started_at, lần cuối nghe từ máy ở boot cũ)`). Phiên Agent đã báo kết thúc giữ nguyên báo cáo (XINV-008 đã sửa).

## 4. SyncState (FR-054)

```mermaid
stateDiagram-v2
    [*] --> PendingSync: Snapshot đầu tiên được dựng (desired = 1, acked = 0)
    PendingSync --> InSync: acked_version bằng desired_version
    InSync --> PendingSync: Snapshot mới được dựng (desired tăng)
    PendingSync --> PendingSync: Snapshot mới hơn được dựng tiếp
```

- `InSync` và `PendingSync` là **hàm của hai số** (`acked_version` so với `desired_version`), không phải cờ lưu riêng, nên không có chuyện lệch cờ.
- **`Stuck` (suy ra):** `PendingSync` kéo dài quá ngưỡng trong khi máy `Online`. Dấu hiệu snapshot bị từ chối; dashboard hiển thị `last_apply_error` từ heartbeat.
- Nhãn "đã đồng bộ" chỉ đáng tin khi không còn sự kiện thay đổi nào chưa được xử lý (cửa sổ giữa commit và reconcile).
- Tham số chốt sau: ngưỡng `Stuck`.

## Các thực thể còn lại (không cần sơ đồ)
| Thực thể | Trạng thái | Ghi chú |
|---|---|---|
| User | `active` ⇄ `inactive` | Không xóa cứng (XINV-001, BR-014) |
| EnrollmentRequest | `pending` → `approved` / `rejected` | Tạo khi Agent nộp yêu cầu; trùng MAC giữ pending chờ Admin duyệt |
| Workstation | `enrolled` ⇄ `disabled` | Tạo/kích hoạt sau khi EnrollmentRequest được duyệt |
| WorkstationProfile | `enabled` ⇄ `disabled` | Tự phát hiện mặc định `enabled`; profile đầu tiên nhận `is_default = true` |
| Schedule | `enabled` ⇄ `disabled`, xóa được | Tắt thì bị bỏ qua khi đánh giá (BR-016) |
| AdminAccount | `active` ⇄ `disabled` | `disabled` không đăng nhập được (INV-016) |
| Session (server) | `active` → `completed` / `forced_logout` / `abandoned` | Nhận từ báo cáo của Edge; trạng thái cuối không đảo ngược (INV-007); xem LocalSession ở `session-expiry` |
