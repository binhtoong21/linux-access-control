# Sequence: Khởi động lại máy (Reboot & Recovery)

## Mục đích
Mô tả quy trình xử lý khi máy khởi động lại, bao gồm cả có kế hoạch (người dùng tắt/khởi động lại máy) hoặc không có kế hoạch (mất điện, sập OS), cách Agent phục hồi trạng thái từ kho cục bộ, đóng các phiên cũ, và báo cáo lên server.

## Sequence

```mermaid
sequenceDiagram
    autonumber
    participant O as Hệ điều hành
    participant A as Agent
    participant K as Kho cục bộ
    participant L as Greeter và PAM
    participant S as Server

    alt Tắt hoặc khởi động lại có kế hoạch
        O->>A: Dừng dịch vụ (sau khi phiên người dùng đã kết thúc)
        A->>K: Đóng LocalSession active: abandoned (workstation_rebooted), reported, giờ chính xác
        A-->>S: Cố gắng đẩy outbox trong thời gian ngắn (nếu có kết nối)
    else Mất điện hoặc sập
        Note over A,K: Không bước nào chạy. Kho giữ nguyên LocalSession, outbox, last_alive_at
    end

    Note over O: Máy khởi động lại, boot_id mới
    O->>A: Khởi động Agent (trước greeter, có thời gian chờ tối đa)
    A->>K: Nạp snapshot, LocalSession, outbox, last_alive_at, boot_id cũ
    A->>A: So boot_id: khác thì là reboot
    A->>K: LocalSession active thành abandoned (workstation_rebooted), reconstructed, ended_at = last_alive_at; pending thành discarded
    A->>K: Đưa SessionEnded vào outbox (trước khi gửi Hello)
    A->>A: Tính trạng thái tin cậy (UTC trusted_until; kiểm tra local_time >= floor)
    A->>L: Sẵn sàng nhận quẹt thẻ
    A->>S: Hello (boot_id mới, version, số mục outbox)
    Note over A,S: Từ đây là luồng reconnect: gia hạn hoặc snapshot, rồi đẩy outbox
    S->>S: Outbox hết: phiên active còn lại của boot cũ thành abandoned, inferred
```

## Nguyên tắc
1. **Kho cục bộ đủ để tự khởi động.** Mọi dữ liệu cần thiết để đánh giá đăng nhập (snapshot, thời hạn tin cậy `trusted_until`, mốc sàn đồng hồ `floor = max(snapshot.created_at, last_server_time - 60s)`) đều đã được lưu bền vững; không phụ thuộc vào server để sẵn sàng hoạt động (NFR-A01, A04, D-012).
2. **Đối chiếu xong mới nhận quẹt thẻ.** Agent chưa phát tín hiệu "sẵn sàng" cho greeter cho đến khi đã hoàn tất đối chiếu LocalSession và tính xong trạng thái tin cậy.
3. **Sự kiện dựng lại vào outbox trước khi gửi Hello.** Gói tin `Hello` báo số mục outbox đã tính cả các sự kiện `SessionEnded` vừa được dựng lại, do đó server biết chính xác số lượng outbox cần vét cạn trước khi kích hoạt logic suy luận (khớp với nguyên tắc 4 của `reconnect`).
4. **Phân biệt reboot và Agent restart bằng `boot_id` của kernel.** Nếu `boot_id` khác: máy đã reboot, toàn bộ phiên OS cũ đã mất, mọi phiên `active` chuyển sang `abandoned`. Nếu `boot_id` giống: chỉ là tiến trình Agent khởi động lại, áp dụng bảng recovery của `swipe-login`.
5. **Ước lượng có gắn nhãn nguồn gốc (`end_source`).** Agent ghi định kỳ `last_alive_at` xuống đĩa; khi dựng lại phiên sau sập, ghi nhận `ended_at = last_alive_at` (cận dưới) với `end_source = reconstructed`. Khi server suy luận sau khi outbox hết, server dùng `ended_at = max(started_at, lần cuối nghe từ máy ở boot cũ)` với `end_source = inferred` (đảm bảo không vi phạm INV-007).
6. **Phát hiện reboot bằng `boot_id`, không phụ thuộc trạng thái offline.** Nếu máy reboot nhanh hơn ngưỡng heartbeat timeout, server không đánh dấu máy là offline nhưng vẫn nhận biết được sự kiện reboot nhờ `boot_id` thay đổi (XINV-008).
7. **Agent không được chặn quá trình khởi động máy.** Nếu Agent gặp lỗi không khởi động được (lỗi kho đĩa, hỏng file cấu hình), hệ điều hành vẫn phải vào greeter để cho phép đăng nhập qua đường dự phòng cục bộ (BR-004, NFR-M01).
8. **Tắt máy có kế hoạch: Agent dừng sau các phiên người dùng.** Cấu hình thứ tự systemd để Agent chứng kiến các phiên người dùng kết thúc và ghi nhận timestamp chính xác trước khi dừng.

## Ngoại lệ
| ID | Tình huống | Hành vi |
|----|-----------|---------|
| EF-1 | Mất điện đúng thời điểm ghi nhật ký và LocalSession | Thao tác ghi là một giao dịch nguyên tử: hoặc thành công cả hai, hoặc không có gì. Nếu không có gì, lần quẹt đó chưa hoàn tất, Agent chưa cấp quyền cho PAM, người dùng chưa vào máy. |
| EF-2 | Máy reboot lặp liên tục (boot loop) | Mỗi lần reboot sinh một `boot_id` mới, server ghi nhận từng lần; phạm vi MVP không cần cơ chế xử lý nâng cao. |
| EF-3 | Agent không khởi động được | Máy chuyển sang sử dụng đường dự phòng cục bộ (`swipe-login` EF-1); server đánh dấu máy offline sau khi lỡ heartbeat. |
| EF-4 | Hỏng hoặc mất kho cục bộ (thay ổ đĩa, lỗi file system) | Mất snapshot dẫn đến trạng thái `NoData`; mất outbox làm mất các bản ghi chưa đẩy (ghi log hệ thống); server suy luận `abandoned` (`inferred`); mất định danh máy thì thực hiện đăng ký lại (UC-007 AF-2). |
| EF-5 | Máy reboot trong lúc đang ở trạng thái `Authorizing` | `LocalSession pending` chuyển thành `discarded`; bản ghi nhật ký `granted` vẫn còn, trên dashboard hiển thị nhãn "chưa nhận phiên". |
| EF-6 | Pin RTC chết sau khi mất điện | Giờ hệ thống lùi về quá khứ khiến `local_time < floor`: Agent từ chối quẹt thẻ với `data_stale(clock_invalid)` theo CR-001; phiên cũ vẫn được dựng lại bình thường với mốc `last_alive_at`. |

## Tham số chốt sau (06)
- Chu kỳ ghi `last_alive_at` xuống đĩa (ghi thưa để tránh hao mòn ổ đĩa flash; quyết định độ mịn của `ended_at` ước lượng).
- Thời gian chờ tối đa của Agent trước khi greeter sẵn sàng.
- Thời gian chờ đẩy outbox khi tắt máy có kế hoạch.

## Câu hỏi cho 06
| ADR | Câu hỏi |
|-----|---------|
| PAM và greeter | Cấu hình thứ tự systemd giữa Agent và Display Manager (GDM/LightDM), timeout khởi động để Agent không làm treo màn hình đăng nhập. |
| Lưu trữ cục bộ | Tính nhất quán khi crash (WAL, transaction), vị trí lưu `last_alive_at`. |
| Giao thức | Cách lấy `boot_id` từ Linux kernel (`/proc/sys/kernel/random/boot_id`); cờ `end_source` 3 giá trị (`reported`, `reconstructed`, `inferred`) trong envelope của `SessionEnded`. |
