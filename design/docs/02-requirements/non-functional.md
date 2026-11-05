# ⚡ non-functional.md

> Các con số cụ thể tạm hoãn. Mục "Tham số chốt sau" liệt kê những giá trị cần quyết định ở 06.

## Availability & Reliability
| ID | Yêu cầu |
|----|---------|
| NFR-A01 | Server ngừng hoạt động không làm PC ngừng cho đăng nhập bằng thẻ trong thời hạn tin cậy (BR-006) |
| NFR-A02 | Mọi PC luôn có đường đăng nhập dự phòng, không bao giờ bị khóa chết; nếu Custom Greeter crash/lỗi kéo dài thì hỗ trợ khôi phục về `lightdm-gtk-greeter` chuẩn qua launcher wrapper hoặc kênh cứu hộ TTY/SSH |
| NFR-A03 | Agent tự kết nối lại MQTT và, khi kết nối lại, báo phiên bản dữ liệu và định danh lần khởi động |
| NFR-A04 | Nhật ký cục bộ và dữ liệu cục bộ không mất khi mất mạng hoặc khởi động lại; thay snapshot nguyên tử |

## Performance
| ID | Yêu cầu |
|----|---------|
| NFR-P01 | Quẹt thẻ cho kết quả gần như tức thì vì không qua mạng |
| NFR-P02 | Thay đổi trên server đến PC online trong thời gian ngắn, có thể quan sát được trên dashboard |
| NFR-P03 | Dashboard phản ánh trạng thái máy gần realtime |

## Security
| ID | Yêu cầu |
|----|---------|
| NFR-SEC01 | TLS cho MQTT và REST API |
| NFR-SEC02 | Mỗi máy xác thực với server bằng định danh riêng, chỉ cấp khi đăng ký bằng enrollment token hợp lệ |
| NFR-SEC03 | UID thẻ không lưu dạng rõ trong CSDL server (mã hóa khi lưu, server giải mã để hiển thị cho admin). Snapshot trên PC chứa khóa so khớp theo máy thay vì UID. Bản ghi nhật ký mang UID của lần quẹt, truyền qua TLS. File dữ liệu cục bộ chỉ root đọc được. Chấp nhận rủi ro: root trên một máy lấy được dữ liệu của máy đó, gồm danh sách khóa so khớp (UID ngắn có thể bị dò ngược) và UID của các lần quẹt tiếp theo tại máy |
| NFR-SEC04 | Phân quyền cho API quản lý |
| NFR-SEC05 | Nhật ký chỉ ghi thêm, không sửa, không xóa |
| NFR-SEC06 | Mật khẩu admin, enrollment token, định danh máy lưu dạng băm hoặc được bảo vệ; token chỉ hiển thị một lần |
| NFR-SEC07 | Tài khoản Linux dùng chung trên máy trạm (`WorkstationProfile`) phải thuộc allowlist của máy trạm (Auto-Discovery đồng bộ với server, nhóm hạn chế `labstudent`), không có quyền sudo không mật khẩu, chỉ thuộc nhóm hạn chế, khóa mật khẩu cục bộ (`passwd -l`) nếu chỉ dùng thẻ. PAM/Agent từ chối xác thực tài khoản ngoài allowlist hoặc UID < 1000. Nhận diện rõ giới hạn: dữ liệu `/home`, lịch sử shell và session web không tự động xóa sau mỗi phiên (BR-020, D-006, D-009) |

## Maintainability
| ID | Yêu cầu |
|----|---------|
| NFR-M01 | PAM module chỉ nói chuyện với agent; toàn bộ logic quyết định ở agent. Module lỗi thì chuỗi PAM tiếp tục, không khóa chết máy |
| NFR-M02 | Tham số vận hành đặt tập trung ở server và đẩy xuống PC, không cần SSH vào từng máy |
| NFR-M03 | Agent và server ghi log truy vấn được |
| NFR-M04 | Có cách cập nhật agent (package hoặc script) |

## Compatibility
| ID | Yêu cầu |
|----|---------|
| NFR-C01 | Ubuntu 22.04+ / Debian 12+ (systemd) với Display Manager LightDM |
| NFR-C02 | Đầu đọc NFC chuẩn PC/SC với pcsclite |
| NFR-C03 | Dashboard chạy trên Chrome và Firefox bản hiện tại |
| NFR-C04 | REST API có version prefix |

## Deployability & Usability
| ID | Yêu cầu |
|----|---------|
| NFR-D01 | Agent đóng gói cài bằng một lệnh (cấu hình LightDM greeter wrapper, PAM module, systemd service), nhận enrollment token qua cấu hình |
| NFR-D02 | Server khởi chạy bằng Docker Compose hoặc script đơn giản |
| NFR-D03 | Tài khoản quản trị đầu tiên tạo lúc cài server, không có mật khẩu mặc định |
| NFR-U01 | Người dùng chỉ cần một hành động: quẹt thẻ |
| NFR-U02 | Màn hình login hiển thị rõ đang xử lý, thành công, từ chối kèm lý do |
| NFR-U03 | Dashboard dùng được không cần đào tạo |

## Tham số chốt sau (06)
Thời hạn tin cậy của dữ liệu cục bộ (thời lượng lease D); chu kỳ heartbeat và số lần bỏ lỡ; thời gian cảnh báo trước khi hết phiên (W); thời gian chờ trước khi cưỡng bức đăng xuất; hạn phiên tối đa (Max Session Duration); thời gian chờ gắn cờ "quá hạn chưa kết thúc"; chu kỳ ghi `last_alive_at`; thời gian chờ Agent lúc khởi động trước greeter; thời gian đẩy outbox khi tắt máy có kế hoạch; ngưỡng lệch đồng hồ; tầm nhìn khi trải lịch lặp (nếu server tính sẵn các khoảng); hạn enrollment token mặc định; thời hạn hiệu lực của cho phép đăng nhập một lần; hạn mức outbox; kích thước tối đa snapshot cho một máy; cửa sổ gộp thay đổi; chu kỳ reconcile định kỳ; thời gian chờ outbox trước khi suy luận abandoned; tham số lùi dần và ngẫu nhiên hóa khi kết nối lại; ngưỡng Stuck (thời gian PendingSync kéo dài của máy Online).