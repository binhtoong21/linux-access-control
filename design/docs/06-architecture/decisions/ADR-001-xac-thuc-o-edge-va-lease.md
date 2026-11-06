# ADR-001: Xác thực ở edge, dữ liệu cục bộ có thời hạn tin cậy (lease)

## Metadata

| Field | Value |
|-------|-------|
| **Status** | Proposed |
| **Date** | 2026-10-16 |
| **Deciders** | Bình. Cần thầy xác nhận: giá trị lease `D` và việc tin RTC sau khi khởi động lại lúc offline |
| **Supersedes** | Không |

## Context

PC tại phòng máy phải cho đăng nhập bằng thẻ NFC theo lịch do server quản lý (G1, G2). Đề bài yêu cầu PC giữ dữ liệu lịch cục bộ và tự quyết định, không phụ thuộc server tại thời điểm quẹt thẻ (G4, BR-005). Ba áp lực kéo ngược nhau:

- Server hoặc mạng sập không được làm mọi đầu đọc thẻ vô dụng (NFR-A01).
- Dữ liệu cục bộ không được tin vô thời hạn: máy mất liên lạc lâu vẫn cho vào theo lịch cũ thì việc thu hồi quyền mất ý nghĩa (BR-010).
- Máy chạy offline không có nguồn thời gian đáng tin ngoài RTC, trong khi mọi khung giờ và thời hạn đều dựa vào thời gian.

Liên quan: BR-004, 005, 006, 010, 011, 012; FR-002, 055, 056; NFR-A01 đến A04, NFR-SEC03; INV-011; XINV-007, XINV-010. Các sequence `swipe-login`, `reconnect`, `lease-expiration`, `reboot` đã khám phá hành vi; ADR này chốt quyết định kiến trúc.

## Decision Drivers

- Server sập thì PC vẫn cho đăng nhập trong một thời hạn xác định (NFR-A01).
- Quẹt thẻ cho kết quả gần như tức thì, không qua mạng (NFR-P01).
- Mọi phiên gắn với một người cụ thể, mọi lần quẹt có bản ghi (G1, BR-007).
- Mức phơi nhiễm của việc thu hồi trên máy offline phải có cận trên, cấu hình được.
- Một đường quyết định duy nhất, kiểm thử được (CR-001 là hàm thuần trên dữ liệu cục bộ).
- Máy không bao giờ bị khóa chết: đường dự phòng luôn có (BR-004).
- Rủi ro mức root cục bộ được chấp nhận (NFR-SEC03); thiết kế chống sai lệch và lỗi thường gặp, không chống kẻ có root.

## Options Considered

### Option 1: Server quyết định mỗi lần quẹt

**Mô tả:** PC gửi UID lên server, server đánh giá và trả kết quả.

| Pros | Cons |
|------|------|
| Dữ liệu luôn mới, thu hồi có hiệu lực tức thì | Server hoặc mạng sập thì không ai đăng nhập được (vi phạm NFR-A01, G4) |
| Không cần lưu dữ liệu nhạy cảm ở PC | Quẹt thẻ chịu độ trễ mạng (NFR-P01) |
| | Trái ràng buộc đề bài: PC tự quyết định |

### Option 2: Lai: hỏi server trước, mất liên lạc thì dùng bản cục bộ

**Mô tả:** Agent hỏi server; không phản hồi trong thời gian chờ thì đánh giá bằng snapshot cục bộ.

| Pros | Cons |
|------|------|
| Thu hồi tức thì khi online | Hai đường quyết định phải nhất quán, khó kiểm thử |
| Vẫn đăng nhập được khi server sập | Mạng chập chờn gây timeout trên đường quẹt thẻ và hành vi mơ hồ giữa hai đường |
| | Vẫn cần snapshot cục bộ và vẫn phải trả lời "tin bao lâu", nên không bỏ được lease |
| | Trái BR-005 |

### Option 3: Edge quyết định, dữ liệu cục bộ tin vô thời hạn

**Mô tả:** Agent đánh giá từ snapshot cục bộ, không có thời hạn.

| Pros | Cons |
|------|------|
| Đơn giản nhất, offline bao lâu cũng chạy | Máy mất liên lạc vĩnh viễn vẫn cho vào theo lịch cũ |
| | Thu hồi thẻ hoặc user không bao giờ có hiệu lực trên máy offline |

### Option 4: Edge quyết định, dữ liệu có thời hạn tin cậy (lease)

**Mô tả:** Như Option 3, nhưng Agent chỉ tin snapshot khi còn trong lease. Quá hạn hoặc đồng hồ không đáng tin thì từ chối mọi lần quẹt với `data_stale`; đường dự phòng vẫn dùng được.

| Pros | Cons |
|------|------|
| Một đường quyết định, tức thì, offline được | Thu hồi trên máy offline có độ trễ tối đa `D` |
| Phơi nhiễm của việc thu hồi có cận trên cấu hình được | Máy offline quá `D` thì thẻ ngừng dùng được, chỉ còn dự phòng |
| Hợp ràng buộc đề bài | Cần thêm logic gia hạn và kiểm tra đồng hồ ở Agent |

### Quyết định con 1: Cơ chế gia hạn lease

| Phương án | Pros | Cons |
|-----------|------|------|
| Chỉ làm mới khi nhận snapshot mới | Đơn giản | Lịch không đổi vài ngày thì máy online bình thường vẫn hết hạn (lỗ hổng BR-006) |
| Server phát lại snapshot cùng phiên bản định kỳ | Không thêm loại thông điệp | Tốn băng thông, phải nới luật "chỉ nhận phiên bản lớn hơn", không chứng minh máy đang cập nhật |
| Agent tự gia hạn khi còn kết nối MQTT | Không cần server trả lời | Kết nối không bằng dữ liệu mới; Agent tự cấp quyền cho mình |
| `D` rất lớn | Ít phải gia hạn | Mất ý nghĩa của lease |
| **Gia hạn qua phản hồi heartbeat** | Dùng kênh sẵn có; chỉ gia hạn khi máy đúng `desired_version`, máy tụt thì nhận snapshot; chứng minh một vòng liên lạc thật | Heartbeat mang ngữ nghĩa giao thức (ADR-002); phản hồi gia hạn phải được xác thực |

### Quyết định con 2: Đồng hồ cho lease và lịch

| Phương án | Pros | Cons |
|-----------|------|------|
| Chỉ giờ hệ thống | Đơn giản, sống qua khởi động lại | Pin RTC chết, NTP lệch hoặc đổi giờ làm lease và lịch sai |
| Chỉ đồng hồ đo | Không bị đổi giờ | Reset khi khởi động lại, không khớp khung giờ tuyệt đối |
| **Kết hợp: hạn UTC bền vững cho lease, đồng hồ đo CLOCK_BOOTTIME cho phiên** | Bắt đổi giờ trong phiên và phát hiện RTC lùi về quá khứ; không phụ thuộc NTP | Cần hai cơ chế đồng hồ riêng biệt |
| Bắt buộc xác minh với server sau mỗi lần khởi động | An toàn nhất | Server sập cộng mất điện thì mọi đầu đọc vô dụng (vi phạm NFR-A01) |

## Decision

Chọn **Option 4** với hai quyết định con **gia hạn qua phản hồi heartbeat** và **đồng hồ kết hợp**. Lý do: đây là phương án duy nhất vừa thỏa NFR-A01 và ràng buộc đề bài, vừa cho thu hồi một cận trên xác định. Cụ thể:

1. **Quyết định ở Agent, một đường duy nhất.** Agent đánh giá theo CR-001 từ snapshot cục bộ, không hỏi server khi quẹt (BR-005).
2. **Trạng thái tin cậy là hàm tính lại mỗi lần cần**, không phải biến lưu: `đáng tin = có snapshot ∧ còn hạn ∧ đồng hồ hợp lý`. Không đáng tin thì `denied(data_stale)` kèm chi tiết `no_data`, `lease_expired` hoặc `clock_invalid`; người dùng thấy một lý do chung và hướng dẫn dùng đường dự phòng.
3. **Lease `D` do server cấp, tính từ lúc Agent nhận.** Làm mới bằng snapshot hợp lệ, hoặc bằng xác nhận gia hạn trong phản hồi heartbeat khi phiên bản máy bằng `desired_version`. Máy tụt phiên bản thì nhận snapshot thay vì gia hạn. Phản hồi gia hạn mang `server_time` và `D`.
4. **Tách biệt bộ đếm phiên và hạn dữ liệu (D-012):**
   - **Thời lượng phiên (Session Timer):** Bắt buộc dùng đồng hồ đơn điệu `CLOCK_BOOTTIME` để đếm thời gian kể từ lúc boot. Timer này không bị kéo dài hay rút ngắn khi người dùng hoặc NTP thay đổi giờ hệ thống (`settimeofday`).
   - **Hạn dữ liệu (Snapshot Lease):** Hạn UTC tuyệt đối `trusted_until` bền vững qua các lần khởi động lại.
5. **Đồng hồ hợp lý và mốc sàn cải tiến (D-012, Điểm 8):** Loại bỏ cơ chế mốc sàn xác minh ghi đĩa liên tục gây hao mòn SSD. Thay bằng quy tắc thực tế:
   - (a) Giờ hệ thống không được nhỏ hơn mốc sàn: `local_time >= floor`, trong đó `floor = max(snapshot.created_at, last_server_time) - CLOCK_FLOOR_TOLERANCE` (với `CLOCK_FLOOR_TOLERANCE = 60s`). Giá trị `last_server_time` được lưu bền vững cùng bản ghi với `trusted_until` mỗi lần gia hạn lease (không phát sinh I/O đĩa riêng). Mốc sàn luôn tiến theo thời gian thực và có dung sai 60 giây cho cả hai vế. Nếu `local_time < floor`, xác định pin CMOS bị kiệt làm đồng hồ quay về quá khứ (1970 hoặc năm sản xuất mainboard) → từ chối `data_stale (clock_invalid)`.
   - (b) Khi kết nối với server, Agent đối chiếu với `server_time` trong Heartbeat. Nếu |giờ hệ thống − `server_time`| > `CLOCK_SKEW_WARN_THRESHOLD` (60s), Agent gửi cờ cảnh báo `clock_skew_detected` lên dashboard để kỹ thuật viên can thiệp. Agent vẫn chấp nhận gia hạn lease. Cờ NTP của OS chỉ để báo cáo, không làm điều kiện cổng. Agent không tự chỉnh giờ OS.
6. **Khởi động lại khi offline:** Đồng hồ được tin nếu `local_time >= floor` và `local_time <= trusted_until`. Cho phép quẹt thẻ bình thường theo lịch đã cache.
7. **Lease chỉ chặn lần quẹt mới.** Phiên đang chạy không bị ảnh hưởng (BR-006) và kết thúc theo hạn riêng (BR-009). Thu hồi không buộc đăng xuất (BR-010).
8. **Đường dự phòng độc lập với lease** (BR-004).

Tham số chốt sau, theo thứ tự ưu tiên: `D` (gợi ý bắt đầu từ 24 giờ, cân giữa thời gian server được phép sập và cửa sổ thu hồi trên máy offline), dung sai mốc sàn đồng hồ `CLOCK_FLOOR_TOLERANCE` (60s), ngưỡng cảnh báo lệch đồng hồ `CLOCK_SKEW_WARN_THRESHOLD` (60s), chu kỳ heartbeat và số lần bỏ lỡ.

## Consequences

### Positive

- Server sập vẫn đăng nhập được trong `D`; quẹt thẻ tức thì.
- Phơi nhiễm của việc thu hồi trên máy offline có cận trên cấu hình được, không còn là "vô hạn".
- CR-001 là hàm thuần trên dữ liệu cục bộ nên kiểm thử đầy đủ không cần server hay mạng.
- Chịu được hai lỗi thực tế hay gặp ở phòng máy: chớp điện làm máy khởi động lại khi offline, và pin RTC chết.
- Thu hồi, tụt phiên bản, mất ack đều tự lành qua cùng một vòng heartbeat.

### Negative

- Thu hồi thẻ hoặc user trên máy offline trễ tối đa `D`, và chỉ có hiệu lực khi PC nhận snapshot mới (BR-010).
- Máy offline quá `D` thì thẻ ngừng dùng được; chỉ còn đăng nhập dự phòng.
- Agent mang dữ liệu nhạy cảm nằm ở máy (NFR-SEC03: root đọc được).
- Heartbeat trở thành một phần giao thức có ngữ nghĩa; ADR-002 phụ thuộc quyết định này.

### Risks

- **Đồng hồ chạy tới khi offline sau reboot** không bị phát hiện: người có quyền chỉnh BIOS có thể vào ca sớm hơn, chỉ trong phạm vi quyền sẵn có trong snapshot và trước `trusted_until`. Giảm thiểu: khuyến nghị đặt mật khẩu BIOS (11-operations); tùy chọn cờ `clock_anomaly` khi nạp nhật ký (`occurred_at` ở tương lai so với `received_at`, hoặc không đơn điệu theo `outbox_seq`).
- **Chọn `D` sai:** quá ngắn thì server sập là thẻ ngừng dùng được; quá dài thì thu hồi chậm. Cần xin ý kiến thầy trước khi chốt.
- **Phản hồi gia hạn giả** (broker bị chiếm) kéo dài lease. Giảm thiểu: TLS và ACL theo máy (ADR-002); việc ký snapshot và phản hồi xét ở ADR-003.
- **Lỗi reconcile hoặc SyncState** làm máy tụt phiên bản vĩnh viễn nên không bao giờ được gia hạn. Giảm thiểu: trạng thái `Stuck` và `last_apply_error` trong heartbeat hiện lên dashboard.
