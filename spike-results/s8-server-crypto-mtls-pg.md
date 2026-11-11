# Báo Cáo Kết Quả Spike S8: Kiểm Chứng Mật Mã Ed25519 CSR, MQTT 5 mTLS ACL & Giao Dịch PostgreSQL (Node.js)

- **Mã Spike:** S8 (Server Techstack Verification Spike — Timebox 0.5 ngày)
- **Ngày thực hiện:** 2026-11-11
- **Môi trường:** Ubuntu 22.04 LTS (`binhtong@pam`), **Node.js `v20.20.2`** (`npm 10.8.2`), **`@peculiar/x509`** + `reflect-metadata` + `node:crypto`, **`mqtt`** (MQTT v5), **`pg`**, **Mosquitto `2.0.11`**, **PostgreSQL `14.24`**.
- **Trạng thái:** ✅ **Đạt hoàn toàn (3/3 bài kiểm chứng)**
- **Ảnh hưởng ADR:**
  - Chính thức nâng cấp **[ADR-006](../design/docs/06-architecture/decisions/ADR-006-ngon-ngu-va-techstack.md)** từ `Proposed` lên `Accepted`.
  - Bổ sung hiệu chỉnh thực nghiệm quan trọng về hành vi `SUBSCRIBE` của Mosquitto `acl_file` vào **[ADR-002](../design/docs/06-architecture/decisions/ADR-002-giao-thuc-mqtt-va-dinh-danh-may-tram.md)**.

---

## 1. Câu Hỏi Cần Chứng Minh

Theo [spike.md](../spike.md) và [ADR-006](../design/docs/06-architecture/decisions/ADR-006-ngon-ngu-va-techstack.md):
> Nền tảng **Node.js / NestJS** có thể:
> 1. Xác thực và ký cấp Client Certificate (`CN = workstation_id`) từ **CSR Ed25519** của Edge, đồng thời khớp HKDF/HMAC-SHA256 theo chuỗi byte thô với Python 3?
> 2. Dùng thư viện **`mqtt.js`** kết nối **MQTT 5 mTLS (cổng 8883)** vào Mosquitto với `use_identity_as_username true`, thực thi phân quyền ACL theo `%u` và truyền nhận `User Properties`?
> 3. Thực thi giao dịch **PostgreSQL nguyên tử (`BEGIN ... COMMIT` / `ROLLBACK`)** lưu lịch học và `outbox_events`?

---

## 2. Kết Quả Thực Nghiệm Chi Tiết

### Test 1: Xác thực Ed25519 CSR, cấp X.509 Client Cert & Đối khớp HKDF/HMAC với Python (`✅ Đạt`)
- **Cơ chế chạy:** Edge tạo cặp khóa `Ed25519` + CSR (`/CN=ws-test-01`) bằng OpenSSL; script Node.js sử dụng `@peculiar/x509` (bắt buộc kèm `import 'reflect-metadata'` khi chạy ngoài NestJS do phụ thuộc `tsyringe`) kết hợp `crypto.webcrypto` ký phát hành chứng chỉ `client-issued.crt` bằng CA P-256.
- **Kết quả quan sát trực tiếp:**
  ```text
  === [TEST 1] Ed25519 CSR -> Client Cert & HKDF/HMAC Parity ===
  CSR Subject: CN=ws-test-01 | Alg: Ed25519 | Valid: true
  Issued Client Cert -> /home/binhtong/spike/s8/certs/client-issued.crt (CN=ws-test-01)
  HKDF+HMAC Parity Node vs Python: true
  ```
- **Ý nghĩa:** Node.js `v20.20.2` + `@peculiar/x509` xác thực chữ ký CSR **Ed25519** trực tiếp mà không cần fallback sang `openssl ca` CLI; hàm `crypto.hkdfSync` + `crypto.createHmac` cho kết quả trùng khớp **100% từng byte** với Python 3 (`hashlib`/`hmac`) khi dùng domain-separation tag `"snapshot-v1:"` trên raw payload bytes.

---

### Test 2: `mqtt.js` MQTT 5 mTLS (8883), Phân quyền `%u` & MQTT 5 User Properties (`✅ Đạt + Phát hiện hành vi acl_file`)
- **Cấu hình Mosquitto (`2.0.11`):** `listener 8883`, `require_certificate true`, `use_identity_as_username true`, đọc cert/ACL tại `/etc/mosquitto/s8/` (quyền `0755` cho thư mục và `0640 root:mosquitto` cho `server.key`; lưu ý không đặt dưới `/home/<user>` có quyền `0750` vì daemon `mosquitto` sẽ báo `status=13 Permission denied`).
- **Kết quả chạy 2 client song song (`ws-test-01` dùng cert Ed25519 do Node.js cấp và `server-admin`):**
  ```text
  === [TEST 2] MQTT 5 mTLS + Delivery Isolation + PUBLISH ACL 0x87 ===
  Received msgs by ws-test-01: [
    {
      topic: 'lab/workstation/ws-test-01/snapshot',
      msg: '{"version":42}',
      sig: 'sig-ok-42'
    }
  ]
  PUBLISH ACL codes -> own/snapshot: 135, other/hello: 135
  ```
- **3 kết luận kỹ thuật rút ra từ thực nghiệm thật:**
  1. **Cô lập dữ liệu tuyệt đối (Delivery Isolation):** Khi `ws-test-01` cố tình `SUBSCRIBE` vào cả `lab/workstation/ws-test-01/snapshot` lẫn `lab/workstation/ws-other-99/snapshot`, và `server-admin` đẩy tin vào cả hai topic, `ws-test-01` chỉ nhận được bản tin của chính mình kèm đầy đủ **MQTT 5 User Property** `signature: 'sig-ok-42'`, nhận **0 bản tin** từ `ws-other-99`.
  2. **Chặn ghi trái phép tại tầng giao thức:** Cả hai hành vi `PUBLISH` trái phép (`ws-test-01` tự ghi đè `ws-test-01/snapshot` và ghi trộm `ws-other-99/hello`) đều bị Mosquitto từ chối ngay lập tức với mã lý do MQTT 5 **`135` (`0x87 Not Authorized`)**.
  3. **Hiệu chỉnh quan trọng cho ADR-002 về `acl_file`:** Khác với giả định trước đây cho rằng Mosquitto `acl_file` trả `0x87` ngay ở gói `SUBACK`, thực nghiệm chứng minh `acl_file` truyền thống (`pattern read ...`) **chấp nhận `SUBACK` (`qos: 1`)** và áp dụng bộ lọc quyền `read` tại **thời điểm chuyển phát tin (egress)** để bảo toàn tính tương thích wildcard. Nếu muốn từ chối ngay tại `SUBACK` (`0x87`), phải dùng plugin `dynamic-security` (không bắt buộc cho mục tiêu bảo mật cô lập dữ liệu vì dữ liệu máy khác vẫn bị chặn tuyệt đối 100%).

---

### Test 3: Giao dịch PostgreSQL Nguyên tử (`BEGIN ... COMMIT` & `ROLLBACK`) (`✅ Đạt`)
- **Kịch bản:** Thư viện `pg` kết nối database `spike_s8` (PostgreSQL `14.24` trên Ubuntu 22.04), thực hiện 1 giao dịch hợp lệ (`COMMIT` chèn `schedules` + `outbox_events`) và 1 giao dịch cố tình ném lỗi giữa chừng (`ROLLBACK` sau khi chèn `schedules`).
- **Kết quả quan sát trực tiếp:**
  ```text
  === [TEST 3] PostgreSQL Atomic TX (COMMIT + ROLLBACK) ===
  PG counts sau COMMIT + ROLLBACK: schedules=1, outbox_events=1
  ```
  Bảo đảm tính nguyên tử tuyệt đối, không sinh bản ghi mồ côi khi outbox lỗi.

---

## 3. Giới Hạn Của Bằng Chứng (Evidence Limitations)

1. **Chạy trên script ESM lẻ (`.mjs`) và PostgreSQL 14.24:** Thay vì dựng toàn bộ NestJS boilerplate + Docker PostgreSQL 15, spike dùng `Node.js v20.20.2` + `PostgreSQL 14.24` mặc định của Ubuntu 22.04 để gọn trong timebox 0.5 ngày; API giao dịch `pg` và `crypto`/`x509` hoàn toàn tương đồng khi đưa vào NestJS (nơi `reflect-metadata` đã được import sẵn mặc định).
2. **Phạm vi kiểm chứng mTLS & Outbox:** S8 chứng minh xong nhánh ký Ed25519 CSR, mTLS `%u`, ACL phân tách đọc/ghi và transaction DB; quy trình HTTP Enrollment `POST /api/v1/workstations/enroll`, LWT và Cumulative ACK Outbox (ADR-002) thuộc phạm vi tích hợp giai đoạn code hệ thống chính thức.
