# Kết quả Spike S5: Agent, MQTT và Lưu trữ Nguyên tử (Crash-Safety)

> [!NOTE] Cập nhật định hướng kiến trúc sau Spike (D-012, Điểm 8)
> Cơ chế mốc sàn xác minh ghi đĩa liên tục (`verification_floor` với 3 điều kiện thẩm định ban đầu) đã được chuẩn hóa theo **D-012 / Điểm 8** thành mốc sàn cải tiến: `floor = max(snapshot.created_at, last_server_time - 60s)`, lưu bền vững cùng bản ghi với `trusted_until` mỗi lần gia hạn lease mà không phát sinh thêm I/O đĩa riêng.

## Câu hỏi
Daemon Agent có chịu được mất kết nối mạng và mất điện đột ngột mà không bao giờ làm hỏng dữ liệu cục bộ không? Kích thước Snapshot danh sách thẻ qua MQTT có nằm trong giới hạn không? SQLite WAL và kỹ thuật ghi file nguyên tử có đảm bảo tính toàn vẹn (0% hỏng file, 0 phiên mồ côi) sau hàng trăm lần `kill -9` không? Thuật toán kiểm tra đồng hồ (BR-006 & BR-012) có phát hiện được lỗi pin CMOS hoặc gian lận lùi giờ không?

## Cách thử
1. **Stress Test Ghi Snapshot Nguyên tử:** Viết file tạm + `fsync` (`sync`) + đổi tên nguyên tử (`mv`). Chạy vòng lặp ghi liên tục kết hợp bắn `kill -9` ngẫu nhiên trong 200 vòng; kiểm tra tính toàn vẹn cú pháp JSON sau mỗi lần chém.
2. **Stress Test SQLite WAL Transaction:** Mở cơ sở dữ liệu chế độ `WAL` và `PRAGMA synchronous=FULL`. Vừa ghi giao dịch đồng thời cả nhật ký kiểm toán (`audit_outbox`) và phiên (`local_session`) vừa bắn `kill -9` trong 100 vòng; kiểm tra `PRAGMA integrity_check` và quét phiên mồ côi (`orphans`).
3. **Thử nghiệm MQTT TLS & Kích thước Payload:** Cấu hình Mosquitto lắng nghe cổng bảo mật TLS 8883 (với chứng chỉ số trong `/etc/mosquitto/certs/`). Chạy script đo lường chính xác dung lượng gói tin Snapshot từ 10 đến 500 thẻ sinh viên qua đường truyền mạng thật.
4. **Kiểm thử Thuật toán Đồng hồ (BR-006 & BR-012):** Kiểm tra 4 kịch bản biên: Giờ bình thường, Pin CMOS chết (quay về 1970), Chỉnh lùi đồng hồ gian lận, và Quá thời hạn tin cậy (`data_stale`).

## Kết quả

| Ca test | Kỳ vọng | Thực tế | Đạt? |
|---|---|---|---|
| **Ca 1: Ghi Snapshot nguyên tử** | 200 vòng `kill -9` giữa chừng không bao giờ làm rách file JSON | **200 PASS, 0 FAIL**. File JSON luôn đọc được bản nguyên vẹn (hoặc bản cũ hoặc bản mới hoàn chỉnh) | ✅ Đạt |
| **Ca 2: Giao dịch SQLite WAL** | 100 vòng `kill -9` không làm hỏng DB, không sinh phiên mồ côi | **100 PASS, 0 FAIL**. `integrity_check` luôn là `ok`, 0 phiên mồ côi (100% nhất quán 1:1) | ✅ Đạt |
| **Ca 3: Cấu hình Mosquitto TLS** | Mosquitto chạy cổng 8883 bảo mật | Kết nối TLS thành công; giải quyết bài toán quyền hạn user `mosquitto` truy cập thư mục certs | ✅ Đạt |
| **Ca 4: Đo tải Payload Snapshot** | Gói tin 10 - 500 thẻ nằm gọn trong giới hạn 1 message MQTT | **500 thẻ chỉ nặng 38.15 KB** (vượt xa kỳ vọng, truyền nhận trong < 10ms trên cổng 8883) | ✅ Đạt |
| **Ca 5: Thẩm định An toàn Đồng hồ** | Chặn đứng pin CMOS chết và gian lận lùi giờ (BR-006, BR-012) | 4/4 kịch bản phân loại chuẩn xác: Chặn đứng `ClockSuspect` khi giờ về 1970 hoặc lùi giờ, chặn `data_stale` | ✅ Đạt |
| **Ca 6: Mất Điện Đột Ngột (Hard Power Cut)** | Máy ảo bị rút điện cưỡng chế (`sysrq-trigger b`) trong lúc ghi liên tục | Sau khi khởi động lại: Chưa quan sát thấy lỗi nào, Snapshot JSON nguyên vẹn v545, SQLite WAL `integrity_check = ok`, 0 phiên mồ côi khi áp dụng `fsync` thư mục cha (`os.fsync(dir_fd)`) | ✅ Đạt (Kiểm chứng Giai đoạn 1.3) |
| **Ca 7: Đồng hồ Đơn điệu `CLOCK_BOOTTIME` (ADR-001)** | Đo thời gian bằng `time.CLOCK_BOOTTIME` chống trôi/gian lận | Kiểm thử 5 ca: Bình thường, CMOS 1970, lùi giờ, nhảy vọt giờ, hết hạn lease boot. Toàn bộ 5/5 ca đều thẩm định chuẩn xác | ✅ Đạt (Kiểm chứng Giai đoạn 1.4) |
| **Ca 8: Vòng lặp Heartbeat & Gia hạn Lease (S5)** | Định kỳ bắn Heartbeat và nhận Lease gia hạn kèm `server_time` | Agent phát Heartbeat mỗi 3s, Server gia hạn Lease +7200s; đo độ trễ khứ hồi (RTT) nhận phản hồi lease trên môi trường test đạt từ 0.6ms đến 104.3ms | ✅ Đạt (Kiểm chứng Nhóm 4) |
| **Ca 9: Tự động Phục hồi Kết nối (Auto Reconnect)** | Broker sập đột ngột (`restart mosquitto`), Agent tự khôi phục | Nhận `on_disconnect (rc=1)`, kích hoạt exponential backoff; khi broker online, tự động kết nối lại (`rc=0`) và phát tiếp Heartbeat mà không chết process | ✅ Đạt (Kiểm chứng Nhóm 4) |
| **Ca 10: Kiểm thử Đơn vị Bộ so sánh Clock Drift (ADR-001)** | Kiểm thử logic từ chối Lease nếu `server_time` lệch > 60s so với đồng hồ cục bộ | Lệch 2.15s: Chấp nhận gia hạn Lease. Lệch 95.40s: Bị từ chối ngay lập tức với mã lỗi `clock_drift_exceeded` và kích hoạt cảnh báo kiểm toán | ✅ Đạt (Kiểm chứng Nhóm 6) |

## Số liệu Đo đạc Thực tế
- **Độ bền Ghi tệp nguyên tử:** Tỷ lệ sống sót `200/200` (100%).
- **Độ bền Cơ sở dữ liệu SQLite WAL:** Tỷ lệ toàn vẹn `100/100` (100%), tỷ lệ phiên mồ côi: `0%`.
- **Thực nghiệm Ngắt điện Cứng (SysRq):**
  - Snapshot JSON sau reboot: `✅ Snapshot OK, version: 545` (chạy 545 vòng ghi lặp liên tục trước khi ngắt điện đột ngột).
  - SQLite WAL: `PRAGMA integrity_check -> ok`
  - Phiên mồ côi: `SELECT count(*) FROM session WHERE audit_id NOT IN (SELECT id FROM audit) -> 0`
- **Kết quả Thẩm định Đồng hồ Đơn điệu (ADR-001):**
  - Nhân Linux Ubuntu 22.04: Hỗ trợ `time.CLOCK_BOOTTIME`.
  - Ca 1 (Bình thường): `Cho phep quet the: GRANTED`
  - Ca 2 (CMOS chết về 1970): `Tu choi: clock_suspect: Gio he thong nho hon moc san`
  - Ca 3 (Gian lận lùi giờ): `Tu choi: clock_suspect: Gio he thong nho hon moc san`
  - Ca 4 (Chỉnh giờ nhảy vọt > 60s): `Tu choi: clock_suspect: Gio he thong lech qua lon so voi bo dem don dieu`
  - Ca 5 (Quá hạn Lease 7200s): `Tu choi: data_stale: Lease da het han theo dong ho do CLOCK_BOOTTIME`
- **Thực nghiệm Sai lệch Đồng hồ Lease (Ca 10 - Mock Unit Test):**
  - Kịch bản giả lập kiểm thử logic so sánh thuật toán (không phải đo trôi phần cứng):
  - Lệch giả lập 2.15s (<= 60.0s): `✅ [CHẤP NHẬN LEASE]: Đồng hồ hợp lệ. Gia hạn trusted_until đến 1793056461.81`
  - Lệch giả lập 95.40s (> 60.0s): `❌ [TỪ CHỐI LEASE]: clock_drift_exceeded (Lệch 95.40s > 60.0s)!`
- **Dung lượng Payload Snapshot qua MQTT & Đánh giá Quy mô:**
  - 10 thẻ: `842 bytes` (0.82 KB)
  - 50 thẻ: `3,961 bytes` (3.87 KB)
  - 100 thẻ: `7,862 bytes` (7.68 KB)
  - 200 thẻ: `15,662 bytes` (15.29 KB)
  - 500 thẻ: `39,061 bytes` (38.15 KB)
  - *Đánh giá quy mô:* Với 5.000 user trong trường hợp snapshot đầy đủ không phân mảnh, dung lượng ước tính ~400 KB/máy. Trên mạng LAN phòng lab 40 máy trạm, tổng tải đồng bộ ~16 MB hoàn toàn nằm trong năng lực mạng nội bộ, song cần ghi nhận giả định này để thiết kế giải pháp đồng bộ vi sai (delta sync) trong các giai đoạn tiếp theo.
- **Tốc độ truyền nhận TLS:** < 0.01 giây cho 500 thẻ.
- **Thực nghiệm Heartbeat & Reconnect (Ca 8, Ca 9):**
  - Heartbeat roundtrip: 0.6ms - 104.3ms.
  - Phục hồi đứt kết nối: Tự động reconnect thành công trong 1.5 giây sau khi broker bị restart cưỡng bức (`systemctl restart mosquitto`).

## Kết luận & Quyết định Kiến trúc
1. **Lưu trữ Cục bộ Crash-Safe (POSIX / SQLite WAL):**
   - **Snapshot File:** Bắt buộc áp dụng mô hình ghi file tạm `.tmp` + `os.fsync(f)` + `os.replace` (atomic rename) + **`os.fsync(dir_fd)` trên thư mục cha**. Theo tiêu chuẩn POSIX và đặc tả hệ thống tệp ext4, nếu không fsync thư mục cha, metadata của directory entry sau rename có thể chưa được flush xuống đĩa trước khi mất điện. Thực nghiệm ngắt điện cưỡng chế (SysRq `b`) sau 545 vòng ghi liên tục không ghi nhận lỗi hỏng tệp hay phiên mồ côi trong môi trường máy ảo.
   - **Cơ sở dữ liệu:** Chốt sử dụng **SQLite chế độ WAL (`PRAGMA journal_mode=WAL`)** và `PRAGMA synchronous=FULL`. Mọi thao tác ghi phiên và nhật ký bắt buộc phải bọc trong một khối `BEGIN IMMEDIATE ... COMMIT` duy nhất để bảo toàn bất biến **INV-014**.
2. **Giao thức MQTT & Phân quyền ACL Chi tiết:**
   - Mosquitto với TLS (port 8883) là giải pháp tối ưu. Payload 500 thẻ sinh viên chỉ tốn 38 KB, truyền nguyên khối trong 1 message MQTT QoS 1.
   - **Cấu trúc Topic phân vùng & Kiểm soát Truy cập (Mosquitto ACL - NFR-SEC02):** Chuẩn hóa topic theo định dạng tách bạch đọc/ghi:
     - Máy trạm chỉ đọc (SUBSCRIBE): `pattern read lab/workstation/%u/snapshot`, `pattern read lab/workstation/%u/lease`
     - Máy trạm chỉ ghi (PUBLISH): `pattern write lab/workstation/%u/outbox`, `pattern write lab/workstation/%u/heartbeat`, `pattern write lab/workstation/%u/session`
     - Không cấp quyền wildcard `readwrite lab/workstation/%u/#` để ngăn chặn máy trạm tự ghi đè snapshot hoặc lease của chính nó. Với MQTT 5, vi phạm ACL sẽ nhận mã lỗi `0x87 (Not Authorized)`.
   - **Cơ chế Heartbeat kép:** Kênh nhận gia hạn thời hạn tin cậy (`trusted_until`) và đồng bộ `server_time` để giám sát độ trôi đồng hồ cục bộ.
   - **Tự động Reconnect:** Sử dụng thuật toán Exponential Backoff kết hợp `reconnect_delay_set` để tự động nối lại ngay khi broker phục hồi mà không làm sập Agent.
3. **An toàn Thời gian theo ADR-001 (Clock Safety):**
   - Không phụ thuộc đơn thuần vào `time.time()` của hệ điều hành. Đo thời gian trôi qua bằng bộ đếm phần cứng đơn điệu `time.CLOCK_BOOTTIME`. Mọi kịch bản CMOS chết, lùi giờ hoặc chỉnh tiến quá hạn lease đều bị chặn đứng tức thì mà không cần mạng.
   - Mốc sàn xác minh được tính toán chuẩn xác từ `server_time + CLOCK_BOOTTIME` (chuẩn ADR-001), ngăn chặn việc "đầu độc" mốc sàn khi đồng hồ hệ thống nhảy tới rồi lùi lại.

## Giới hạn của Bằng chứng (Limitations of Evidence)
- **Cắt điện cưỡng chế trên máy ảo (SysRq `b`):** Thử nghiệm chỉ chạy trên máy ảo KVM/QEMU với số lần N = 1; tầng Host OS vẫn có write-cache riêng nên chưa chứng minh được độ bền ghi NAND flash trên ổ cứng vật lý.
- **Clock Drift:** Số liệu lệch 2.15s là số giả lập trong Unit Test, không phải độ trôi đồng hồ vật lý thực tế giữa hai máy độc lập.
- **Kiểm soát ACL và mTLS:** Việc phân quyền với biến `%u` qua mTLS (`use_identity_as_username`) mới được kiểm thử mô phỏng với username tĩnh, cần hoàn thiện kiểm chứng với chứng chỉ số X.509 thực tế cho từng máy.

## ADR bị ảnh hưởng
- **ADR "Giao thức MQTT":** Xác nhận Snapshot truyền trong 1 message đơn lẻ qua TLS cổng 8883.
- **ADR "Lưu trữ cục bộ và Giao dịch nguyên tử (ADR-003)":** Chốt sử dụng SQLite WAL mode + PRAGMA synchronous=FULL cho Outbox và Session; bắt buộc POSIX directory fsync cho Snapshot file.
- **ADR "Thẩm định thời hạn Snapshot và An toàn Đồng hồ (ADR-001)":** Chuẩn hóa công thức kiểm tra đồng hồ kép kết hợp mốc sàn cải tiến (D-012, Điểm 8).
