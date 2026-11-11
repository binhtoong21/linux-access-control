# 🎓 Hệ Thống Xác Thực Đăng Nhập Phòng Máy Bằng Thẻ NFC (NFC Edge Authentication System)

> **Đồ Án Tốt Nghiệp Đại Học (ĐATN)**  
> **Sinh viên thực hiện:** Đào Thanh Bình  
> **Nền tảng:** Linux (Ubuntu 22.04 LTS), PAM, LightDM, Python/C (Edge), NestJS/TypeScript (Server), React (Dashboard), SQLite WAL, PostgreSQL, Mosquitto MQTT.

---

## 📌 Giới Thiệu Dự Án

Hệ thống quản lý và kiểm soát truy cập phòng máy thực hành thông qua thẻ sinh viên NFC (MIFARE 13.56MHz) theo mô hình **Edge Authentication & Least Privilege**:
- **Xác thực tại Biên (Edge Decision):** Máy trạm tự động ra quyết định đăng nhập cục bộ dựa trên bản snapshot cá nhân hóa mang khóa so khớp per-machine (HMAC) và thời hạn tin cậy (lease) được cấp phát an toàn từ máy chủ trung tâm qua mTLS. Hệ thống duy trì khả năng phục vụ liên tục ngay cả khi mất kết nối mạng hoặc máy chủ gặp sự cố (High Availability & Zero Latency).
- **Mô hình Profile OS Dùng Chung (Workstation Profile):** Tách bạch giữa danh tính xác thực (User/Card UID ghi nhận vào Audit Log) và môi trường hệ điều hành (`student`, `labuser`). Bảo toàn các thiết lập công cụ, phần mềm và bài tập thực hành do giảng viên/kỹ thuật viên chuẩn bị; dọn sạch toàn bộ tiến trình phiên làm việc sau mỗi ca học mà không xóa dữ liệu cục bộ.
- **Zero-Touch Provisioning:** Hỗ trợ quy trình nhân bản đĩa hàng loạt (Master Image via Clonezilla/PXE). Máy trạm tự động sinh cặp khóa riêng biệt khi khởi động lần đầu, đăng ký trạng thái chờ duyệt (`pending`) và nhận cấu hình tập trung từ Web Dashboard của Quản trị viên.

---

## 📂 Cấu Trúc Repository

```text
├── contracts/              # Hợp đồng dùng chung Edge ⇄ Server: JSON Schema bản tin MQTT, test vector mật mã
├── edge/                   # Edge Agent (Python ≥ 3.10): domain/ (CR-001, thuần), infra/ (SQLite, MQTT, PC/SC…)
├── server/                 # Server NestJS/TypeScript: mỗi bounded context một module
├── deploy/dev/             # Môi trường dev: PostgreSQL 15 + Mosquitto mTLS/ACL/CRL, script sinh CA dev
├── .github/workflows/      # CI: contracts, edge (Python 3.10), server (Node 20)
├── design/                 # Toàn bộ tài liệu phân tích và thiết kế hệ thống (mục lục: design/README.md)
│   ├── README.md           # Mục lục, trạng thái từng phần, đường đọc gợi ý
│   ├── _templates/         # Template ADR, use case
│   ├── docs/
│   │   ├── 01-problem/     # Hiện trạng, bài toán, mục tiêu và phạm vi
│   │   ├── 02-requirements/# Business Rules (BR), Functional (FR), Non-Functional (NFR)
│   │   ├── 03-domain/      # Domain model, Glossary, Invariants, Bounded Contexts
│   │   ├── 04-use-cases/   # Đặc tả các ca sử dụng (Use Cases)
│   │   ├── 05-behavior/    # Sequence diagrams từng luồng & state machines
│   │   ├── 06-architecture/# Kiến trúc C4 & Quyết định Kiến trúc (ADR-001 đến ADR-008)
│   │   ├── 07-data/        # Thiết kế CSDL (PostgreSQL & SQLite WAL)
│   │   ├── 08-api/         # REST API & hợp đồng bản tin MQTT
│   │   ├── 09-security/    # Threat model, ma trận quyền, quản lý khóa
│   │   ├── 10-failure/     # Failure modes & quy trình khôi phục
│   │   ├── 11-operations/  # Triển khai, Master Image, Bảng Tham Số, observability
│   │   └── decisions.md    # Nhật ký quyết định đã chốt (D-001 đến D-020)
├── spike-results/          # Kế hoạch & kết quả thực nghiệm (Empirical Spikes)
│   ├── README.md           # Kế hoạch, phương pháp luận và tổng hợp kết quả S0–S11
│   ├── s1-reader-pcsc.md   # Thử nghiệm đầu đọc NFC ACR122U & chuẩn PC/SC
│   ├── s2-pam-agent.md     # Thử nghiệm tích hợp Linux PAM module và Unix Socket IPC
│   ├── s3-greeter-lockscreen.md # Thử nghiệm Custom LightDM Greeter và màn hình khóa
│   ├── s3b-custom-greeter.md # Thử nghiệm Custom Greeter GTK3 0-chạm
│   ├── s4-account-session.md # Quản lý phiên OS, cgroup kill và dọn tiến trình
│   ├── s5-mqtt-storage.md  # Thử nghiệm SQLite WAL và độ bền trước sự cố mất điện đột ngột
│   ├── s6-walking-skeleton.md# Tích hợp toàn diện End-to-End và giải quyết Race Condition
│   ├── s7-teardown-same-uid.md# Đo đạc Teardown trên cùng UID student & triệt tiêu Linger
│   ├── s7b-teardown-gnome-e2e.md# Kiểm chứng E2E 20/20 GNOME thật qua LightDM/PAM & SIGKILL
│   ├── s8-server-crypto-mtls-pg.md# Kiểm chứng Ed25519 CSR, MQTT 5 mTLS ACL & PostgreSQL TX (Node.js)
│   ├── s9-mosquitto-crl.md        # Thu hồi chứng chỉ máy trạm bằng CRL của Mosquitto
│   ├── s10-greeter-wrapper.md     # Smoke-test wrapper greeter trong vòng boot LightDM
│   ├── s11-agent-systemd-hardening.md # Agent dưới systemd hardening
│   └── spike-execution-journal.md # Nhật ký chi tiết toàn bộ chuỗi thực nghiệm S1-S11
├── .gitignore              # Cấu hình bỏ qua các file tạm thời, cache và nhạy cảm
└── README.md               # Tài liệu tổng quan dự án
```

---

## 🛠️ Phát Triển

```bash
# Edge (Python ≥ 3.10)
cd edge && python -m venv .venv && .venv/bin/pip install -e ".[dev]" && .venv/bin/pytest

# Server (Node ≥ 20, pnpm)
cd server && pnpm install && pnpm test && pnpm build

# Hạ tầng dev (Docker): PostgreSQL + Mosquitto mTLS
cd deploy/dev && bash gen-dev-certs.sh && docker compose up -d
```

Mọi thay đổi định dạng bản tin hoặc mật mã bắt đầu từ `contracts/` (xem [contracts/README.md](contracts/README.md)); test của cả hai phía chạy trên cùng các tệp đó.

---

## 🚀 Tài Liệu Tham Khảo Nhanh

- **Mục lục tài liệu thiết kế:** Xem [design/README.md](design/README.md)
- **Kế hoạch & tổng hợp spike:** Xem [spike-results/README.md](spike-results/README.md)
- **Nhật ký quyết định kiến trúc:** Xem [design/docs/decisions.md](design/docs/decisions.md)
- **Mục lục ADR kiến trúc:** Xem [design/docs/06-architecture/decisions/README.md](design/docs/06-architecture/decisions/README.md)
- **Nhật ký thực nghiệm chi tiết (S1-S11):** Xem [spike-results/spike-execution-journal.md](spike-results/spike-execution-journal.md)
- **Quy tắc nghiệp vụ cốt lõi:** Xem [design/docs/02-requirements/business-rules.md](design/docs/02-requirements/business-rules.md)
- **Kiến trúc hệ thống (C4):** Xem [design/docs/06-architecture/](design/docs/06-architecture/)
