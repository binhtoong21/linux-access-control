# 🚧 Dependency Rules

> Quy tắc dependency giữa các modules/layers. Cái gì KHÔNG được phụ thuộc vào nhau. Cực kỳ quan trọng để giữ kiến trúc không bị biến dạng theo thời gian.

## Allowed Dependencies

| Module / Layer | Được phép gọi (Depends on) | Không được phép gọi |
|----------------|-----------------------------|-----------------------|
| Domain | *None* (Không phụ thuộc gì ngoài nó) | Infrastructure, API, Application |
| Application | Domain | Infrastructure, API |
| API | Application, Domain | Infrastructure |
| Infrastructure | Application, Domain | API |

## Phân chia theo Tính năng (Feature Slices)

| Feature A | Feature B | Quy tắc giao tiếp |
|-----------|-----------|-------------------|
| Order | Payment | Order chỉ được gọi Payment qua interface/event |
| | | |

## Công cụ kiểm tra (Linter/ArchUnit)

> Liệt kê các rule được tự động kiểm tra bằng code (ví dụ: ArchUnit, ESLint rules).

- Rule 1: ...
