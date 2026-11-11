# 📖 glossary.md

> Ubiquitous Language. Ví dụ lấy từ bối cảnh pilot (phòng máy đại học).

## Danh tính (Identity)
| Thuật ngữ | Định nghĩa | Ví dụ |
|---|---|---|
| **User** | Người quẹt thẻ. Không xóa cứng, chỉ chuyển `inactive` | Sinh viên Minh |
| **Inactive / Disabled / Unbound** | `inactive`: user không còn quyền. `disabled`: thẻ bị khóa. `unbound`: thẻ chưa gắn chủ | SV tốt nghiệp → inactive; thẻ mất → disabled |
| **Card** | Liên kết giữa UID của thẻ NFC do tổ chức cấp và một User. Hệ thống không quản lý thẻ vật lý | Thẻ sinh viên UID 04A32B |
| **CardUid** | UID đã chuẩn hóa | `04:a3:2b` và `04A32B` là một |
| **Group** | Tập User, dùng làm đối tượng của Schedule | Nhóm "CNTT K20" |
| **AdminAccount** | Tài khoản người quản trị đăng nhập dashboard | Anh Tuấn |

## Thiết bị (Device)
| Thuật ngữ | Định nghĩa | Ví dụ |
|---|---|---|
| **Workstation** | PC Linux cài Agent | PC-01 ở Lab 301 |
| **WorkstationProfile** | Profile tài khoản Linux dùng chung được khai báo trong allowlist của máy trạm | `student`, `labuser` |
| **Zone** | Nhóm máy theo phòng, danh sách phẳng | Phòng Lab 301 |
| **Agent** | Phần mềm chạy trên mỗi PC: đọc thẻ, giữ dữ liệu cục bộ, quyết định đăng nhập, báo cáo | Service daemon kèm PAM module |

## Lịch (Scheduling)
| Thuật ngữ | Định nghĩa | Ví dụ |
|---|---|---|
| **Schedule (Lịch)** | Một dòng gồm ai (Subject), ở đâu (Target), khi nào (RecurrenceRule) và Profile đích tùy chọn (`target_os_username`) | "CNTT K20, Lab A, T2-T6 7h-17h, profile student" |
| **Subject** | Đúng một User hoặc một Group | Nhóm "CNTT K20" |
| **Target** | Đúng một Workstation hoặc một Zone | Zone "Lab A" |
| **RecurrenceRule** | Ngày trong tuần, giờ bắt đầu và kết thúc (kết thúc có thể 24:00), khoảng ngày hiệu lực | T2 đến T6, 07:00 đến 17:00 |
| **Giờ triển khai** | Giờ theo múi giờ của lần triển khai. Mọi khung giờ hiểu theo giờ này | "07:00" là 07:00 giờ triển khai |

## Đồng bộ (Distribution)
| Thuật ngữ | Định nghĩa | Ví dụ |
|---|---|---|
| **Snapshot** | Bản dữ liệu server dựng riêng cho một máy, chỉ chứa phần liên quan tới máy đó, có số phiên bản | Snapshot v12 của PC-01 |
| **Snapshot version** | Số tăng dần theo máy; PC không nhận bản cũ hơn bản đang dùng | v12 thay v11 |
| **SyncState** | Phiên bản server mong muốn và phiên bản PC đã xác nhận | PC-03 đang ở v10, mong muốn v12 |
| **Thời hạn tin cậy (Lease)** | Khoảng thời gian PC được tin dữ liệu cục bộ kể từ lần nhận snapshot gần nhất. Quá hạn thì ngừng cho vào bằng thẻ | PC mất liên lạc quá hạn → từ chối quẹt thẻ |
| **Dữ liệu hết hạn (stale)** | Trạng thái PC chưa có snapshot hoặc quá thời hạn tin cậy hoặc đồng hồ lệch | Lý do từ chối `data_stale` |

## Đăng nhập và vận hành (Edge, Operations)
| Thuật ngữ | Định nghĩa | Ví dụ |
|---|---|---|
| **LoginDecision** | Kết quả PC đánh giá một lần quẹt thẻ: cho vào, từ chối hoặc lỗi | Cho Minh vào PC-01 đến 17:00 |
| **Session** | Từ khi người dùng đăng nhập thành công đến khi phiên kết thúc; có hạn | Phiên của Minh 08:00 đến 11:00 |
| **Abandoned session** | Phiên kết thúc mà không có báo cáo (máy khởi động lại, bị phiên mới thay) | Mất điện khi đang đăng nhập |
| **Heartbeat** | Tín hiệu định kỳ PC gửi để báo còn hoạt động, kèm BootId và phiên bản dữ liệu | |
| **Online / Offline** | Trạng thái kết nối từ heartbeat. "Đang dùng" suy ra từ Session active | |
| **BootId** | Định danh một lần khởi động máy | boot_id đổi → máy đã reboot |
| **Audit Log** | Nhật ký bất biến mỗi lần quẹt thẻ, kèm ảnh chụp danh tính, máy và phiên bản dữ liệu | Thẻ lạ quẹt 2h sáng vẫn được ghi |
| **AuditOutbox** | Hàng đợi nhật ký trên PC chờ server xác nhận | |
| **Snapshot (ảnh chụp dữ liệu)** | Dữ liệu tại thời điểm sự kiện (tên, mã, hostname) lưu trong Audit Log | Log giữ tên Minh lúc quẹt |
| **Fallback** | Đường đăng nhập cục bộ dự phòng, ngoài nền tảng, không tạo Session | Admin đăng nhập root khi cần |
| **CardMatchKey** | Khóa so khớp thẻ trong snapshot, tính bằng HMAC của UID với khóa riêng theo máy. Snapshot không chứa UID gốc | PC tính từ UID quẹt rồi tra snapshot |

> Lưu ý: "Snapshot" ở mục Đồng bộ là bản dữ liệu gửi xuống máy; "ảnh chụp" trong Audit Log là dữ liệu danh tính tại thời điểm sự kiện. Hai khái niệm khác nhau, không dùng lẫn.

## Acronyms
NFC, PAM, PC/SC, UID, MAC, MQTT (giao thức nhắn tin nhẹ, kênh server ↔ PC), API, UUID.

## Bounded Context Mapping
| Thuật ngữ | Identity | Device | Scheduling | Distribution | Operations | Edge |
|---|---|---|---|---|---|---|
| **User** | Thông tin và trạng thái | N/A | Subject của Schedule | Mục user trong snapshot | Người thực hiện phiên | Mục user trong LocalSnapshot |
| **Card** | Liên kết UID và chủ thẻ | N/A | N/A | Mục thẻ trong snapshot | Ảnh chụp trong Audit Log | Dùng để tra chủ thẻ |
| **Workstation** | N/A | Cấu hình tĩnh | Target của Schedule | Đích của snapshot | Trạng thái online | Máy mà agent chạy |
| **Schedule** | N/A | N/A | Nguồn gốc | Mục lịch trong snapshot | N/A | Dùng để đánh giá |