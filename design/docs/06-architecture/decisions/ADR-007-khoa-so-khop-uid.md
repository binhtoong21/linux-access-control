# ADR-007: Khóa so khớp UID thẻ và phạm vi lưu UID gốc

## Metadata

| Field | Value |
|-------|-------|
| **Status** | Proposed |
| **Date** | 2026-10-16 |
| **Deciders** | Bình |
| **Supersedes** | Không |

## Context

UID thẻ NFC là định danh duy nhất để đăng nhập. Ba nhu cầu va chạm nhau:

- **Admin cần thấy UID gốc** ở trang chi tiết thẻ và nhật ký: gỡ lỗi đầu đọc (byte thừa, thiếu, đảo thứ tự), đối soát thẻ vật lý, tra một thẻ nhặt được.
- **NFR-SEC03** yêu cầu UID không lưu dạng thô ở server và snapshot chỉ chứa dữ liệu cần thiết.
- **PC phải so khớp UID quẹt vào với snapshot** ngay tại chỗ, không hỏi server (BR-005).

Liên quan: INV-001, INV-012, VR-002, VR-007, NFR-SEC03, NFR-P01, NFR-C02; domain-model (`Card.uid`, `SnapshotContent`, `AuditLog.card_uid`); ADR-001, ADR-003, ADR-004.

## Decision Drivers

- Admin thấy được UID gốc khi cần (gỡ lỗi, đối soát, tra cứu).
- CSDL server và bản sao lưu bị lộ không làm lộ UID.
- Snapshot và file cục bộ không chứa UID thô; một máy bị chiếm chỉ lộ dữ liệu của chính máy đó (NFR-SEC03).
- Quẹt thẻ tức thì (NFR-P01): so khớp không được tốn chi phí đáng kể.
- INV-001: tra cứu và kiểm tra trùng UID toàn hệ thống phải làm được dù UID được mã hóa.
- Domain model không phụ thuộc thuật toán; chi tiết mật mã nằm ở 06/07.
- Vận hành đơn giản: số khóa cần quản lý nhỏ.

## Options Considered

### Option 1: UID thô ở mọi nơi

**Mô tả:** Server, snapshot, nhật ký đều lưu UID thô; bảo vệ bằng TLS và quyền file.

| Pros | Cons |
|------|------|
| Đơn giản nhất, gỡ lỗi dễ | Vi phạm NFR-SEC03 theo câu chữ |
| | Lộ CSDL, bản sao lưu hoặc snapshot là lộ mọi UID |

### Option 2: Server mã hóa khi lưu, snapshot chứa UID thô (đã tối thiểu hóa theo máy)

**Mô tả:** Như Option 1 nhưng CSDL mã hóa UID; snapshot vẫn mang UID thô của các thẻ liên quan tới máy.

| Pros | Cons |
|------|------|
| Agent đơn giản; gỡ lỗi ở PC dễ | Bản sao snapshot (sao lưu đĩa, báo lỗi, ảnh đĩa) lộ UID thô |
| Thỏa NFR-SEC03 ở phía server | Ngoài quyền file root, snapshot không có thêm lớp bảo vệ nào |

### Option 3: Server mã hóa và có chỉ mục mù; snapshot chứa khóa so khớp theo máy

**Mô tả:** Server lưu UID mã hóa kèm chỉ mục mù. Snapshot không chứa UID mà chứa `match_key` = HMAC của UID bằng khóa riêng của từng máy. Agent tính `match_key` từ UID vừa quẹt rồi tra snapshot. Nhật ký mang UID của lần quẹt.

| Pros | Cons |
|------|------|
| CSDL hoặc bản sao lưu bị lộ không lộ UID | Nhiều khóa cần quản lý (khóa gốc, mã hóa, chỉ mục, khóa theo máy) |
| Snapshot và bản sao đĩa của máy A vô dụng ở máy B; không file nào ở PC chứa UID thô | Server tính HMAC cho từng cặp (thẻ, máy) khi dựng snapshot |
| Admin vẫn thấy UID gốc | UID ngắn vẫn dò ngược được nếu có khóa của máy |
| Quẹt thẻ chỉ thêm một phép HMAC | Log cục bộ của Agent không còn UID để đọc |

### Option 4: Option 3 cộng băm chậm (hàm dẫn xuất khóa có chi phí)

**Mô tả:** `match_key` tính bằng hàm băm tốn kém (chi phí cấu hình được) để dò ngược 2^32 giá trị đắt đỏ.

| Pros | Cons |
|------|------|
| Dò ngược UID 4 byte tốn năm CPU thay vì phút | Mỗi lần quẹt thêm hàng chục đến hàng trăm mili giây trên máy cũ (NFR-P01) |
| | Chi phí dựng snapshot nhân lên theo (thẻ × máy) |
| | Không cân xứng với MVP |

### Option 5: Khóa HMAC dùng chung cho mọi máy

**Mô tả:** Như Option 3 nhưng một khóa chung.

| Pros | Cons |
|------|------|
| Server chỉ tính một hash cho mỗi thẻ | Root ở một máy lấy được khóa chung, dò ngược được snapshot của mọi máy |
| | Mất tác dụng khoanh vùng |

## Decision

Chọn **Option 3**, có phiên bản sơ đồ (`uid_scheme`) để nâng lên Option 4 sau mà không đổi kiến trúc.

1. **UID chuẩn hóa** là hex chữ hoa của dãy byte đầu đọc trả về qua lệnh lấy UID chuẩn PC/SC, 4, 7 hoặc 10 byte, **không đảo byte** (VR-007). Đăng ký thẻ và quẹt thẻ cùng một quy tắc.
2. **Server:** lưu `encrypted_uid` (AES-256-GCM, kèm `key_id` để quay vòng khóa) và `uid_index` = HMAC-SHA256(`K_index`, UID). Khóa mã hóa và khóa chỉ mục tách biệt. Chỉ mục phục vụ kiểm tra trùng (INV-001, VR-002), tìm thẻ theo UID và đối chiếu nhật ký. Server giải mã khi admin xem trang chi tiết thẻ hoặc nhật ký.
3. **Snapshot:** `match_key` = HMAC-SHA256(`K_m`, "uid-match-v1" ‖ UID), với `K_m` = HKDF(khóa gốc, `workstation_id`). `K_m` được cấp cho Agent lúc đăng ký (UC-007) qua TLS và lưu file chỉ root đọc được. Snapshot không chứa UID gốc.
4. **Tại PC:** Agent tính `match_key` từ UID vừa quẹt rồi tra snapshot (CR-001 bước 2).
5. **Nhật ký:** mang `card_uid` của lần quẹt (chuẩn hóa), truyền qua TLS, server mã hóa khi lưu. Lần quẹt lỗi đọc (`invalid_uid`, `reader_error`) ghi thêm `reader_raw` (hex, cắt tối đa số byte cố định) để gỡ lỗi đầu đọc.
6. **Quay vòng khóa:** `K_m` đổi khi đăng ký lại máy (UC-007 AF-1), kéo theo snapshot mới. Khóa mã hóa quay vòng nhờ `key_id`.
7. **Phạm vi bảo vệ tuyên bố (D-013):** UID là định danh công khai (Public Identifier), không phải bí mật chia sẻ (Shared Secret). Lớp bảo vệ thực chất trước sinh viên (người dùng không đặc quyền) tại máy trạm là quyền file hệ thống (`0600 root:root` trên file SQLite WAL) và đường truyền TLS. Cơ chế HMAC per-machine (`K_m`) chỉ đóng vai trò khoanh vùng thiệt hại (blast-radius reduction) nếu đĩa cứng bị trích xuất offline mà kẻ tấn công không có khóa của máy khác; tuyệt đối không tuyên bố che UID khỏi người đã có quyền root trên chính máy đó (do không gian UID 4 byte dễ bị vét cạn).

Domain model giữ trừu tượng: thêm Value Object `CardMatchKey` (khóa so khớp thẻ trong snapshot), còn thuật toán nằm ở ADR này.

## Consequences

### Positive

- Lộ CSDL hoặc sao lưu không lộ UID; không file nào trên PC chứa UID thô.
- Snapshot hoặc ảnh đĩa của một máy không dùng được ở máy khác.
- Admin có UID gốc để gỡ lỗi, đối soát, tra thẻ nhặt được.
- Quẹt thẻ chỉ thêm một phép HMAC, không ảnh hưởng độ trễ.
- Nội dung snapshot vẫn chuẩn tắc (hash xác định), nên phép "nội dung không đổi thì không tăng version" của `schedule-sync` vẫn đúng.

### Negative

- Vòng đời khóa phức tạp hơn: khóa gốc, mã hóa, chỉ mục, khóa theo máy, và quay vòng.
- Dựng snapshot tính HMAC theo từng cặp (thẻ, máy); với reconcile mọi máy cần cache theo (UID, khóa máy) để rẻ.
- Log cục bộ của Agent chỉ có `match_key`; gỡ lỗi UID thực hiện ở dashboard qua nhật ký.

### Risks

- **Dò ngược UID ngắn:** ai có `K_m` và danh sách hash dò được UID 4 byte trong vài phút. Chấp nhận trong khuôn NFR-SEC03; nâng cấp bằng `uid_scheme` (Option 4) nếu cần.
- **UID không phải bí mật và nhân bản được:** đọc được ở khoảng cách ngắn và ghi lên thẻ "magic". Hệ thống xác thực việc *sở hữu UID*, không chứng minh thẻ thật. Ngoài phạm vi (phần cứng là Non-Goal); hướng mở rộng là thẻ có xác thực mật mã.
- **Bảo vệ khi lưu chỉ chống lộ CSDL và sao lưu**, không chống kẻ có quyền trên server (có cả khóa mã hóa). Mất khóa mã hóa là mất UID gốc (chỉ còn chỉ mục): phải sao lưu khóa riêng.
- **Root ở PC vẫn thấy UID các lần quẹt kế tiếp** (qua đầu đọc và outbox). Chấp nhận (NFR-SEC03).
- **Đầu đọc đảo byte:** hai dòng đầu đọc trả thứ tự khác nhau cho cùng một thẻ thì thẻ đăng ký ở một nơi không khớp ở nơi khác. Giảm thiểu: một dòng đầu đọc thống nhất (NFR-C02), chuẩn hóa theo lệnh PC/SC chuẩn, `reader_raw` để chẩn đoán.
