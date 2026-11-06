# 🚧 Dependency Rules

> Quy tắc phụ thuộc giữa các modules, bounded contexts và các layers. Tài liệu này bảo đảm kiến trúc không bị thoái hóa theo thời gian trong quá trình phát triển dự án DATN.

---

## 1. Quy tắc Phụ thuộc theo Lớp (Layered / Hexagonal Architecture)

### 1.1. Phía Server API & Services
| Layer | Được phép phụ thuộc (Depends on) | Tuyệt đối KHÔNG được phụ thuộc |
|-------|----------------------------------|--------------------------------|
| **Domain** | *None* (Độc lập tuyệt đối, không framework, không database) | Application, Infrastructure, API / Web Framework |
| **Application** | Domain Entities, Domain Services, Ports (Interfaces trừu tượng) | Infrastructure Adapters, Frameworks, Database cụ thể |
| **Ports (Interfaces)** | Domain Types | Triển khai cụ thể của Adapters |
| **Infrastructure Adapters** | Ports, Application Services, Domain Entities | Giao diện REST Controller / Web API |
| **API / Presentation** | Application Services, Domain DTOs | Database nội bộ (chỉ gọi qua Application Service) |

### 1.2. Phía Máy Trạm (Edge Workstation)
| Module / Tiến trình | Được phép gọi | Tuyệt đối KHÔNG được gọi |
|---------------------|---------------|--------------------------|
| **Rule Evaluator (CR-001)** | Cấu trúc dữ liệu LocalSnapshot, LocalSession trong bộ nhớ / SQLite | Mạng internet, MQTT Client, Server API, Greeter socket |
| **PAM C Module (`pam_nfc.so`)** | Unix Domain Socket `/run/nfc-agent.sock` (timeout 3000ms) | SQLite DB, Mạng internet, Thư viện phức tạp ngoài POSIX C |
| **Custom Greeter (`lab_greeter.py`)** | Unix Socket `/run/nfc/greeter-push.sock`, `/run/nfc-control.sock`, GTK3, `liblightdm-gobject` | SQLite DB, Server API, Quyền root hệ thống (chạy user `lightdm`) |
| **Local Storage Manager** | SQLite C/Python Driver (WAL mode) | Giao tiếp mạng ra ngoài |

---

## 2. Quy tắc Giao tiếp giữa các Bounded Contexts

| Context nguồn | Context đích | Quy tắc giao tiếp |
|---------------|--------------|-------------------|
| **Identity / Device / Scheduling** | **Distribution** | Bất đồng bộ qua Domain Events (`UserUpdated`, `ScheduleUpdated`, `WorkstationEnrollmentApproved`, `WorkstationProfileConfigured`). Tuyệt đối không gọi trực tiếp Distribution Service. |
| **Distribution** | **Identity / Device / Scheduling** | Đồng bộ qua Read-only Repository Query Ports chỉ khi dựng Snapshot cho một máy trạm cụ thể. |
| **Edge Agent** | **Operations (Server)** | Bất đồng bộ qua MQTT 5 (`Heartbeat`, `SessionStarted`, `SessionEnded`, `AuditEntryRecorded`). |
| **Edge Agent (CR-001)** | **Distribution / Operations** | Độc lập hoàn toàn khi quẹt thẻ (D-001). Agent ra quyết định xác thực 100% tại chỗ bằng snapshot cục bộ, không gửi RPC hay chờ phản hồi từ Server. |

---

## 3. Ranh giới Bất biến (Architectural Invariant Checks)

1. **Write-Ahead Logging (D-005):** Quyết định `granted` chỉ được chuyển cho PAM/Greeter SAU KHI giao dịch ghi nguyên tử `audit_outbox` và `local_session (status='pending')` vào SQLite WAL thành công.
2. **Không khóa màn hình Desktop (A3, P1-3):** Tài khoản sinh viên dùng chung bắt buộc vô hiệu hóa Lock Screen và User Switching trong Master Image (`lock-enabled=false`, `disable-lock-screen=true`, `disable-user-switching=true`).
3. **Dọn sạch tiến trình một cách duy nhất (A6):** Sử dụng `loginctl terminate-user` và cưỡng chế `loginctl kill-user -s SIGKILL` theo user slice; không dùng `pkill -9`.
