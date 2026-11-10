# Kết quả Spike S1: Đầu đọc thẻ NFC Vật lý & PC/SC (ACR122U USB)

## Câu hỏi
Có thể lấy UID ổn định qua giao thức chuẩn PC/SC (`pcsclite`) trên đầu đọc NFC USB vật lý (ACS ACR122U) hay không? Cơ chế chống quẹt lặp (Debounce) khi thẻ nằm yên có phát đúng một sự kiện theo **BR-007c** không? Sự khác biệt bản chất giữa Static UID (thẻ sinh viên/thẻ ngân hàng) và Random UID (CCCD gắn chip) trên môi trường thực tế như thế nào?

## Cách thử
1. **Kết nối phần cứng:**
   - Cắm đầu đọc USB ACS ACR122U vào máy tính, chuyển tiếp thiết bị qua USB Passthrough vào máy ảo Ubuntu 22.04 LTS (nhận diện: `072f:2200 Advanced Card Systems, Ltd ACR122U`).
   - Xử lý xung đột kernel driver: Blacklist các module `pn533_usb`, `pn533`, `nfc` để giải phóng giao diện CCID cho `pcscd`.
2. **Triển khai Script đo đạc (`s1_read_uid.py`):**
   - Sử dụng thư viện `python3-pyscard` giao tiếp với daemon `pcscd`.
   - Gửi lệnh APDU chuẩn: `FF CA 00 00 00` (PCSC Get Data command for UID).
   - Kiểm tra Answer to Reset (ATR) của thẻ để xác định nhà sản xuất chip.
   - Cài đặt thuật toán Debounce kiểm tra trạng thái thẻ xuất hiện và thẻ rời khỏi vùng từ trường RF.
3. **Thực thi trên thẻ vật lý thật:**
   - Thẻ A: Thẻ ngân hàng gắn chip Contactless.
   - Thẻ B: Căn cước công dân gắn chip (CCCD).
   - Thao tác: Đặt thẻ, giữ yên 5 giây, nhấc ra, đặt lại nhiều lần.

## Kết quả Thực nghiệm

| Ca thử nghiệm | Loại thẻ thực tế | Dữ liệu đo đạc thực tế | Diễn biến & Nhận xét | Đạt? |
|---|---|---|---|:---:|
| **Ca 1: Thẻ Ngân hàng lần 1** | Thẻ chip Contactless | `UID: 1F0820CF`<br>`ATR: 3B 88 80 01 00 73 C8 40 00 00 90 00 62` | Đọc thành công trong < 50ms. Nhận diện 4-byte UID | ✅ Đạt |
| **Ca 2: Debounce (Giữ thẻ)** | Thẻ chip Contactless | Giữ yên thẻ trên đầu đọc 5 giây | Hệ thống giữ trạng thái, **chỉ phát đúng 1 sự kiện duy nhất**, hoàn toàn không bị spam (BR-007c) | ✅ Đạt |
| **Ca 3: Thẻ rời đầu đọc** | Thẻ chip Contactless | Nhấc thẻ ra khỏi đầu đọc | Bắt trúng ngoại lệ `NoCardException`, in sự kiện `[THẺ ĐÃ RỜI ĐẦU ĐỌC]` tức thì | ✅ Đạt |
| **Ca 4: Thẻ Ngân hàng lần 2** | Thẻ chip Contactless | `UID: 1F0820CF` (trùng khớp 100% lần 1) | Xác thực tính ổn định tuyệt đối của **Static UID** | ✅ Đạt |
| **Ca 5: CCCD gắn chip lần 1** | Thẻ CCCD Việt Nam | `UID: 08ECABA0`<br>`ATR: 3B 89 80 01 4D 4B 6A 43 4F 53 2D 33 37 12` | ATR chứa chuỗi `MKjCOS-37` (Java Card OS của MK Smart). Byte đầu là `0x08` | ✅ Đạt |
| **Ca 6: CCCD gắn chip lần 2** | Thẻ CCCD Việt Nam | `UID: 087EE338` (đổi khác hoàn toàn lần 1)<br>`ATR: 3B 89 80 01 4D 4B 6A 43 4F 53 2D 33 37 12` | Xác thực cơ chế **Random UID (RID)** bảo mật chống theo dõi của chuẩn ISO/IEC 14443-3 | ✅ Đạt |
| **Ca 7: CCCD gắn chip trên Agent** | Thẻ CCCD Việt Nam | `UID: 08B042F8` (Lần chạm 3)<br>Log: `❌ TỪ CHỐI: unknown_card` | Kiểm chứng phản ứng phòng vệ của Agent: Từ chối ngay thẻ động không có trong DB ánh xạ (FR-010/FR-011) | ✅ Đạt |
| **Ca 8: Điện thoại thông minh (Smartphone)** | Smartphone (Bật NFC) | Đầu đọc nhận thẻ PICC, UID 4-byte ngẫu nhiên | Cơ chế **Host Card Emulation (HCE)** giả lập thẻ ISO 14443 Type A, sinh RID chống theo dõi | ✅ Đạt |

## Phát hiện Kỹ thuật Đắt giá cho Đồ án

### 1. Phân tích Dữ liệu ATR & Bản chất Random UID của Thẻ CCCD
Chuỗi ATR thu được từ CCCD:
`3B 89 80 01 4D 4B 6A 43 4F 53 2D 33 37 12`
Khi giải mã các byte lịch sử (Historical Bytes) theo ASCII:
- `4D 4B` -> **"MK"** (MK Smart - nhà sản xuất phôi thẻ CCCD Việt Nam).
- `6A 43 4F 53` -> **"jCOS"** (Java Card Operating System).
- `2D 33 37` -> **"-37"** (Phiên bản hệ điều hành chip).

Đồng thời, đối chiếu 2 lần chạm thẻ CCCD:
- Lần 1: `08 EC AB A0`
- Lần 2: `08 7E E3 38`
- **Quy luật:** Byte đầu tiên luôn cố định là **`0x08`** (đây là quy chuẩn quốc tế của ISO/IEC 14443-3 quy định prefix cho Random ID), trong khi 3 byte còn lại được chip tự sinh ngẫu nhiên trong mỗi phiên giao tiếp vô tuyến để bảo vệ quyền riêng tư của công dân (chống bị thiết bị lạ quét lén theo dõi dấu vết vị trí).

### 2. Ý nghĩa Quyết định Kiến trúc (ADR Hardware & Card Mapping)
- **Không thể dùng UID vật lý của CCCD làm định danh tài khoản trực tiếp:** Vì mỗi lần quẹt thẻ sinh ra một UID khác nhau, hệ thống không thể tìm thấy thẻ trong bảng ánh xạ `snapshot.json`. Muốn dùng CCCD bắt buộc phải gửi APDU đọc dữ liệu số CCCD bên trong applet (cần giải thuật mã hóa chuyên dụng).
- **Lựa chọn Thẻ Thích hợp cho Phòng Lab:** Thẻ sinh viên tích hợp chip Mifare Classic / Ultralight hoặc thẻ ngân hàng hỗ trợ Contactless cung cấp **Static UID ổn định 100%**, hoàn toàn phù hợp để làm khóa bảo mật định danh tức thời (Zero-Touch Access).

### 3. Phân tích An toàn Thông tin & Quyền Riêng tư Dữ liệu Thẻ
- **UID (4-byte):** Là mã định danh tần số vô tuyến ở tầng vật lý (ISO 14443 Layer 2/3 Anti-collision). Tuyệt đối **không** chứa số thẻ ngân hàng (16 số PAN), ngày hết hạn, mã bảo mật CVV hay số dư tài khoản; đối với CCCD, mã này là số ngẫu nhiên tạm thời (RID) không chứa số định danh cá nhân hay dữ liệu sinh trắc học.
- **ATR:** Chỉ là thông số cấu hình phần cứng giao tiếp của chip (clock rate, protocol T=0/T=1), không mang tính bảo mật cá nhân. Dữ liệu quét được hoàn toàn an toàn khi lưu trữ log kiểm toán vận hành phòng lab.

## Giới hạn của Bằng chứng (Limitations of Evidence)
- **Quy mô mẫu thử:** Thực nghiệm tập trung phân tích bản chất cơ chế trên 2 mẫu thẻ đại diện (1 thẻ contactless ngân hàng và 1 thẻ CCCD gắn chip), chưa chạy bài đo kiểm 100 lần quẹt liên tục với phôi thẻ sinh viên trường.
- **Cơ chế đọc:** Script thử nghiệm sử dụng vòng lặp kiểm tra định kỳ (polling loop), chưa triển khai mô hình bắt sự kiện trạng thái PC/SC (`SCardGetStatusChange`) và chưa kiểm chứng xử lý sự kiện rút/cắm nóng đầu đọc USB (hotplug) khi daemon đang chạy.
- **Môi trường:** Thiết bị được chuyển tiếp qua USB Passthrough vào máy ảo KVM, chưa thử nghiệm trên môi trường bare-metal phần cứng máy trạm.

## Kết luận
**ĐẠT MỘT PHẦN (PARTIAL PASS) — CẦN CHẠY BỔ SUNG VỚI THẺ SINH VIÊN MIFARE THẬT.**
- **Đã đạt:** Phần cứng đầu đọc ACR122U USB hoạt động ổn định trên Ubuntu 22.04 LTS qua giao thức PC/SC; cơ chế Debounce chống quẹt lặp (BR-007c) vận hành chuẩn xác; chứng minh bằng thực nghiệm sự khác biệt giữa Static UID và Random UID làm cơ sở lựa chọn loại thẻ cho phòng lab.
- **Còn thiếu & Kế hoạch bổ sung:** Để tuân thủ nghiêm ngặt nguyên tắc thực chứng không che giấu giả định, S1 cần bổ sung bài đo kiểm 100 lần quẹt liên tục với phôi thẻ sinh viên trường (MIFARE Classic / Ultralight 4-byte/7-byte), chuyển đổi cơ chế đọc từ polling sang ngắt sự kiện trạng thái `SCardGetStatusChange` và đo khả năng tự phục hồi khi rút/cắm nóng (hotplug) đầu đọc USB.
