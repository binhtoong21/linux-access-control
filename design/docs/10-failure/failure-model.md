# 💥 Failure Model

> Tổng hợp các tình huống hỏng hóc và cách hệ thống phản ứng. Nguyên tắc chung, theo thứ tự ưu tiên:
> 1. **Không tự khóa.** Máy luôn còn đường đăng nhập dự phòng (BR-004); hỏng một thành phần không được làm cả phòng máy không dùng được.
> 2. **Không cho sai người vào.** Nghi ngờ thì từ chối thẻ (fail-closed), nhưng không chặn đường dự phòng.
> 3. **Không mất dấu vết.** Nhật ký ghi bền trước khi trả quyết định; mất mát nào cũng phải để lại dấu hiệu nhìn thấy được.
>
> Chi tiết hành vi nằm ở các sequence trong `05-behavior/` và các ADR; bảng dưới chỉ ra chỗ xử lý. Tham số: [11-operations/deployment.md](../11-operations/deployment.md#bảng-tham-số).

## Failure Modes

**Mức độ:** Cao = cả phòng máy hoặc quyết định sai; Trung bình = một máy hoặc mất tính năng phụ; Thấp = chỉ ảnh hưởng hiển thị.

### Edge (máy trạm)
| # | Thành phần | Hỏng thế nào | Ảnh hưởng | Khả năng | Mức độ | Xử lý | Nguồn / bằng chứng |
|---|---|---|---|---|---|---|---|
| E1 | Agent | Chết, treo | Không quẹt thẻ được trên máy đó | Thấp | Trung bình | PAM hết thời gian 3s thì `PAM_IGNORE`, rơi về mật khẩu; systemd khởi động lại Agent; khi lên lại đối chiếu phiên theo bảng recovery | ADR-005, S2, `swipe-login.md` |
| E2 | Custom Greeter | Crash lặp | Không có màn hình đăng nhập | Thấp | Cao | Wrapper rơi về `lightdm-gtk-greeter` sau 3 crash/60s; còn TTY/SSH cho kỹ thuật viên | ADR-005, **S10** |
| E3 | Custom Greeter | Treo, không thoát | Màn hình đứng | Rất thấp | Trung bình | Wrapper không bắt được; kỹ thuật viên dùng TTY/SSH (`systemctl restart lightdm`) | S10 (giới hạn) |
| E4 | Nguồn điện | Mất điện giữa lúc quẹt / giữa phiên | Phiên đứt | Trung bình | Thấp | Ghi nguyên tử nhật ký + `pending`; khởi động lại thì `pending` → `discarded`, `active` → `abandoned(workstation_rebooted)` với `ended_at = max(started_at, last_alive_at)` | D-005, `reboot.md`, S5 |
| E5 | `edge.db` | Hỏng tệp | Máy về `NoData` | Rất thấp | Trung bình | Đổi tên tệp hỏng, dựng lại từ `identity/`, cứu outbox, báo `edge_db_recovered`; tự lấy snapshot khi online; phiên OS không rõ nguồn gốc bị kết thúc | D-017, `migrations.md` §3.2 |
| E6 | `identity/` | Hỏng, mất | Máy không xác thực được với broker | Rất thấp | Trung bình | Kỹ thuật viên chạy `nfc-agent reenroll`; Admin duyệt cài lại | D-014.6 |
| E7 | Đồng hồ máy | Pin CMOS chết, lùi giờ | Từ chối quẹt `data_stale(clock_invalid)` | Thấp | Trung bình | Mốc sàn theo giờ máy; cảnh báo lệch giờ lên Dashboard; sửa giờ/NTP là tự hết | D-018, `lease-expiration.md` |
| E8 | Đồng hồ máy | Chạy lệch so với server | Lịch đánh giá lệch theo độ lệch | Trung bình | Thấp | Chỉ cảnh báo `clock_skew_detected`, không chặn (BR-012) | D-018 |
| E9 | Teardown | Tiến trình không chịu thoát | Phiên mới chưa mở được | Thấp | Thấp | `SIGKILL` sau 2s; quá 3s hiện banner, thử thêm tới 5s rồi hủy lượt đăng nhập; phiên chỉ đóng khi OS thật sự hết (INV-017) | ADR-008, S7b |
| E10 | Phiên | Sinh viên quên đăng xuất | Máy bận tới hết phiên | Trung bình | Thấp | Chấp nhận (A4); phiên tự kết thúc ở hạn; kỹ thuật viên đăng xuất thủ công | D-006.1 |
| E11 | Outbox | Mất mạng rất lâu, outbox đầy | Từ chối quẹt thẻ để không mất nhật ký | Rất thấp | Trung bình | Hạn mức 50.000 mục (nhiều tuần với lưu lượng thực tế); Dashboard thấy `pending_outbox_count` | `swipe-login.md` EF-3 |
| E12 | Đầu đọc NFC | Rút ra, lỗi USB | Không quẹt được trên máy đó | Thấp | Trung bình | Bản ghi `error(reader_error)`; đường mật khẩu dự phòng | S1 (một phần) |

### Mạng và Broker
| # | Thành phần | Hỏng thế nào | Ảnh hưởng | Khả năng | Mức độ | Xử lý | Nguồn |
|---|---|---|---|---|---|---|---|
| N1 | Mạng / broker | Mất kết nối < D | Không ảnh hưởng quẹt thẻ | Trung bình | Thấp | Edge quyết định cục bộ; outbox đẩy sau; kết nối lại có backoff + jitter | NFR-A01, `reconnect.md`, S6 |
| N2 | Mạng / broker | Mất kết nối > D (24h) | Máy từ chối mọi thẻ `data_stale(lease_expired)` | Thấp | Cao | Thiết kế có chủ đích (fail-closed, D-002); đường dự phòng vẫn dùng được; có mạng lại thì tự hồi phục ngay | ADR-001 |
| N3 | Broker | 40 máy kết nối lại cùng lúc | Nghẽn broker | Trung bình | Thấp | Backoff mũ có jitter [0.8, 1.2], tối đa 60s | ADR-002 §6 |
| N4 | CRL | Hết hạn hoặc thiếu tệp | Broker từ chối **mọi** máy / không khởi động | Thấp | Cao | CRL hạn 10 năm, sinh lại khi Server khởi động và hằng ngày, cảnh báo < 30 ngày; tệp luôn tồn tại, ghi nguyên tử | **S9**, D-014.5 |
| N5 | Broker | Khởi động lại sau thu hồi chứng chỉ | Mọi máy mất kết nối vài giây | Thấp (vài lần/học kỳ) | Thấp | Máy tự kết nối lại; quẹt thẻ không gián đoạn | S9 |
| N6 | Broker | Bị chiếm | Có thể chặn/phát lại bản tin | Rất thấp | Trung bình | Không giả được snapshot/lease/ACK (HMAC + nonce); chặn bản tin thì máy hết lease sau D (fail-closed) | ADR-003, D-018 |

### Server
| # | Thành phần | Hỏng thế nào | Ảnh hưởng | Khả năng | Mức độ | Xử lý | Nguồn |
|---|---|---|---|---|---|---|---|
| S1 | API / worker | Sập, khởi động lại | Dashboard không dùng được; thay đổi chưa phát | Thấp | Thấp | Edge không phụ thuộc; khi lên lại reconcile mọi máy (`schedule-sync.md` EF-4) | XINV-005 |
| S2 | Server | Sập giữa commit và publish snapshot | Máy chưa nhận thay đổi | Thấp | Thấp | Transactional outbox + reconcile định kỳ | `schedule-sync.md` |
| S3 | Ingest | Một mục outbox không áp dụng được | (Nếu không xử lý) hàng đợi của máy kẹt mãi | Thấp | Cao → Thấp | Savepoint theo mục, mục lỗi vào `ingest_rejects`, vẫn ACK | D-015.2 |
| S4 | Ingest | Báo cáo kết thúc phiên đến sau khi đã suy luận | Lệch trạng thái phiên | Thấp | Thấp | Báo cáo thật thay suy luận đúng một lần | D-015.1 |
| S5 | Ingest | Server còn giữ phiên `active` cũ khi phiên mới tới | (Nếu không xử lý) mọi phiên mới bị từ chối | Rất thấp | Cao → Thấp | Suy luận phiên cũ kết thúc trước khi ghi phiên mới | D-015.3 |
| S6 | CSDL | Hỏng ổ, khôi phục từ bản sao lưu | Mất dữ liệu sau lần sao lưu cuối; version snapshot lùi | Rất thấp | Trung bình | Version: server nhảy lên trên version máy (D-016). Nhật ký đã ACK sau bản sao lưu cuối bị mất (Edge đã xóa) — RPO 24h được chấp nhận | D-016, `deployment.md` |
| S7 | Khóa | Mất `master_key` / khóa CA | Không ký/kiểm được snapshot, không cấp được chứng chỉ | Rất thấp | Cao | Sao lưu khóa riêng, ngoài máy chủ; mất hẳn thì phải dựng lại CA và đăng ký lại mọi máy | `threat-model.md` |
| S8 | Snapshot | Máy liên tục từ chối snapshot (lỗi dữ liệu/`key_version`) | Máy hết lease sau D | Thấp | Trung bình | `last_apply_error` qua heartbeat, cờ `stuck_sync`/`apply_error` trên Dashboard | `lease-expiration.md` EF-6 |

## Dependency Matrix

| Thành phần | Phụ thuộc cứng | Phụ thuộc mềm | Khi phụ thuộc mềm hỏng |
|---|---|---|---|
| Quẹt thẻ tại máy | Agent, `edge.db`, `identity/`, đầu đọc, đồng hồ máy hợp lý | Broker, Server | Chạy tiếp tới `trusted_until` (D = 24h) |
| Đường mật khẩu dự phòng | LightDM, `pam_unix` | Agent, Custom Greeter | Không phụ thuộc Agent; greeter chuẩn thay thế khi Custom Greeter hỏng |
| Agent ⇄ Server | Broker, CRL hợp lệ, chứng chỉ máy | — | — |
| Dashboard | API, PostgreSQL | Broker | Vẫn quản trị được; trạng thái máy cũ dần |
| Phát snapshot | PostgreSQL, worker, `master_key` | — | Máy giữ snapshot cũ tới hết lease |
| Đăng ký máy | API, CA, Admin | — | Máy mới ở `NoData`, đường dự phòng vẫn dùng được |

## Resilience Patterns

| Pattern | Áp dụng | Cấu hình |
|---|---|---|
| Local-first / lease | Quyết định đăng nhập ở Edge | D = 24h (ADR-001) |
| Transactional outbox | Server: thay đổi → dựng snapshot; Edge: nhật ký → server | `server_outbox`; `audit_outbox` + ACK lũy tiến |
| Idempotent consumer | Ingest nhật ký, phiên, cảnh báo | Khóa `entry_id` |
| Dead letter | Mục outbox lỗi | `ingest_rejects`, vẫn ACK |
| Retry + backoff + jitter | Kết nối MQTT, đăng ký máy | 1s → 60s, hệ số [0.8, 1.2] |
| Timeout + fallback | PAM → Agent | 3s rồi `PAM_IGNORE` |
| Fallback | Custom Greeter → greeter chuẩn | 3 crash / 60s |
| Write-ahead | Quyết định quẹt thẻ | Nhật ký + phiên `pending` trong một giao dịch `synchronous=FULL` |
| Circuit breaker, bulkhead | Không dùng | Server không gọi dịch vụ ngoài; quy mô ~40 máy không cần |

## Kiểm Chứng Bằng Thực Nghiệm

Không làm chaos engineering có hệ thống; các tình huống hỏng hóc trọng yếu được kiểm bằng spike:

| Thí nghiệm | Mục tiêu | Kỳ vọng | Kết quả |
|---|---|---|---|
| Rút điện cưỡng chế khi ghi liên tục (S5) | `edge.db` | Không hỏng, không phiên mồ côi | Đạt (1 lần trên VM) |
| Agent chết khi PAM hỏi (S2, S6) | PAM | Rơi về mật khẩu < 25ms | Đạt (22ms) |
| Greeter lỗi kéo dài (S3b, S10) | LightDM | Còn đường đăng nhập đồ họa | Đạt sau khi sửa tệp đếm crash |
| 20 chu kỳ thay phiên cùng UID dưới tải (S7b) | Teardown | ≤ 3s, không treo D-Bus | Đạt (P95 2314.8 ms) |
| CRL hết hạn / thiếu tệp (S9) | Broker | Phát hiện điểm tự khóa | Phát hiện, đã thiết kế phòng tránh |
| Agent dưới hardening (S11) | Agent | Vẫn mở được phiên | Đạt sau khi thêm `CAP_CHOWN` |

## Recovery Procedures

| Tình huống | Các bước | RTO | RPO |
|---|---|---|---|
| Agent chết trên một máy | systemd tự khởi động lại; nếu không, kỹ thuật viên đăng nhập mật khẩu → `systemctl restart nfc-agent` | < 1 phút (tự động) | 0 (outbox trên đĩa) |
| Custom Greeter hỏng | Tự rơi về greeter chuẩn; kỹ thuật viên sửa rồi `systemctl restart lightdm` | Tức thì (fallback) | — |
| `edge.db` hỏng | Tự động khi Agent khởi động (D-017); kiểm tra cảnh báo `edge_db_recovered` | Tới khi máy online lại | Mục outbox không cứu được (được báo số lượng) |
| Máy mất `identity/`, cài lại máy, bật lại máy đã vô hiệu hóa | `sudo nfc-agent reenroll` → Admin duyệt "cài lại" | Vài phút | 0 (outbox giữ nguyên) |
| Server sập | Khởi động lại dịch vụ; reconcile tự chạy | Trong thời hạn lease (< 24h) thì không ảnh hưởng quẹt thẻ | 0 |
| Hỏng CSDL server | Khôi phục bản sao lưu gần nhất; khởi động; máy tự đồng bộ lại version (D-016) | Vài giờ | ≤ 24h nhật ký và thay đổi quản trị |
| CRL sắp hết hạn (cảnh báo) | Khởi động lại Server hoặc chạy job sinh CRL | — | — |
| Mất `master_key`/CA | Dựng CA mới, cập nhật `ca.pem` trong Master Image và trên mọi máy, đăng ký lại toàn bộ | 1–2 ngày | Không mất nhật ký đã lên server |
