# 📘 Kịch bản vận hành pilot

> Cách vận hành hệ thống trong một học kỳ ở phòng máy pilot (~40 máy, một Admin, kỹ thuật viên phòng máy). Hệ thống chỉ có khái niệm trung lập (user, nhóm, zone, lịch, thẻ); mọi điều đặc thù của trường học (lớp, buổi thi, ngày nghỉ, thẻ sinh viên) được xử lý bằng các thao tác dưới đây, không phải tính năng riêng (D-033). Cài đặt và nâng cấp: [deployment.md](deployment.md). Tham số (lease, hạn phiên…): [Bảng Tham Số](deployment.md#bảng-tham-số).

## Nguyên tắc cần nhớ

| # | Nguyên tắc | Hệ quả vận hành |
|---|---|---|
| 1 | Máy trạm tự quyết định từ snapshot đã nhận (D-001) | Mọi thay đổi trên Dashboard (user, thẻ, lịch) chỉ có hiệu lực ở máy **đã nhận snapshot mới**. Kiểm tra cột đồng bộ trên trang Máy trạm (`in_sync`) trước khi báo người dùng "đã xong" |
| 2 | Lịch là **hợp quyền** | Hai lịch chồng giờ cộng quyền với nhau; lịch mới không ghi đè lịch cũ. Muốn chặn giờ của lịch thường thì phải **tắt** lịch thường |
| 3 | Snapshot mới không cắt phiên đang chạy (BR-010) | Rút ngắn hay tắt lịch không đăng xuất người đang ngồi; kéo dài lịch chỉ có tác dụng khi người đó quẹt lại |
| 4 | Màn hình là xác nhận duy nhất của một lần quẹt (D-034) | Tiếng bíp/đèn xanh của đầu đọc chỉ báo đầu đọc thấy thẻ. Giữ thẻ tới khi màn hình phản hồi; không thấy gì thì quẹt lại |
| 5 | Nhật ký xác định **người mở phiên**, không chứng minh người đang ngồi | Dùng nhật ký để tra cứu, không dùng làm bằng chứng điểm danh |
| 6 | Mất kết nối không làm máy ngừng (lease 24h) | Máy offline vẫn cho quẹt theo snapshot cuối tới khi lease hết; thu hồi thẻ tới máy offline chậm nhất 24h |

## Đầu học kỳ

Theo [Quy Trình Triển Khai Phòng Máy](deployment.md#quy-trình-triển-khai-phòng-máy-đầu-học-kỳ), thêm:

1. **Nhập danh sách**: trang Nhập (CSV `external_id, full_name, email, groups, card_uid`). Luôn bấm **Kiểm tra** trước, đọc từng dòng lỗi/cảnh báo, rồi mới **Áp dụng** (tất cả hoặc không). Một lớp = một nhóm; tên nhóm nên có mã kỳ (ví dụ `CTDL-N1 2026-1`) để cuối kỳ dọn đúng nhóm.
2. **Tạo lịch** cho từng nhóm theo zone (`valid_from`/`valid_to` = đầu/cuối kỳ). Dùng **Kiểm tra** của trang Lịch: không được còn cảnh báo `missing_profile`; `ambiguous_profile` phải hiểu rõ mới lưu.
3. **Người hướng dẫn** là user thường trong một nhóm riêng (ví dụ `Giảng viên 2026-1`) với lịch riêng phủ các buổi họ dạy. Không dùng tài khoản kỹ thuật viên để dạy.
4. **Thẻ dự phòng**: đăng ký sẵn vài thẻ không gắn ai (gắn rồi gỡ, trạng thái `unbound`), đánh số, cất ở phòng kỹ thuật (dùng cho mục "Quên thẻ").
5. **Kiểm tra cuối**: trên vài máy, quẹt một thẻ trong giờ (`granted`) và một thẻ ngoài giờ (`denied(out_of_schedule)`); trang Máy trạm mọi máy `online`, `in_sync`, `Fresh`.

## Hằng ngày (kỹ thuật viên, ~5 phút đầu buổi)

| Kiểm tra | Ở đâu | Bình thường |
|---|---|---|
| Máy online, đồng bộ | Dashboard → Máy trạm | Mọi máy đang bật là `online` + `in_sync`; không có cờ `stuck_sync`, `security_alert`, `ingest_rejects`, `overdue_session`, không có cảnh báo lệch giờ |
| Sự cố | Dashboard → Sự cố | Không có mục mới chưa xử lý (bản ghi bị từ chối khi nhận, phiên quá hạn chưa kết thúc) |
| Server | `GET /api/v1/system/health` hoặc thanh trạng thái Dashboard | `db`, `mqtt` = `ok`; `outbox_backlog` nhỏ; không có `crl_expiring` |
| Sao lưu đêm qua | `systemctl list-timers nfc-backup.timer`, `ls /var/backups/nfc-server/nightly` | Có tệp của đêm qua; `systemctl --failed` trống |

## Tình huống trong buổi

### Người dùng quẹt mà màn hình không phản hồi
Giữ thẻ đặt yên tới khi màn hình hiện thông báo; không thấy gì thì nhấc ra, đặt lại. Đây là giới hạn của đầu đọc (S1: chạm ngắn hơn ~0,4 s không tới được máy, thỉnh thoảng thẻ không cấp nguồn được lúc vừa đặt). Nếu một thẻ **luôn** không đọc được trên mọi máy: thẻ hỏng, xử lý như "Mất / hỏng thẻ".

### Quên thẻ
1. Admin lấy một thẻ dự phòng, **gắn cho chính user đó** (Thẻ → thẻ `unbound` → Gắn). Không tạo user "khách" dùng chung: nhật ký phải ghi đúng người.
2. Đợi máy nhận snapshot (`in_sync`, thường vài giây), rồi người dùng quẹt thẻ dự phòng.
3. Cuối buổi: **Gỡ** thẻ dự phòng khỏi user (về `unbound`), trả về chỗ cất. Thẻ của chính họ không cần làm gì.

### Mất / hỏng thẻ
Khóa thẻ (Thẻ → Khóa). Có hiệu lực ngay trên máy online, chậm nhất 24h trên máy offline (lease). Thẻ mới: đăng ký UID mới cho user. Nếu chưa biết UID của thẻ mới: cho người dùng quẹt thử một lần (ra `denied(unknown_card)`), rồi trên trang Thẻ chọn bản ghi đó trong danh sách lần quẹt thẻ lạ → Đăng ký cho user (FR-073).

### Người dùng mới hoặc vừa được thêm vào nhóm nhưng bị từ chối
Kiểm tra máy đó đã `in_sync` chưa. Máy chưa nhận snapshot mới thì chưa biết user mới (giới hạn của mô hình edge, D-033.6). Máy online sẽ nhận trong vài giây; máy offline thì phải khôi phục mạng.

### Cần thêm giờ (buổi kéo dài)
Admin sửa (hoặc thêm) lịch → kiểm tra máy `in_sync` → người dùng **quẹt lại trước hạn cũ** để gia hạn (D-033.1). Phiên chỉ kéo dài, không bao giờ bị rút ngắn; hạn tối đa 12h tính từ lúc mở phiên. Gia hạn làm máy bận lâu hơn: tranh chấp với lượt kế tiếp do người phụ trách phòng phân xử.

### Mở phòng sớm
Chỉ khi phòng trống: thêm một lịch tạm cho nhóm, một ngày (`valid_from = valid_to`), giờ bắt đầu sớm hơn; xóa sau buổi. Không biến thành lịch thường: lịch chồng nhau cộng quyền và có thể nối dài phiên sang buổi sau.

### Người dùng bỏ đi không đăng xuất
Máy bận tới hết phiên; người khác quẹt sẽ bị từ chối `workstation_busy` (desktop đang mở hiện thông báo "máy đang có người dùng"). Cần giải phóng máy sớm: kỹ thuật viên vào bằng tài khoản quản trị cục bộ (TTY hoặc SSH) chạy `sudo loginctl terminate-user <profile>` (ví dụ `student`), hoặc khởi động lại máy. Agent tự kết thúc phiên và màn hình đăng nhập hiện lại. Dữ liệu chưa lưu của người cũ bị mất.

### Greeter báo "Dữ liệu phòng lab tạm thời quá hạn"
Máy không còn dữ liệu tin cậy (`denied(data_stale)`): đã quá lease vì không nhận được lease mới > 24h, giờ máy bị lùi quá mốc sàn, hoặc máy chưa từng nhận snapshot. Máy từ chối mọi thẻ (fail-closed). Kiểm tra mạng của máy và trạng thái Server/broker; máy nhận lease ngay khi kết nối lại, không cần làm gì trên máy. Trong lúc chờ: kỹ thuật viên đăng nhập bằng mật khẩu (đường dự phòng, BR-004).

## Buổi đặc biệt

| Tình huống | Làm gì | Lưu ý |
|---|---|---|
| **Thi** | Tạo lịch cho nhóm thi (zone, ngày thi, giờ thi). **Tắt** các lịch thường chồng giờ ở zone đó trong ngày thi, **bật lại** sau buổi | Không tắt thì người có lịch thường vẫn vào được (hợp quyền). Ghi lại các lịch đã tắt để bật lại |
| **Ngày nghỉ** | Không làm gì | Hệ thống không có ngày ngoại lệ (D-033.9): lịch vẫn mở khung giờ ngày nghỉ, nhưng phòng đóng cửa nên không có hại. Cần chặn hẳn: tắt lịch trong ngày đó rồi bật lại |
| **Buổi bù** | Lịch một ngày: `valid_from = valid_to` = ngày bù | Xóa hoặc để nguyên sau buổi (đã hết hạn) |
| **Đổi phòng giữa kỳ** | Sửa `target` của lịch sang zone mới | Có hiệu lực khi máy hai zone `in_sync` |

## Cuối học kỳ

1. Đặt `valid_to` của các lịch trong kỳ bằng ngày cuối kỳ (nếu chưa đặt).
2. Dọn thành viên các nhóm của kỳ (thêm thành viên qua CSV chỉ thêm, không bớt: dọn là thao tác riêng của Admin).
3. Người không còn dùng: chuyển user `inactive` (thẻ giữ lịch sử). Thẻ thu hồi để tái sử dụng: Gỡ (`unbound`).
4. Kiểm tra trang Sự cố đã sạch; xuất hoặc lưu lại nhật ký cần cho báo cáo.

## Máy trạm

| Tình huống | Làm gì |
|---|---|
| Cài lại / clone lại một máy | Clone master image (hoặc `sudo nfc-agent reenroll`) → Dashboard → Yêu cầu đăng ký: yêu cầu có cờ trùng → **Duyệt cài lại** |
| Thay máy mới (khác MAC) | Máy mới gửi yêu cầu mới → Duyệt máy mới vào zone; máy cũ → **Vô hiệu hóa** (thu hồi chứng chỉ, D-024) |
| Máy bị nghi xâm phạm / mất | Vô hiệu hóa ngay: máy mất kết nối broker, chỉ còn quẹt được tới khi lease hết (≤ 24h) |
| Cập nhật Agent | `sudo apt install ./nfc-agent_<ver>_amd64.deb` ngoài giờ học; thử 1 máy trước. Rollback: cài lại bản `.deb` cũ |
| Cơ chế phục hồi ổ đĩa mỗi lần khởi động (Deep Freeze, overlay…) | **Phải chừa** `/var/lib/nfc-agent`, `/etc/nfc-agent`, `/etc/machine-id` (D-033.7); nếu không, máy mất định danh hoặc mất nhật ký chưa gửi mỗi lần khởi động lại |
| Làm master image mới | Theo checklist [Master Image](deployment.md#master-image-máy-trạm-checklist), nhất là mục 12 (xóa `machine-id` và `/var/lib/nfc-agent` trước khi clone) |

## Server

### Cập nhật và rollback
Theo [Triển khai Server](deployment.md#triển-khai-server): chạy `install-server.sh` **của bundle mới** với chính bundle đó, ngoài giờ học (máy trạm vẫn cho quẹt trong lúc Server dừng nhờ lease). Bản mới lỗi thì installer tự quay về bản cũ; quay về chủ động bằng `rollback.sh <version>`.

### Sao lưu
- CSDL: tự động 02:30 hằng đêm, giữ 14 bản ở `/var/backups/nfc-server/nightly/`, thêm một bản trước mỗi lần cập nhật. Chép định kỳ ra ngoài máy chủ (ổ khác, máy khác): bản sao lưu nằm cùng ổ với CSDL không cứu được khi hỏng ổ.
- Khóa: **một lần** sau khi cài (và sau mỗi lần xoay khóa UID): `sudo bash /opt/nfc-server/current/deploy/backup/export-keys.sh /root/nfc-keys-<ngày>.enc`, cất tệp và passphrase **ở hai nơi khác nhau**, ngoài máy chủ. Mất `km-master.key` hoặc CA thì phải đăng ký lại mọi máy; mất khóa UID thì không đọc lại được UID trong CSDL.

### Khôi phục CSDL từ bản sao lưu
Khi CSDL hỏng hoặc một cập nhật làm sai dữ liệu:
```bash
sudo systemctl stop nfc-server
# Tệp dump chỉ root đọc được (0600): root mở tệp và đưa vào pg_restore qua stdin.
# --single-transaction: lỗi giữa chừng thì CSDL giữ nguyên như trước khi khôi phục.
sudo sh -c 'cd / && runuser -u postgres -- /usr/lib/postgresql/15/bin/pg_restore --clean --if-exists --single-transaction -d nfclab < "$1"' sh /var/backups/nfc-server/nightly/<tệp>.dump \
  && sudo systemctl start nfc-server
```
Lệnh khôi phục lỗi thì Server **giữ nguyên trạng thái dừng**: đọc lỗi, thử một bản sao lưu khác, chỉ khởi động lại khi khôi phục thành công (máy trạm vẫn cho quẹt theo lease trong lúc chờ).
Dump phải đi cùng **đúng bộ khóa** đang dùng (UID mã hóa bằng khóa trong `/etc/nfc-server/keys`). Mất tối đa 24h nhật ký và thay đổi quản trị kể từ bản sao lưu (RPO đã chấp nhận, [Sao Lưu](deployment.md#sao-lưu)). Sau khi khôi phục, máy trạm tự đồng bộ lại snapshot/lease (D-016), không cần làm gì trên máy.

### Dựng lại máy chủ hỏng hẳn
1. Máy chủ mới cùng `SERVER_NAME` (máy trạm tìm Server theo tên và tin CA cũ).
2. Giải mã bộ khóa **trước** khi cài: `openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -in <tệp .enc> | sudo tar -xz --no-same-owner -C /` để có lại `/etc/nfc-server/keys` và `server.env`, rồi chạy `install-server.sh`. Installer giữ nguyên nội dung các tệp đã có và đặt lại chủ sở hữu `nfcsrv` cho chúng (user `nfcsrv` trên máy mới có thể khác UID máy cũ).
3. Khôi phục CSDL như trên.
4. Nếu không còn bộ khóa: cài mới, phát `ca.pem` mới vào master image và đăng ký lại mọi máy; thẻ phải đăng ký lại.

### Admin quên mật khẩu
Không có đặt lại mật khẩu qua Dashboard. Trên máy chủ: `sudo bash /opt/nfc-server/current/deploy/create-admin.sh <username mới> "<tên>"`, đăng nhập bằng admin mới, vô hiệu hóa admin cũ nếu cần.

## Giới hạn đã chấp nhận (không phải lỗi)

| Giới hạn | Vì sao chấp nhận |
|---|---|
| Thay đổi chỉ có hiệu lực ở máy đã nhận snapshot | Mô hình edge thuần (D-001), đổi lại máy không phụ thuộc Server khi quẹt |
| Thu hồi thẻ tới máy offline chậm tới 24h | Thời lượng lease (ADR-001) |
| Máy bận tới hết phiên khi người dùng bỏ đi | Không có phiên "treo" tự kết thúc theo không hoạt động; xử lý bằng kỹ thuật viên |
| Lịch vẫn mở trong ngày nghỉ | Không có ngày ngoại lệ (D-033.9) |
| Tiếng bíp đầu đọc không phải xác nhận | D-034 |
| Dữ liệu home của profile dùng chung không tự xóa; trình duyệt có thể còn đăng nhập sẵn | Hệ thống là cổng kiểm soát truy cập, không quản lý dữ liệu người dùng (ADR-004) |
