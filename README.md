# NFC Workstation Access Control

Đăng nhập máy trạm Linux bằng thẻ NFC. Mỗi máy tự quyết định cho hay không cho đăng nhập dựa trên dữ liệu được ký do server đẩy xuống, nên vẫn hoạt động khi mất mạng.

[![CI](https://github.com/binhtoong21/linux-access-control/actions/workflows/ci.yml/badge.svg)](https://github.com/binhtoong21/linux-access-control/actions/workflows/ci.yml)
[![Tag](https://img.shields.io/github/v/tag/binhtoong21/linux-access-control?sort=date&label=release)](https://github.com/binhtoong21/linux-access-control/tags)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
![Ubuntu 22.04](https://img.shields.io/badge/edge-Ubuntu%2022.04-E95420)
![Python 3.10](https://img.shields.io/badge/python-3.10-3776AB)
![Node 20](https://img.shields.io/badge/node-20-339933)

## Tổng quan

Hệ thống thay việc gõ mật khẩu chung ở các phòng máy dùng chung bằng một lần quẹt thẻ. Server lưu người dùng, thẻ, lịch sử dụng và chính sách; Agent trên từng máy nhận bản snapshot của riêng máy đó, tự đánh giá mỗi lần quẹt và ghi nhật ký kiểm toán.

Hệ thống trung lập về miền ứng dụng: phòng máy thực hành chỉ là kịch bản thử nghiệm đầu tiên. Thẻ dùng để thử là loại UID tĩnh (NTAG215, Mifare Classic 1K).

**Điểm chính**

- **Quyết định tại máy trạm.** Agent đánh giá cục bộ từ snapshot, không hỏi server lúc quẹt. Snapshot có lease: hết hạn tin cậy thì từ chối thay vì đoán, nhưng mất kết nối không khóa máy ([ADR-001](design/docs/06-architecture/decisions/ADR-001-xac-thuc-o-edge-va-lease.md)).
- **Snapshot ký, UID băm theo máy.** Mỗi máy nhận snapshot đầy đủ có chữ ký, UID thẻ đã HMAC bằng khóa riêng của máy. Server lưu UID mã hóa AES-256-GCM kèm blind index ([ADR-003](design/docs/06-architecture/decisions/ADR-003-luu-tru-cuc-bo-va-xac-thuc-snapshot.md), [ADR-007](design/docs/06-architecture/decisions/ADR-007-khoa-so-khop-uid.md)).
- **Profile OS dùng chung.** Không tạo tài khoản Linux theo từng người; danh tính người dùng nằm trong nhật ký, phiên chạy dưới profile như `student`. Hết giờ hoặc đăng xuất, phiên được dọn theo nhiều pha ([ADR-004](design/docs/06-architecture/decisions/ADR-004-mo-hinh-profile-os-dung-chung.md), [ADR-008](design/docs/06-architecture/decisions/ADR-008-vong-doi-phien-va-teardown-da-pha.md)).
- **Đăng ký máy không cần chạm tay.** Máy nhân bản từ master image tự sinh khóa, gửi yêu cầu, chờ admin duyệt trên dashboard; thu hồi bằng CRL của Mosquitto ([ADR-002](design/docs/06-architecture/decisions/ADR-002-giao-thuc-mqtt-va-dinh-danh-may-tram.md)).
- **Nhật ký ghi bền trước khi quyết định.** Không ghi được nhật ký thì không cho đăng nhập. Nhật ký đi về server qua outbox có ký, không bao giờ kẹt vì một bản ghi lỗi.
- **Có đường dự phòng.** Kỹ thuật viên và admin vẫn đăng nhập bằng mật khẩu từ cùng màn hình greeter ([ADR-005](design/docs/06-architecture/decisions/ADR-005-pam-greeter-va-display-manager.md)).

## Kiến trúc

```mermaid
flowchart LR
    Card(["Thẻ NFC"]) --> Reader["Đầu đọc PC/SC"]

    subgraph WS["Máy trạm Ubuntu 22.04"]
        Reader --> Agent["NFC Agent<br/>Python, systemd"]
        Agent <--> DB[("edge.db<br/>SQLite WAL")]
        Greeter["Lab Greeter<br/>GTK"] <--> Agent
        PAM["pam_nfc.so<br/>C"] <--> Agent
        Greeter --> LightDM["LightDM"] --> PAM
        LightDM --> Desktop["Phiên desktop<br/>profile dùng chung"]
    end

    subgraph SRV["Máy chủ"]
        Broker["Mosquitto<br/>MQTT 5 + mTLS"]
        Server["Server<br/>NestJS"]
        PG[("PostgreSQL")]
        Dash["Dashboard<br/>React"]
        Server <--> Broker
        Server <--> PG
        Dash -->|"HTTPS REST"| Server
    end

    Agent <-->|"snapshot, lease, heartbeat, audit"| Broker
    Admin(["Admin"]) --> Dash
```

Sơ đồ C4 đầy đủ: [context](design/docs/06-architecture/context.md), [containers](design/docs/06-architecture/containers.md), [components](design/docs/06-architecture/components.md).

### Một lần quẹt thẻ

1. Agent nhận UID từ đầu đọc qua PC/SC và chuẩn hóa.
2. Agent tính HMAC của UID bằng khóa của máy rồi tra trong snapshot, kiểm lease và mốc thời gian sàn.
3. Luật đánh giá CR-001 kiểm thẻ, người dùng, lịch và chọn đúng một profile OS. Máy đang có người khác dùng thì từ chối (`workstation_busy`), chính người đó quẹt lại thì gia hạn hoặc bỏ qua (`noop`).
4. Kết quả (`granted` / `denied` / `error` / `noop`) được ghi bền vào `edge.db` trước khi trả lời.
5. Greeter nhận tín hiệu, PAM mở phiên desktop dưới profile đã chọn. Bộ đếm phiên chạy theo `CLOCK_BOOTTIME`.

Chi tiết: [swipe-login.md](design/docs/05-behavior/sequences/swipe-login.md), luật đánh giá ở [business-rules.md](design/docs/02-requirements/business-rules.md).

## Công nghệ

| Thành phần | Công nghệ | Thư mục |
|---|---|---|
| Agent | Python 3.10, SQLite WAL, pyscard, paho-mqtt 2 | [`edge/nfc_agent`](edge/nfc_agent) |
| PAM module | C, libpam | [`edge/pam`](edge/pam) |
| Greeter | Python, GTK 3, LightDM | [`edge/greeter`](edge/greeter) |
| Gói cài máy trạm | `.deb` cài offline | [`edge/packaging`](edge/packaging) |
| Server | NestJS 11, TypeScript, Kysely, PostgreSQL 15 | [`server`](server) |
| Dashboard | React 18, Vite 6, Tailwind, TanStack Query | [`dashboard`](dashboard) |
| Broker | Mosquitto 2 (MQTT 5, mTLS, ACL theo máy, CRL) | [`deploy`](deploy) |
| Hợp đồng chung | JSON Schema, test vector mật mã | [`contracts`](contracts) |

## Trạng thái

| Mốc | Nội dung | |
|---|---|---|
| M0 | Nền: hợp đồng bản tin, CI | ✅ |
| M1 | Agent offline, PAM, greeter, vòng đời phiên; E2E với GNOME thật | ✅ |
| M2 | Server lõi: quản trị, người dùng/thẻ, máy trạm, lịch, dựng và ký snapshot | ✅ |
| M3 | PKI và đăng ký máy, đồng bộ MQTT, thu nhật ký; E2E trên máy ảo | ✅ |
| M4 | Dashboard quản trị | ✅ |
| M5 | Gói `.deb` cho máy trạm, bộ cài server production, sao lưu, runbook vận hành | ✅ |

**Giới hạn đã biết.** Thử đầu đọc thật với 10 thẻ NTAG215 (100 lần quẹt nhanh kiểu "bíp là nhấc"): 84 lần tới `pcscd`, Agent ghi nhận 82, nên người dùng cần nhìn màn hình để biết đã nhận thẻ. Chưa thử Mifare Classic 1K, đầu đọc dòng khác, máy thật (bare-metal) và tải nhiều máy kết nối lại cùng lúc. Bằng chứng từng phần ở [spike-results](spike-results/README.md).

## Cấu trúc repository

```text
contracts/        JSON Schema bản tin MQTT, test vector mật mã (nguồn sự thật cho cả hai phía)
edge/
  nfc_agent/      Agent: domain/ (thuần, không I/O), infra/ (SQLite, PC/SC, MQTT), app/
  pam/            pam_nfc.so
  greeter/        Lab Greeter cho LightDM
  packaging/      build-deb.sh, unit systemd, cấu hình LightDM
server/           NestJS, mỗi bounded context một module (identity, device, scheduling, distribution, operations)
dashboard/        Giao diện quản trị
deploy/
  dev/            PostgreSQL + Mosquitto bằng Docker, sinh CA dev
  prod/           Bundle, cài đặt, PKI, rollback, sao lưu
design/           Tài liệu phân tích và thiết kế 01–11, ADR, nhật ký quyết định
spike-results/    Kế hoạch và kết quả thực nghiệm S0–S11
```

## Bắt đầu nhanh (môi trường dev)

Cần Docker, Python ≥ 3.10, Node 20 và pnpm.

**Hạ tầng** (PostgreSQL + Mosquitto mTLS):

```bash
cd deploy/dev
bash gen-dev-certs.sh
docker compose up -d        # PG_PORT=15432 nếu máy đã có PostgreSQL ở 5432
```

**Edge:**

```bash
cd edge
python -m venv .venv && .venv/bin/pip install -e ".[dev]"
.venv/bin/pytest
```

**Server:**

```bash
cd server
pnpm install
cp .env.example .env                                   # điền JWT_SECRET, DATABASE_URL
KEYS_DIR=../deploy/dev/keys pnpm keys:init             # khóa UID và khóa chủ, không ghi đè khóa có sẵn
pnpm db:migrate
read -rs PW; printf "%s" "$PW" | pnpm admin:create --username admin --display-name "Quản trị"
pnpm start:dev                                         # http://127.0.0.1:8000
```

Mọi biến môi trường đều liệt kê trong [`server/.env.example`](server/.env.example).

**Dashboard** (cần server đang chạy):

```bash
cd dashboard
pnpm install
pnpm dev                    # http://localhost:5173, proxy /api tới 127.0.0.1:8000
```

<details>
<summary>Chạy test tích hợp và E2E với máy trạm thật</summary>

```bash
# Test server với CSDL thật (CSDL test bị xóa sạch mỗi lần chạy)
docker compose exec postgres createdb -U nfclab nfclab_test
TEST_DATABASE_URL=postgres://nfclab:nfclab-dev@127.0.0.1:5432/nfclab_test pnpm test

# Thêm test với Mosquitto dev
TEST_MQTT_URL=mqtts://localhost:8883 TEST_MQTT_CERTS=<đường dẫn tuyệt đối tới deploy/dev/certs> pnpm test
```

E2E với máy ảo (VirtualBox NAT, host là `10.0.2.2`):

1. `deploy/dev`: `bash gen-dev-certs.sh` (SAN broker có `10.0.2.2`), `docker compose up -d`, `node https-proxy.js` (HTTPS :8443 tới :8000).
2. Server: thêm `MQTT_URL=mqtts://localhost:8883`, `MQTT_CA` / `MQTT_CERT` / `MQTT_KEY` trỏ `deploy/dev/certs`, `BROKER_HOST=10.0.2.2`, `BROKER_RESTART_CMD="docker restart dev-mosquitto-1"`.
3. Máy trạm: cài gói `.deb`, đặt `/etc/nfc-agent/ca.pem` và `agent.conf` (`[server] url = https://10.0.2.2:8443`), chạy `nfc-agent reenroll`, rồi duyệt máy trên dashboard.

Broker dev phải dùng image `eclipse-mosquitto:2.0.18-openssl` vì bản LibreSSL không nhận chứng chỉ client Ed25519.

</details>

## Triển khai

Máy trạm và máy chủ đều chạy Ubuntu 22.04 amd64.

```bash
# Gói cho máy trạm
bash edge/packaging/build-deb.sh
sudo apt install ./edge/dist/nfc-agent_0.1.0-1_amd64.deb

# Máy chủ: bundle tự chứa (Node runtime, Server, Dashboard, script triển khai)
bash deploy/prod/build-bundle.sh
sudo SERVER_NAME=lab-server.local bash deploy/prod/install-server.sh deploy/dist/nfc-server-0.1.0-1.tar.gz
sudo bash /opt/nfc-server/current/deploy/create-admin.sh admin "Quản trị"
```

Installer cài PostgreSQL, Nginx, Mosquitto, dựng PKI, sao lưu CSDL trước migration và tự quay về bản cũ nếu migration lỗi. Rollback, sao lưu đêm, xuất khóa và quy trình vận hành: [deployment.md](design/docs/11-operations/deployment.md), [pilot-runbook.md](design/docs/11-operations/pilot-runbook.md).

## Tài liệu

| Chủ đề | Tài liệu |
|---|---|
| Mục lục thiết kế | [design/README.md](design/README.md) |
| Nhật ký quyết định | [decisions.md](design/docs/decisions.md) |
| ADR | [06-architecture/decisions](design/docs/06-architecture/decisions/README.md) |
| Yêu cầu và luật nghiệp vụ | [functional](design/docs/02-requirements/functional.md), [non-functional](design/docs/02-requirements/non-functional.md), [business-rules](design/docs/02-requirements/business-rules.md) |
| REST API và hợp đồng MQTT | [api.md](design/docs/08-api/api.md), [events.md](design/docs/08-api/events.md), [contracts](contracts/README.md) |
| Bảo mật | [threat-model.md](design/docs/09-security/threat-model.md) |
| Sự cố và khôi phục | [failure-model.md](design/docs/10-failure/failure-model.md) |
| Tham số vận hành | [Bảng Tham Số](design/docs/11-operations/deployment.md#bảng-tham-số) |
| Thực nghiệm | [spike-results](spike-results/README.md), [nhật ký](spike-results/spike-execution-journal.md) |

## Đóng góp

- `main` chỉ thay đổi qua pull request (squash merge), cần 4 job CI xanh: contracts, edge, server, dashboard.
- Đổi định dạng bản tin hay bố cục mật mã thì sửa `contracts/` trước; test của Edge và Server cùng chạy trên các tệp đó.

## Giấy phép

[MIT](LICENSE)
