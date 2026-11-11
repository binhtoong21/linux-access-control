# 📝 Architecture Decision Records (ADR)

> Ghi nhận các quyết định kiến trúc quan trọng và lý do đằng sau chúng.

## Cách tạo ADR mới

1. Copy template từ [`../../../_templates/adr.md`](../../../_templates/adr.md)
2. Đặt tên file: `ADR-XXX-ten-quyet-dinh.md`
3. Cập nhật bảng index bên dưới

## ADR Index

| ID | Tiêu đề | Status | Date | Link |
|----|---------|--------|------|------|
| ADR-001 | Xác thực ở edge, dữ liệu cục bộ có thời hạn tin cậy (lease) | Accepted | 2026-10-16 | [→](ADR-001-xac-thuc-o-edge-va-lease.md) |
| ADR-002 | Giao thức MQTT 5, phân quyền ACL, định danh máy trạm và mTLS | Proposed | 2026-11-10 | [→](ADR-002-giao-thuc-mqtt-va-dinh-danh-may-tram.md) |
| ADR-003 | Lưu trữ cục bộ SQLite WAL, hợp nhất DB và xác thực snapshot bằng K_m | Proposed | 2026-11-10 | [→](ADR-003-luu-tru-cuc-bo-va-xac-thuc-snapshot.md) |
| ADR-004 | Mô hình Profile OS dùng chung và phân tách danh tính xác thực | Accepted | 2026-11-11 | [→](ADR-004-mo-hinh-profile-os-dung-chung.md) |
| ADR-005 | Kiến trúc PAM module C, Lab Custom Greeter và cơ chế khôi phục | Proposed | 2026-11-10 | [→](ADR-005-pam-greeter-va-display-manager.md) |
| ADR-006 | Lựa chọn ngôn ngữ và techstack cho Edge Agent, Server và Dashboard | Accepted | 2026-11-11 | [→](ADR-006-ngon-ngu-va-techstack.md) |
| ADR-007 | Khóa so khớp UID thẻ và phạm vi lưu UID gốc | Accepted | 2026-10-16 | [→](ADR-007-khoa-so-khop-uid.md) |
| ADR-008 | Quản lý vòng đời phiên và cơ chế teardown đa pha | Accepted | 2026-11-11 | [→](ADR-008-vong-doi-phien-va-teardown-da-pha.md) |

## Status Legend

- **Proposed** — Đang đề xuất, chưa quyết định
- **Accepted** — Đã chấp nhận và đang áp dụng
- **Deprecated** — Không còn áp dụng
- **Superseded** — Đã bị thay thế bởi ADR khác
