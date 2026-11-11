# 📐 Tài Liệu Thiết Kế

> Thiết kế hệ thống đăng nhập máy trạm Linux bằng thẻ NFC theo mô hình edge authentication. Tổng quan dự án: [README gốc](../README.md). Bằng chứng thực nghiệm: [spike-results/](../spike-results/README.md).

## Nguồn Sự Thật

- **[docs/decisions.md](docs/decisions.md)**: nhật ký quyết định D-001…; quyết định mới hơn thắng tài liệu cũ hơn.
- **[docs/06-architecture/decisions/](docs/06-architecture/decisions/README.md)**: ADR-001…008, đều đã `Accepted`, mỗi ADR bám một hoặc nhiều spike.
- Tài liệu 01–11 bên dưới; chỗ nào mâu thuẫn với hai nguồn trên thì sửa tài liệu theo quyết định.

## Mục Lục

| Tầng | Phần | Nội dung | Trạng thái |
|---|---|---|---|
| WHY | [01-problem](docs/01-problem/) | [problem](docs/01-problem/problem.md), [as-is](docs/01-problem/as-is.md), [stakeholders](docs/01-problem/stakeholders.md) | ✅ |
| WHAT | [02-requirements](docs/02-requirements/) | [functional](docs/02-requirements/functional.md), [non-functional](docs/02-requirements/non-functional.md), [business-rules](docs/02-requirements/business-rules.md) (BR, CR-001, VR) | ✅ |
| WHAT | [03-domain](docs/03-domain/) | [domain-model](docs/03-domain/domain-model.md), [invariants](docs/03-domain/invariants.md), [bounded-contexts](docs/03-domain/bounded-contexts.md), [glossary](docs/03-domain/glossary.md) | ✅ |
| WHAT | [04-use-cases](docs/04-use-cases/use-cases.md) | 10 use case, sơ đồ, truy vết | ✅ |
| BEHAVIOR | [05-behavior](docs/05-behavior/) | [sequences/](docs/05-behavior/sequences/README.md) (6 luồng), [state-machines](docs/05-behavior/state-machines/README.md) | ✅ |
| HOW | [06-architecture](docs/06-architecture/) | [context](docs/06-architecture/context.md), [containers](docs/06-architecture/containers.md), [components](docs/06-architecture/components.md), [dependency-rules](docs/06-architecture/dependency-rules.md), [extension-points](docs/06-architecture/extension-points.md), [ADR](docs/06-architecture/decisions/README.md) | ✅ |
| HOW | [07-data](docs/07-data/) | [data-model](docs/07-data/data-model.md) (PostgreSQL + SQLite Edge), [migrations](docs/07-data/migrations.md) | ✅ |
| HOW | [08-api](docs/08-api/) | [api](docs/08-api/api.md) (REST), [events](docs/08-api/events.md) (hợp đồng MQTT, domain event) | ✅ bản đầu |
| CROSS-CUTTING | [09-security](docs/09-security/threat-model.md) | Phạm vi, tài sản, STRIDE, ma trận quyền, quản lý khóa | ✅ bản đầu |
| CROSS-CUTTING | [10-failure](docs/10-failure/failure-model.md) | Failure modes, phụ thuộc, khôi phục | ✅ bản đầu |
| CROSS-CUTTING | [11-operations](docs/11-operations/) | [deployment](docs/11-operations/deployment.md) (Master Image, triển khai, sao lưu, **Bảng Tham Số**), [observability](docs/11-operations/observability.md) | ✅ bản đầu |

**Không còn mục chờ xác nhận.** Giới hạn bằng chứng còn mở: S1 (thẻ thật), tải 40 máy kết nối lại, mất điện trên ổ vật lý.

## Đường Đọc Gợi Ý

1. **Hiểu bài toán:** `problem.md` → `business-rules.md` (CR-001 là luật đánh giá quẹt thẻ) → `domain-model.md`.
2. **Hiểu một lần quẹt thẻ:** `swipe-login.md` → ADR-001 (edge + lease) → ADR-005 (PAM, greeter) → ADR-008 (vòng đời phiên).
3. **Hiểu đồng bộ:** `schedule-sync.md`, `reconnect.md` → ADR-002 (MQTT) → ADR-003 (lưu trữ, chữ ký) → `events.md`.
4. **Hiểu vận hành:** `deployment.md` → `failure-model.md` → `threat-model.md`.

## Quy Ước

- `03-domain` không chứa bảng, khóa, cột; những thứ đó thuộc `07-data`.
- Mọi con số tham số nằm ở một chỗ: [Bảng Tham Số](docs/11-operations/deployment.md#bảng-tham-số).
- Mã tham chiếu: `BR-`, `CR-`, `VR-` (quy tắc), `FR-`, `NFR-` (yêu cầu), `INV-`, `XINV-` (bất biến), `UC-` (use case), `D-` (quyết định), `ADR-`, `S0…S11` (spike).
- Template: [ADR](_templates/adr.md), [use case](_templates/use-case.md).
