# 🔌 Extension Points

> Liệt kê các điểm hệ thống dự kiến mở rộng và chiến lược (strategy) cho từng điểm. Giúp định hướng thiết kế đóng/mở (Open/Closed Principle).

## Điểm mở rộng (Extension Points)

| Tính năng | Điểm mở rộng | Design Pattern / Strategy | Trạng thái hiện tại |
|-----------|--------------|---------------------------|---------------------|
| Thanh toán | Thêm cổng thanh toán mới | Strategy Pattern (PaymentProvider interface) | Đã có Momo, VNPay |
| Thông báo | Thêm kênh thông báo mới | Factory / Strategy | Đã có Email |
| | | | |

## Hướng dẫn Implement tính năng mới

**Để thêm một Cổng thanh toán mới:**
1. Tạo class implement interface PaymentProvider
2. Đăng ký provider mới vào Dependency Injection container
3. Thêm config key tương ứng
