# 🔌 Extension Points

> Tài liệu mô tả các điểm mở rộng kiến trúc dự kiến của Hệ thống Xác thực Phòng Lab qua Thẻ NFC và chiến lược thiết kế (Design Patterns) tương ứng, tuân thủ nguyên tắc Đóng/Mở (Open/Closed Principle).

---

## 1. Danh mục Điểm Mở Rộng (Extension Points)

| Tính năng mở rộng | Điểm mở rộng trong kiến trúc | Design Pattern / Strategy | Trạng thái hiện tại |
|---|---|---|---|
| **Phương thức xác thực bổ sung** (FR-006: Khuôn mặt / Sinh trắc học) | Pipeline thẩm định quẹt thẻ của Edge Agent | Strategy Pattern (`BiometricAuthProvider` interface) | Dự kiến (Nice-to-have). Thư viện nhận diện khuôn mặt xử lý cục bộ tại PC sau khi quẹt thẻ thành công. |
| **Đồng bộ Thời khóa biểu Đào tạo (SIS / ERP)** | Ingest dữ liệu người dùng và lịch học phía Server | Adapter Pattern (`AcademicScheduleProvider` interface) | MVP hỗ trợ nhập trực tiếp qua Dashboard và import file CSV. Giai đoạn sau tích hợp REST API / Webhook từ cổng trường. |
| **Kênh thông báo & Cảnh báo Vận hành** | Operations & Alerting Service trên Server API | Observer / Strategy Pattern (`AlertChannel` interface: Telegram, Email, Webhook) | MVP hiển thị trực tiếp trên Web Dashboard qua polling 3-5s. Mở rộng gửi tin nhắn cảnh báo khi máy offline hàng loạt hoặc phát hiện lệch giờ (`clock_skew_detected`). |
| **Nâng cấp Thẻ NFC có Xác thực Mật mã** (ADR-007 Option 4) | Thư viện đọc thẻ `CardReaderWorker` | Factory Pattern (`CardAuthScheme` interface) | MVP hỗ trợ Static UID thẻ MIFARE Classic / Ultralight. Mở rộng hỗ trợ MIFARE DESFire EV2/EV3 hoặc thẻ chip PKI. |
| **Hỗ trợ Giao diện Đăng nhập khác** | Tầng Display Manager và Greeter tại Edge | Bridge Pattern (`GreeterBridge` interface) | MVP chuẩn hóa trên LightDM GTK Custom Greeter. Mở rộng sang Web-based Greeter nếu có yêu cầu đồ họa cao hơn. |

---

## 2. Hướng dẫn Triển khai Tính năng Mở rộng

### 2.1. Thêm Cổng Tích hợp SIS / ERP mới
1. Định nghĩa class kế thừa interface `AcademicScheduleProvider` trong tầng `Application/Ports`.
2. Triển khai adapter cụ thể trong `Infrastructure/Adapters/SIS`.
3. Đăng ký provider vào Dependency Injection container của Server API.
4. Cấu hình credentials kết nối trong file cấu hình máy chủ.

### 2.2. Thêm Thuật toán Xác thực Sinh trắc học tại Edge
1. Triển khai class kế thừa interface `SecondaryAuthProvider` trong daemon Agent.
2. Cắm bước kiểm tra sinh trắc học vào giữa bước 6 và bước 7 của quy trình `CR-001` (sau khi đã xác định người dùng hợp lệ).
3. Cấu hình bật/tắt module sinh trắc học trong file cấu hình `/etc/nfc-agent/agent.conf`.
