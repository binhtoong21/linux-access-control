# 📊 as-is.md

## Hiện trạng
Máy Linux ở phòng máy đăng nhập bằng tài khoản cục bộ với mật khẩu dùng chung. Mật khẩu được thông báo miệng hoặc qua Zalo. Không có quản lý lịch, không theo dõi máy; mọi việc làm thủ công.

## Quy trình hiện tại
- Admin tạo tài khoản và mật khẩu trên từng máy, báo cho nhóm sinh viên.
- Khi thay đổi nhân sự: admin đi từng máy đổi mật khẩu rồi báo lại.
- Kiểm tra máy: đi bộ xem từng máy.
- Sự cố: không biết ai đã dùng máy.

## Hạn chế
| # | Hạn chế | Nguyên nhân |
|---|---------|------------|
| 1 | Không truy vết danh tính | Tài khoản dùng chung |
| 2 | Mật khẩu dễ lộ | Một mật khẩu cho nhiều người |
| 3 | Đổi mật khẩu thủ công trên từng máy | Không quản lý tập trung |
| 4 | Không giới hạn theo giờ | Mật khẩu tĩnh |
| 5 | Sinh viên hay quên mật khẩu | Mật khẩu đổi liên tục |
| 6 | Không biết trạng thái máy | Không có giám sát |

## Công nghệ hiện có
- Linux (Ubuntu/Debian), có cơ chế PAM để cắm module xác thực.
- Thẻ NFC của sinh viên/nhân viên đã có, hiện chỉ dùng ở cổng.
- Đầu đọc NFC chuẩn PC/SC chưa có trên máy nhưng mua được, hoạt động ổn trên Linux.

## Giải pháp có sẵn
LDAP/FreeIPA, pam_pkcs11 và phần mềm quán net giải quyết từng phần nhưng không có lịch theo nhóm người, máy và giờ, cũng không có agent đồng bộ và theo dõi máy cho Linux.

## Lessons Learned
- Cần thay mật khẩu chung bằng định danh cá nhân qua thẻ NFC đã có.
- Cần quản lý lịch tập trung thay cho quy định miệng.
- Máy cần chạy được theo dữ liệu cục bộ để không phụ thuộc mạng.