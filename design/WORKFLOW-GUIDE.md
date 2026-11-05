# 🧠 Workflow & Hướng Dẫn Viết Thiết Kế

Bộ template này được thiết kế theo triết lý: **Con người làm chủ tư duy và quyết định (Context & Decisions) — AI lo việc định dạng, bổ sung và hoàn thiện (Formatting & Generation).**

Do con người là người viết đầu tiên, bạn **không cần phải viết đẹp hay đúng chuẩn Markdown ngay từ đầu**. Hãy làm theo quy trình và hướng dẫn dưới đây.

---

## 🔄 Quy trình phối hợp Human - AI

Quy trình chuẩn khi làm việc với bất kỳ file nào trong bộ template này:

1. **Nháp thô (Human):** Bạn mở template lên và gạch đầu dòng những gì bạn nghĩ trong đầu. Viết lộn xộn, sai chính tả cũng được. Quan trọng là "đổ" hết ý tưởng, nghiệp vụ, và bối cảnh (context) ra file.
2. **Định dạng (AI):** Giao file nháp cho AI với prompt: *"Hãy format lại các gạch đầu dòng này theo đúng cấu trúc bảng/diagram của template, giữ nguyên ý của tôi."*
3. **Phản biện & Đề xuất (AI):** Yêu cầu AI: *"Dựa vào nội dung đã có, hãy chỉ ra những điểm còn thiếu (gaps), các rủi ro (risks) và đề xuất nội dung bổ sung (như thêm edge cases, failure modes, error codes)."*
4. **Quyết định (Human):** Bạn đọc đề xuất của AI. Thấy cái nào hợp lý thì giữ, cái nào sai business logic thì yêu cầu bỏ đi hoặc sửa lại. Bạn là người chốt.
5. **Hoàn thiện (AI & Human):** AI generate ra file Markdown cuối cùng. Bạn đọc lướt (review) lại lần cuối và lưu file.

---

## 📝 Hướng dẫn cách "Nháp" cho từng Tầng

Khi mở một file lên để viết nháp, hãy tập trung trả lời các câu hỏi sau bằng gạch đầu dòng thô. Đừng mất thời gian vẽ bảng hay diagram, AI sẽ làm việc đó.

### 1. Tầng WHY (01-problem)
- **Tập trung vào:** Vấn đề là gì? Bức xúc hiện tại là gì? Ai đang đau khổ vì quy trình cũ?
- **Đừng viết:** Giải pháp công nghệ, màn hình ứng dụng.
- **Cách nháp:** *"Hiện tại sale toàn nhập file excel, cuối ngày gửi kho, hay bị mất đơn. Khách thì nhắn tin Zalo không biết đơn tới đâu. Mục tiêu là tự động hóa cái này."*

### 2. Tầng WHAT (02-req, 03-domain, 04-use-cases)
- **Tập trung vào:** Khái niệm thực tế (Domain) và Hành động (Use Case).
- **Đừng viết:** Database tables, API JSON.
- **Cách nháp (Domain):** *"Trong hệ thống này có Khách hàng, Đơn hàng, Sản phẩm. Một đơn hàng có nhiều Sản phẩm. Chỉ thế thôi."*
- **Cách nháp (Use Case):** *"Khách hàng có thể: Đăng nhập, Thêm giỏ hàng, Thanh toán. Admin có thể: Hủy đơn, Hoàn tiền."*

### 3. Tầng WHEN / BEHAVIOR (05-behavior)
- **Tập trung vào:** Dòng thời gian, luồng sự kiện, trạng thái trước/sau.
- **Đừng viết:** Code logic chi tiết.
- **Cách nháp (Workflow/State):** *"Đơn hàng tạo ra thì trạng thái là CHỜ THANH TOÁN. Trả tiền xong thì ĐÃ THANH TOÁN. Nếu 15p không trả thì ĐÃ HỦY. Vẽ hộ tôi cái state machine."*

### 4. Tầng HOW (06-architecture, 07-data, 08-api)
- **Tập trung vào:** Quyết định kiến trúc (REST hay gRPC, Monolith hay Microservice), các entity cần lưu.
- **Đừng viết:** Cấu hình chi tiết, mã nguồn.
- **Cách nháp (Architecture):** *"Dự án này làm Monolith thôi cho nhanh, backend Golang, Postgres. Thêm cái Redis để cache. Hãy vẽ sơ đồ C4 Container cho tôi."*
- **Cách nháp (API):** *"Tôi cần API tạo đơn hàng, đầu vào là List Product ID, trả ra Order ID. Xử lý idempotency giúp tôi."*

### 5. Tầng CROSS-CUTTING (09-security, 10-failure, 11-operations)
- **Tập trung vào:** Chuyện gì xảy ra nếu hệ thống "cháy"? Ai được phép làm gì?
- **Đừng viết:** Chi tiết setup server.
- **Cách nháp (Failure):** *"Nếu bên thứ 3 thanh toán bị sập thì sao? Chắc phải cho retry 3 lần, không được thì báo lỗi. AI viết thêm các trường hợp lỗi mạng khác đi."*
- **Cách nháp (Security):** *"Khách chỉ được xem đơn của mình. Admin xem được hết. Chấm hết."*

---

## 💡 Prompt tham khảo để chat với AI

Dưới đây là một số prompt bạn có thể copy-paste khi làm việc với AI:

> *"Tôi vừa nháp thô các ý tưởng vào file `docs/01-problem/problem.md`. Hãy format lại cho đúng cấu trúc template."*

> *"Dựa vào `domain-model.md` và `use-cases`, hãy vẽ sequence diagram cho luồng 'Khách hàng thanh toán đơn hàng', lưu vào `05-behavior/sequences/pay-order.md`."*

> *"Hãy đóng vai một chuyên gia hệ thống khó tính, review file `07-data/data-model.md` và chỉ ra những rủi ro về concurrency hoặc thiếu index."*
