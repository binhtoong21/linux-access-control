# Báo Cáo Kết Quả Spike S9: Thu Hồi Chứng Chỉ Máy Trạm Bằng `crlfile` Của Mosquitto

- **Mã Spike:** S9 (CRL Revocation Spike — Timebox 0.5 giờ)
- **Ngày thực hiện:** 2026-11-11
- **Môi trường:** Ubuntu 22.04.5 LTS (`binhtong@pam`, VM), **Mosquitto `2.0.11`**, **OpenSSL `3.0.2`**, `mosquitto_pub`/`mosquitto_sub` (MQTT v5). Broker riêng chạy bằng user thường ở `127.0.0.1:18883`, cấu hình và CA thử nghiệm nằm trong `~/spike/s9` (không đụng broker S8 ở `8883`). Script: `~/spike/s9_crl.sh`.
- **Trạng thái:** ✅ **Đạt, kèm 3 phát hiện bắt buộc đưa vào thiết kế**
- **Ảnh hưởng ADR:** Hiệu chỉnh cơ chế thu hồi trong **[ADR-002](../design/docs/06-architecture/decisions/ADR-002-giao-thuc-mqtt-va-dinh-danh-may-tram.md)** §1 và **D-014** điểm 5: nạp lại CRL bằng **khởi động lại broker** (không chỉ `SIGHUP`), CRL có hạn dài và được làm mới định kỳ, tệp CRL luôn tồn tại và được ghi nguyên tử.

---

## 1. Câu Hỏi Cần Chứng Minh

Theo D-014 điểm 5: khi Admin duyệt cài lại hoặc vô hiệu hóa máy, Server đưa serial chứng chỉ cũ vào CRL và nạp lại Mosquitto. Cần trả lời:
1. Mosquitto `2.0.11` với `crlfile` có từ chối chứng chỉ đã thu hồi mà vẫn nhận chứng chỉ mới **cùng CN** (`ws-01`) không?
2. `SIGHUP` có nạp lại CRL không, và kết nối **đang mở** bằng chứng chỉ cũ có bị ngắt không?
3. Có tình huống nào làm CRL khiến **toàn bộ** máy trạm không kết nối được (tự khóa) không?

## 2. Thiết Lập

- CA thử nghiệm ECDSA P-256 (giống S8), quản lý bằng `openssl ca` (`index.txt`, `crlnumber`).
- Cấp 4 chứng chỉ: `server` (CN=localhost), `ws01_old` (Ed25519, CN=`ws-01`, serial `1001`), `ws01_new` (Ed25519, CN=`ws-01`, serial `1002`, mô phỏng máy cài lại), `nfcserver` (CN=`nfc-server`).
- Broker: `require_certificate true`, `use_identity_as_username true`, `crlfile`, `acl_file`, `persistence false`.

## 3. Kết Quả

| # | Bài thử | Kết quả quan sát | Đánh giá |
|---|---|---|---|
| T1 | Trước thu hồi: `ws01_old`, `ws01_new` kết nối | Cả hai `rc=0` | ✅ |
| T2a | Thu hồi `1001`, sinh lại CRL, `SIGHUP` → kết nối mới bằng `ws01_old` | `rc=7`, log broker: `certificate verify failed` | ✅ CRL được nạp lại bằng `SIGHUP` |
| T2b | Sau `SIGHUP`: `ws01_new` (cùng CN `ws-01`), `nfcserver` | Cả hai `rc=0` | ✅ Thu hồi theo serial, không theo CN |
| T2c | Kết nối **đang mở** bằng `ws01_old` (subscriber) sau `SIGHUP` | **Vẫn còn**, và vẫn nhận bản tin retained `lab/workstation/ws-01/snapshot` do server publish sau khi thu hồi | ⚠️ **Phát hiện 1** |
| T3 | Khởi động lại broker | Kết nối cũ **bị ngắt**; `ws01_old` kết nối lại thất bại (`rc=7`); `ws01_new` `rc=0` | ✅ |
| T4 | CRL hết hạn (`nextUpdate` trong quá khứ) | **Mọi** client bị từ chối, kể cả chứng chỉ hợp lệ `ws01_new` và `nfcserver` (`rc=7`) | ❌ **Phát hiện 2** (tự khóa toàn hệ thống) |
| T5 | Tệp CRL không tồn tại khi broker khởi động | Broker **không khởi động được**: `Unable to load certificate revocation file` | ❌ **Phát hiện 3** (tự khóa toàn hệ thống) |

Trích log broker:
```text
Reloading config.
OpenSSL Error[0]: error:0A000086:SSL routines::certificate verify failed
Client <unknown> disconnected: Protocol error.
New client connected from 127.0.0.1:59096 as ws-01-new2 (p5, c1, k60, u'ws-01').
...
Error: Unable to load certificate revocation file "/home/binhtong/spike/s9/ca/crl.pem". Check crlfile.
```

## 4. Phát Hiện & Hiệu Chỉnh Thiết Kế

1. **`SIGHUP` chỉ chặn kết nối mới, không ngắt kết nối đang mở.** Chứng chỉ đã thu hồi giữ được phiên MQTT hiện tại (vẫn nhận retained snapshot, vẫn publish được heartbeat/outbox theo ACL) cho tới khi tự ngắt.
   → **Hiệu chỉnh:** sau khi sinh lại CRL, Server **khởi động lại broker** (`systemctl restart mosquitto`). Việc thu hồi chỉ xảy ra vài lần mỗi học kỳ; các máy trạm kết nối lại tự động nhờ backoff có jitter (ADR-002 §6) và gửi Hello như bình thường, đăng nhập bằng thẻ không bị gián đoạn vì Agent quyết định cục bộ.
2. **CRL hết hạn làm mọi máy (kể cả Server) mất kết nối broker.** Sau thời hạn lease (24h) toàn bộ phòng máy chuyển `data_stale`.
   → **Hiệu chỉnh:** CRL được ký với hạn dài (`default_crl_days = 3650`) **và** Server sinh lại CRL mỗi lần khởi động cùng một job định kỳ hằng ngày; Dashboard cảnh báo khi `nextUpdate` còn dưới 30 ngày.
3. **Thiếu tệp CRL thì broker không khởi động.**
   → **Hiệu chỉnh:** tệp CRL (kể cả rỗng) được tạo ngay khi dựng CA lúc cài đặt; mỗi lần cập nhật ghi tệp tạm rồi `rename` để broker không bao giờ đọc phải tệp thiếu hoặc dở dang.

## 5. Giới Hạn Bằng Chứng

- Chạy trên một VM, broker cục bộ `127.0.0.1`, mỗi bài thử N = 1; không đo thời gian 40 máy kết nối lại sau khi khởi động lại broker (dựa vào thiết kế backoff/jitter của ADR-002 §6, chưa đo tải).
- Dùng `mosquitto_pub/sub` thay vì Agent Python thật; hành vi TLS do OpenSSL + Mosquitto quyết định nên không phụ thuộc client.
- Không thử plugin `dynamic-security` (có thể ngắt client mà không cần khởi động lại broker); không cần cho quy mô MVP.
