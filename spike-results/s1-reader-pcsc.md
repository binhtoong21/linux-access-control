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

## Lần Đo Bổ Sung (2026-11-11): Thẻ Static UID & `SCardGetStatusChange`
- **Môi trường:** Ubuntu 22.04.5 (VM VirtualBox, USB passthrough), ACR122U `072f:2200`, `pcscd` + `libccid`, `python3-pyscard`. Phải chặn `pn533_usb`/`pn533`/`nfc` trước (kernel chiếm đầu đọc, `pcscd` không thấy), đã đưa vào checklist Master Image (`deployment.md` mục 3b).
- **Cách đọc:** chờ sự kiện bằng `SCardGetStatusChange` (không polling), khi trạng thái chuyển sang `PRESENT` thì kết nối và gửi APDU `FF CA 00 00 00`.
- **Thẻ:** 1 thẻ static UID, ATR `3B8880010073C8400000900062` (ISO 14443-4 type A).

| Chỉ số | Kết quả |
|---|---|
| Lần đặt thẻ | 8 |
| Đọc thành công | 5/8, UID `1F0820CF` (4 byte, `SW=9000`) **giống nhau cả 5 lần** |
| Sự kiện đặt / nhấc thẻ | 8/8 lần đặt và 8/8 lần nhấc đều được phát hiện, không có sự kiện trùng |
| Lỗi kết nối ngay khi vừa đặt thẻ | 3/8: `Unable to connect with protocol: T0 or T1. Card is unresponsive.` |

**Phát hiện:** khi thẻ mới chạm mép trường RF hoặc chạm quá nhanh, `pcscd` đã báo `PRESENT` nhưng kết nối thất bại. Nếu Agent coi đó là một lần quẹt lỗi thì sinh viên thấy báo lỗi và nhật ký có thêm bản ghi `error(reader_error)` cho một cú chạm vội. **Hiệu chỉnh (M1):** khi thẻ còn `PRESENT`, Agent thử kết nối lại trong một khoảng ngắn (ví dụ tối đa 3 lần cách nhau 100 ms) rồi mới ghi `reader_error`; nếu thẻ rời đi trước khi đọc được UID thì không tính là một lần quẹt (BR-007c: lần quẹt gắn với UID đã đọc được).

### Rút/cắm nóng đầu đọc với `SwipeDetector` của Agent (2026-11-11)
Chạy `nfc_agent.infra.reader` (PcscBackend + SwipeDetector) với đầu đọc thật trên VM.
- **Lần 1:** 3/3 quẹt đọc đúng `1F0820CF`; rút đầu đọc → `ReaderUnavailable` đúng 1 lần. Lộ 2 lỗi của Agent: (a) chạm vội vẫn ra `reader_error (Card is unpowered)` vì kiểm tra "thẻ còn trên đầu đọc" dùng trạng thái cache cũ; (b) khi không có đầu đọc, `pcscd` trả lỗi ngay nên vòng lặp quay liên tục. Đã sửa: hỏi trạng thái thật với timeout 0, và chờ hết chu kỳ khi không có thiết bị.
- **Lần 2 (sau khi sửa, 235 s):** đầu đọc vắng mặt từ đầu → `ReaderUnavailable` 1 lần; ~167 s sau gắn lại thì Agent tự nhận và đọc 3/3 quẹt `1F0820CF` mà không khởi động lại; CPU của tiến trình cả lượt chỉ **0,12 s**.
- **Chưa đo lại sau khi sửa:** chạm vội và để thẻ nằm yên (đã có test đơn vị `tests/test_reader.py`).

### `pcscd` khởi động lại trong lúc Agent đang chạy (2026-11-20)
- **Tình huống:** Đầu đọc bị ngắt USB passthrough rồi gắn lại. Thiết bị treo (`LIBUSB_ERROR_TIMEOUT`, `RFAddReader() … init failed`) nên phải `usbreset` và khởi động lại `pcscd`. Sau đó `pcscd` thấy đầu đọc, nhưng Agent không đọc thêm thẻ nào và không ghi log; quẹt thật không có phản hồi. `systemctl restart nfc-agent` thì quẹt được ngay.
- **Nguyên nhân:** Agent tạo context PC/SC một lần lúc khởi động. Sau khi `pcscd` khởi động lại, mọi lệnh trên context cũ trả `0x8010001D` (`SCARD_E_NO_SERVICE`), còn context mới thì liệt kê lại được đầu đọc (đo trên vm2). Máy im lặng ngừng nhận thẻ cho tới khi khởi động lại. Trường hợp này có thể xảy ra ngoài đời: nâng cấp gói, `pcscd` crash. Bài thử hotplug ngày 2026-11-11 chỉ rút và cắm đầu đọc trong khi `pcscd` vẫn chạy, nên không phủ trường hợp này.
- **Sửa:**
  - Agent tạo context khi cần. Gặp `NO_SERVICE`, `SERVICE_STOPPED` hoặc `INVALID_HANDLE` thì bỏ context cũ và tạo lại.
  - Ghi log `card reader available` khi đầu đọc quay lại.
  - Thẻ đang nằm yên qua lần mất context không bị tính là lần quẹt mới (BR-007c).
- **Kiểm chứng trên vm2 (gói `0.1.0-4`):**
  - Khởi động lại `pcscd`: `card reader unavailable: RPC transport error.` rồi `card reader available` sau 1 s.
  - Quẹt thẻ số 3 sau đó ra `noop` đúng UID.
  - Khởi động lại `pcscd` lúc thẻ đang nằm: không có lần quẹt lặp. Nhấc thẻ ra và đặt lại: đúng một lần quẹt.

## Lần Đo Bổ Sung (2026-11-20): Thẻ NTAG215 7 byte, Agent Đóng Gói Dưới Hardening, 100 Lần Quẹt

- **Môi trường:** vm2 (Ubuntu 22.04, VirtualBox, USB passthrough), ACR122U `072f:2200`, `pcscd` 1.9.5 + `libccid` 1.5.0. Agent cài từ gói `nfc-agent_0.1.0-2` (M5.1), unit có đủ hardening ADR-006/S11, đọc PC/SC thật (bỏ `--reader sim`), nối server dev qua MQTT.
- **Thẻ:** 10 thẻ NTAG215 đánh số 1–10.
- **Công cụ:** script đọc UID/ATR bằng `SCardGetStatusChange` + `FF CA 00 00 00` (`s1_capture.py`); bộ theo dõi thụ động chỉ ghi chuyển trạng thái của `pcscd` (`s1_monitor.py`, không kết nối thẻ); chạy chính `SwipeDetector` + `PcscBackend` của Agent có ghi vết từng lệnh gọi (`s1_trace.py`).

### Đọc UID 10 thẻ
| # | UID | # | UID |
|---|---|---|---|
| 1 | `046E1296E82A81` | 6 | `046B1A9EE82A81` |
| 2 | `04556795E82A81` | 7 | `04255B9CE82A81` |
| 3 | `0432C89DE82A81` | 8 | `041B659AE82A81` |
| 4 | `04E49396E82A81` | 9 | `04FA729EE82A81` |
| 5 | `04AF6398E82A81` | 10 | `04A1679DE82A81` |

- 10/10 UID **7 byte**, byte đầu `04` (NXP), đọc được ở lần kết nối đầu, 10 UID khác nhau; thẻ đọc lại ở lần chạy sau cho cùng UID.
- ATR chung `3B8F8001804F0CA0000003060300030000000068` (PC/SC Part 3, tên thẻ `0003` = họ Mifare Ultralight/NTAG).
- 10 thẻ được gán cho 10 user bằng nhập CSV (`POST /imports/roster`, D-033.2): chạy thử rồi áp dụng, 10 user + 10 thẻ, 0 lỗi; Agent nhận snapshot mới qua MQTT.

### Đăng nhập thật
Thẻ số 1 trên greeter → `granted`, phiên `student` GNOME trên `seat0`; server nhận bản ghi audit trong < 1 s. Đây là lần đầu Agent đọc đầu đọc thật dưới hardening systemd (khoảng trống ghi ở S11): đạt, không cần thêm quyền.

### Các đợt quẹt có kiểm soát (thẻ số 1, phiên đang mở)
Người quẹt mô tả đầu đọc: đèn đỏ, khi phát hiện thẻ thì chuyển xanh và bíp một tiếng. "Quẹt bình thường" = thấy xanh + bíp là nhấc ra.

| Đợt | Cách quẹt | Lần quẹt | `pcscd` thấy | Agent đọc được | Ghi chú |
|---|---|---|---|---|---|
| A (Agent thật) | bíp là nhấc | 10 | 6 | 1 | 2 lần thẻ `MUTE` → `error(reader_error)`; 3 lần thẻ nằm 0,25 s, đọc hỏng rồi thẻ đã rời đi (không tính là quẹt) |
| A2 (ghi vết) | bíp là nhấc | — | 6 | 2 | 2 lần `MUTE`: `SCardConnect` trả `Card is unpowered` cả 3 lần thử; 1 lần `GET UID` trả `63 00` khi thẻ đang rời |
| A3 (ghi vết, thử lại tới 4 s) | giữ ~2 s sau bíp | 10 | 10 | 10 | không có `MUTE` |
| B (ghi vết, thử lại tới 4 s) | tự nhiên | 20 | 17 | 16 | 1 lần thẻ không phản hồi suốt ~1,1 s (11 lần thử) rồi bị nhấc |
| C (ghi vết) | để yên 10–15 s | 3 | 3 | 3 | đúng 1 sự kiện mỗi lần (BR-007c) |

### Đo chính thức 100 lần (Agent thật, người quẹt tự đếm)
90 lần quẹt bình thường + 10 lần để thẻ nằm yên vài giây, trong ~3 phút 45 giây.

| Chỉ số | Kết quả |
|---|---|
| Lần quẹt | 100 |
| `pcscd` thấy thẻ đặt lên | 84 (bộ đếm sự kiện `186 → 354`, đúng 2 sự kiện mỗi lần đặt/nhấc) |
| Agent ghi nhận | 82 = 77 `noop(already_active)` + 5 `error(reader_error)` (3 lần thẻ `MUTE`) |
| Thẻ rời đi trước khi đọc xong (không tính, BR-007c) | 2 |
| Sự kiện trùng khi để thẻ nằm yên | 0 (11 lần thẻ nằm ≥ 2 s, mỗi lần đúng 1 bản ghi) |
| UID đọc được | 77/77 đúng `046E1296E82A81` |
| Server | 77 `noop` + 5 `error`, khớp đúng với `edge.db`, không có `granted` hay phiên thứ hai |

### Phát hiện
1. **Tiếng bíp của đầu đọc không phải xác nhận của hệ thống.** Đèn xanh và tiếng bíp do firmware ACR122U tự phát khi phát hiện thẻ, trước khi máy tính kịp đọc. `libccid` hỏi trạng thái đầu đọc theo chu kỳ (thời gian thẻ nằm đo được dồn quanh 0,43 s), nên những cú chạm ngắn hơn chu kỳ đó không bao giờ tới `pcscd`: 16/100 lần quẹt ở lượt đo chính thức, 4/10 ở đợt A, 3/20 ở đợt B. Khi thẻ tới được Agent, UID đọc xong trong khoảng 10 ms.
2. **Thẻ `MUTE` lúc đặt vào.** Thỉnh thoảng `pcscd` báo thẻ có mặt nhưng không cấp nguồn được (`SCARD_STATE_MUTE`, `Card is unpowered`): 3 trên 84 lần ở lượt chính thức, 2/6 ở đợt A và đợt A2, 0/10 ở đợt A3. Thử kết nối lại trong lúc thẻ còn nằm trên đầu đọc không cứu được: ở đợt B, một lần thẻ không phản hồi vẫn hỏng sau 11 lần thử. Agent ghi `error(reader_error)`. Greeter hiện "Không đọc được thẻ, vui lòng quẹt lại!", nhưng khi đã có phiên thì desktop không báo gì, nên người quẹt thấy "để thẻ yên mà không có thông báo".
3. **Thông báo "tắt rồi vẫn hiện lại".** Mỗi lần quẹt lại khi đang có phiên gửi một thông báo `critical`; GNOME xếp hàng các thông báo này, tắt cái đang hiện thì cái sau hiện ra. Không phải sự kiện quẹt trùng (bộ đếm `pcscd` và nhật ký khớp nhau).

Quyết định theo các phát hiện này: D-034 (giữ thẻ tới khi màn hình phản hồi, không điều khiển đầu đọc, không sửa Agent).

## Giới hạn của Bằng chứng (Limitations of Evidence)
- **Loại thẻ và đầu đọc:** Thẻ thật đã thử: 1 thẻ static UID 4 byte, 1 thẻ CCCD (random UID), 10 thẻ NTAG215 (7 byte). Chưa thử Mifare Classic 1K, thẻ 10 byte, và chỉ có một dòng đầu đọc (ACR122U) nên chưa so được thứ tự byte giữa các dòng (ADR-007).
- **Tỉ lệ ghi nhận** đo ở một người quẹt, một đầu đọc, máy ảo qua USB passthrough; chưa đo trên máy trạm thật (bare-metal), nơi chu kỳ hỏi của `libccid` có thể khác.
- **Cơ chế đọc:** `SCardGetStatusChange` (đạt), rút/cắm nóng (đạt, 2026-11-11), đọc dưới hardening systemd (đạt, 2026-11-20), `pcscd` khởi động lại (đạt sau khi sửa Agent, 2026-11-20).

## Kết luận
**ĐẠT CÓ ĐIỀU KIỆN.**
- **Đã đạt:** UID ổn định cho thẻ 4 byte và 7 byte; 0 sự kiện trùng khi thẻ nằm yên (BR-007c); không có quyết định sai (mọi lần đọc được đều đúng UID, không tạo phiên thứ hai); phục hồi khi rút/cắm đầu đọc; Agent đóng gói đọc được đầu đọc dưới hardening; phân biệt được Static UID với Random UID.
- **Điều kiện:** Tiêu chí ban đầu "100 lần quẹt, 0 lần lỡ" chỉ đạt khi người dùng giữ thẻ tới lúc màn hình phản hồi (đợt A3: 10/10). Với thói quen "bíp là nhấc", đo được 82/100 lần quẹt tới được Agent và 77/100 đọc được UID; lần lỡ do chu kỳ hỏi của driver và thẻ `MUTE`, không do logic của Agent. Người dùng quẹt lại khi màn hình không phản hồi (D-034).
