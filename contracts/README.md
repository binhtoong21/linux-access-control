# Contracts: Hợp Đồng Dùng Chung Edge (Python) ⇄ Server (TypeScript)

Nơi **duy nhất** định nghĩa định dạng bản tin MQTT và bố cục byte của các phép mật mã. Cả `edge/` và `server/` đều chạy test với chính các tệp ở đây, nên hai bên không thể hiểu lệch nhau mà test vẫn xanh.

| Thư mục | Nội dung | Nguồn thiết kế |
|---|---|---|
| `schemas/` | JSON Schema (draft 2020-12) cho từng bản tin | [events.md](../design/docs/08-api/events.md) |
| `examples/` | Bản tin mẫu hợp lệ; test hai bên kiểm chúng khớp schema | events.md |
| `vectors/crypto-v1.json` | Test vector mật mã: đầu vào và kết quả mong đợi | ADR-003, ADR-007, D-018 |
| `tools/gen_vectors.py` | Cài đặt tham chiếu (chỉ dùng thư viện chuẩn Python) sinh `crypto-v1.json` | — |

Sinh lại vector (chỉ khi đổi đặc tả, kèm tăng hậu tố `-v2`):
```
python contracts/tools/gen_vectors.py > contracts/vectors/crypto-v1.json
```

## Đặc Tả Mật Mã (v1)

Mọi chuỗi văn bản mã hóa UTF-8. `‖` là nối byte. `hex` là chữ thường.

| Phép | Định nghĩa chính xác |
|---|---|
| Khóa máy `K_m` | `HKDF-SHA256(IKM = master_key, salt = "nfc-lab-km-v1", info = mqtt_identity ‖ ":" ‖ str(key_version), L = 32)` |
| UID chuẩn hóa | Hex **chữ hoa** của dãy byte đầu đọc trả về, không đảo byte, bỏ `:`/khoảng trắng/`-`; 4, 7 hoặc 10 byte (VR-007) |
| `CardMatchKey` | `hex(HMAC-SHA256(K_m, "uid-match-v1" ‖ UID_chuẩn_hóa))` (UID dạng chuỗi ASCII, ví dụ `"1F0820CF"`) |
| Blind index (Server) | `hex(HMAC-SHA256(K_index, "uid-index-v1" ‖ UID_chuẩn_hóa))` |
| Chữ ký bản tin | `hex(HMAC-SHA256(K_m, tag ‖ ":" ‖ payload_bytes))`, `tag` ∈ `snapshot-v1`, `lease-v1`, `ack-v1`; ký trên **đúng byte gửi đi**, kiểm trên byte nhận được trước khi parse |
| So sánh chữ ký | Hằng thời gian (`hmac.compare_digest` / `crypto.timingSafeEqual`) |
| `lease_nonce` | 16 byte ngẫu nhiên, `hex` (32 ký tự) |
| `fetch_code` | 32 byte ngẫu nhiên, base64url không đệm (43 ký tự); Server lưu `hex(SHA-256(fetch_code))` |

Ghi chú:
- Salt cố định theo phiên bản để tách miền khóa; định danh máy nằm trong `info`. Spike S8 đã chứng minh HKDF/HMAC của `node:crypto` và Python trùng từng byte; vector ở đây khóa thêm **bố cục tham số** đã chọn.
- Đổi bất kỳ dòng nào trong bảng trên là thay đổi phá vỡ tương thích: phải tăng phiên bản (`uid_scheme`, tag `-v2`) theo Expand → Contract (`migrations.md` §3.1).
