# Sequence: Mất rồi nối lại kết nối

## Mục đích
PC mất kết nối server rồi nối lại. Phần quẹt thẻ không đổi gì khi mất kết nối (UC-005); sequence này tập trung vào những gì xảy ra khi nối lại: máy báo trạng thái, nhận gia hạn hoặc snapshot, đẩy nhật ký đến muộn.

## Sequence

```mermaid
sequenceDiagram
    autonumber
    participant A as Agent
    participant K as Kho cục bộ
    participant B as MQTT broker
    participant Ops as Operations (server)
    participant D as Distribution (server)

    Note over A,B: Mất kết nối
    A->>A: Phát hiện mất kênh, chuyển sang chế độ độc lập
    loop Trong lúc mất kết nối
        Note over A,K: Quẹt thẻ, phiên, hết giờ vẫn chạy theo dữ liệu cục bộ; mọi bản ghi và sự kiện vào outbox
        A-->>B: Thử kết nối lại (lùi dần, có ngẫu nhiên hóa)
    end
    Note over Ops: Bỏ lỡ quá số heartbeat quy định thì máy offline

    A->>B: Kết nối lại (TLS, định danh máy)
    A->>B: Hello (boot_id, snapshot_version, số mục outbox chờ)
    B->>Ops: Hello
    Ops->>Ops: Đánh dấu online
    Ops->>D: Phiên bản máy đang dùng
    alt snapshot_version bằng desired_version
        D-->>A: Gia hạn thời hạn tin cậy (version, thời lượng, giờ server)
        A->>K: Cập nhật thời hạn tin cậy
    else Máy tụt lại
        D-->>A: Snapshot mới nhất (đầy đủ)
        A->>K: Kiểm tra, chuyển nguyên tử, làm mới thời hạn tin cậy
        A-->>D: SnapshotApplied
    else Máy báo version lớn hơn desired_version (server vừa khôi phục từ bản sao lưu)
        D->>D: desired_version = max(desired, version máy) + 1, dựng lại snapshot (D-016)
        D-->>A: Snapshot mới (version lớn hơn bản máy đang có)
        A->>K: Kiểm tra, chuyển nguyên tử, làm mới thời hạn tin cậy
    end
    loop Đến khi outbox rỗng
        A->>Ops: Lô mục outbox (bản ghi nhật ký, sự kiện phiên), theo thứ tự thời gian
        Ops->>Ops: Loại trùng theo entry_id, lưu received_at; mục không áp dụng được thì giữ nguyên văn để Admin xem (D-015)
        Ops-->>A: Xác nhận đến mục cuối của lô (kể cả khi có mục lỗi)
        A->>K: Xóa các mục đã xác nhận khỏi outbox
    end
    Ops->>Ops: Outbox hết (hoặc quá thời gian chờ): nếu boot_id khác lần trước thì phiên active còn lại của máy chuyển abandoned
    Note over A,Ops: Heartbeat định kỳ tiếp tục, mỗi heartbeat báo version và nhận gia hạn
```

## Nguyên tắc
1. **Không có nhánh nào của luồng quẹt thẻ phụ thuộc kết nối** (NFR-P01). Thứ duy nhất đếm ngược khi mất mạng là thời hạn tin cậy.
2. **Nối lại là một Hello báo trạng thái đầy đủ** (`boot_id`, phiên bản, độ dài outbox); server quyết định gửi gì. Mất ack, mất snapshot, lệch phiên bản đều tự lành qua cùng một cơ chế.
3. **Khôi phục khả năng đăng nhập trước, đẩy nhật ký sau.** Người đang đứng ở màn hình `data_stale` cần gia hạn hoặc snapshot ngay; outbox đẩy nền theo lô sau đó.
4. **Báo cáo của Agent có thẩm quyền hơn suy luận của server.** Suy luận `abandoned` từ `boot_id` đổi chỉ áp dụng sau khi outbox đã hết (xem phát hiện bên dưới).
5. **Chỉ xóa khỏi outbox sau khi server xác nhận** (INV-013), đẩy lại luôn an toàn nhờ loại trùng (XINV-006); xác nhận theo cách "đến mục thứ n" nên lô phải theo thứ tự.
6. **Kết nối lại có lùi dần và ngẫu nhiên hóa**, để khi server sập vài trăm máy không đồng loạt dồn vào lúc nó lên lại.

## Ngoại lệ
| ID | Tình huống | Hành vi |
|----|-----------|---------|
| EF-1 | Mất kết nối ngắn, chưa tới ngưỡng heartbeat | Server chưa đánh offline; Hello và gia hạn chạy như bình thường, outbox ít hoặc rỗng. |
| EF-2 | Mất kết nối quá thời hạn tin cậy | Agent đã vào trạng thái hết hạn; nối lại thì gia hạn hoặc snapshot đưa về trạng thái tin cậy ngay. Outbox có thêm các bản ghi `data_stale`. |
| EF-3 | Server sập, mọi máy nối lại cùng lúc | Lùi dần và ngẫu nhiên hóa (nguyên tắc 6); server giới hạn tốc độ nhận lô. |
| EF-4 | Máy khởi động lại trong lúc mất kết nối | Agent đối chiếu LocalSession (bảng recovery trong swipe-login), outbox còn nguyên (NFR-A04), `boot_id` mới; nhật ký và `SessionEnded(workstation_rebooted)` do Agent báo đến trước suy luận của server. |
| EF-5 | Outbox rất lớn (mất mạng lâu) | Đẩy theo lô có tốc độ giới hạn; nếu outbox đầy thì quẹt thẻ bị chặn (swipe-login EF-3). |
| EF-6 | Mất kết nối giữa lúc đẩy lô | Lô chưa xác nhận giữ nguyên, gửi lại sau; server loại trùng. |
| EF-7 | Một mục trong lô không áp dụng được (dữ liệu sai, xung đột trạng thái) | Server không từ chối cả lô: mục lỗi được giữ nguyên văn kèm lý do để Admin xem, phần còn lại áp dụng bình thường, lô vẫn được xác nhận. Hàng đợi của máy không bao giờ kẹt vì một mục (XINV-006, D-015). |
| EF-8 | Báo cáo kết thúc phiên đến sau khi server đã suy luận (quá thời gian chờ Draining) | Báo cáo thật thay kết quả suy luận đúng một lần (`end_source: inferred → reported`); kết quả do Agent báo thì không đổi nữa (INV-007, D-015). |
| EF-9 | Server khôi phục từ bản sao lưu cũ, máy đang giữ version lớn hơn | Xem nhánh thứ ba của sơ đồ: server nhảy version lên trên version máy rồi gửi snapshot mới. Không có máy nào bị kẹt ở "từ chối mọi snapshot" (INV-011, D-016). |
| EF-10 | Server còn giữ phiên `active` cũ của máy (Agent dựng lại `edge.db` mà máy không reboot nên `boot_id` không đổi) | `SessionStarted` mới đến thì server suy luận phiên cũ kết thúc (`abandoned`, `inferred`) rồi ghi phiên mới; báo cáo thật nếu có đến sau vẫn thay được (D-015). |

## Phát hiện: XINV-008 và INV-007 va nhau
Khi nối lại, server thấy `boot_id` đổi và (theo XINV-008 cũ) chuyển mọi Session `active` sang `abandoned`. Nhưng outbox của Agent có thể chứa `SessionEnded(schedule_expired)` hoặc `workstation_rebooted` đã xảy ra từ trước. Nếu suy luận đến trước, server ghi thời điểm kết thúc là lúc nối lại với lý do mơ hồ, rồi báo cáo thật đến sau và bị INV-007 ("trạng thái kết thúc không đảo ngược") chặn. Mất thông tin chính xác về giờ và lý do kết thúc.

**Đã sửa:**
- **XINV-008:** suy luận `abandoned` chỉ áp dụng cho phiên `active` còn lại **sau khi outbox của máy đã hết** (hoặc quá thời gian chờ cấu hình). Phiên Agent đã báo kết thúc giữ nguyên báo cáo.
- **INV-007** bổ sung (D-015): nếu báo cáo thật vẫn đến sau suy luận (quá thời gian chờ), báo cáo thật thay suy luận đúng một lần; kết quả do Agent báo thì không đổi nữa.
- Phiên có `ended_at` nên được gắn nhãn nguồn gốc (`end_source: reported | reconstructed | inferred`), để UC-008 và Operations phân biệt (khớp domain-model và reboot.md).

## Câu hỏi cho 06
| ADR | Câu hỏi |
|-----|---------|
| Giao thức MQTT | Phiên persistent hay clean; Last Will để phát hiện offline nhanh hơn (BR-019 chỉ nói heartbeat); Hello và heartbeat là một hay hai thông điệp; tương quan yêu cầu và phản hồi; QoS; chu kỳ heartbeat; tham số lùi dần |
| Giao thức đẩy outbox | Kích thước lô, định dạng xác nhận "đến mục n", giới hạn tốc độ, thứ tự trong cùng một topic |
| Đồng hồ | Giờ server trong phản hồi gia hạn là nguồn kiểm tra đồng hồ lệch tự nhiên (trả lời câu hỏi "nguồn kiểm tra" ở swipe-login) |
| Định danh máy | Máy nhân bản từ ảnh đĩa: định danh riêng chỉ cấp lúc đăng ký, không nằm trong ảnh; phát hiện hai máy cùng định danh (broker đá nhau, `boot_id` nhảy liên tục) |

## Tham số chốt sau
Thời gian chờ outbox trước khi suy luận `abandoned`; tham số lùi dần khi kết nối lại.
