# 📐 Design Documentation

> Bộ tài liệu thiết kế hệ thống — portable, drop vào root bất kỳ dự án nào.

## Cấu trúc Hệ thống (The 4 Layers)

Tài liệu được chia thành 4 tầng và các khía cạnh cross-cutting, trả lời các câu hỏi khác nhau:

### 1. WHY (Tại sao cần hệ thống này?)
| Section | Mô tả | Đường dẫn |
|---------|-------|-----------|
| **01. Problem** | Bài toán, hiện trạng, stakeholders, actors & goals | [docs/01-problem](docs/01-problem/) |

### 2. WHAT (Hệ thống là gì & phải làm được gì?)
*Phần này phải xong trước khi bắt tay vào thiết kế kỹ thuật.*
| Section | Mô tả | Đường dẫn |
|---------|-------|-----------|
| **02. Requirements** | Yêu cầu chức năng, phi chức năng, business rules | [docs/02-requirements](docs/02-requirements/) |
| **03. Domain** | Domain model, glossary, invariants, bounded contexts | [docs/03-domain](docs/03-domain/) |
| **04. Use Cases** | Các use-case tương tác của người dùng | [docs/04-use-cases](docs/04-use-cases/) |

### 3. WHEN / BEHAVIOR (Hệ thống vận hành như thế nào theo thời gian?)
| Section | Mô tả | Đường dẫn |
|---------|-------|-----------|
| **05. Behavior** | Workflows, sequence diagrams, state machines | [docs/05-behavior](docs/05-behavior/) |

### 4. HOW (Thiết kế kỹ thuật ra sao?)
| Section | Mô tả | Đường dẫn |
|---------|-------|-----------|
| **06. Architecture** | C4 model, ADRs, dependency rules, extension points | [docs/06-architecture](docs/06-architecture/) |
| **07. Data** | Data model, database schema, migrations | [docs/07-data](docs/07-data/) |
| **08. API** | API contracts, events, idempotency | [docs/08-api](docs/08-api/) |

### 5. CROSS-CUTTING (Các khía cạnh phi chức năng khác)
| Section | Mô tả | Đường dẫn |
|---------|-------|-----------|
| **09. Security** | Threat model, permission matrix (RBAC) | [docs/09-security](docs/09-security/) |
| **10. Failure** | Failure modes, resilience (circuit breaker, retry) | [docs/10-failure](docs/10-failure/) |
| **11. Operations** | Observability (logs, metrics, traces, audit), deployment | [docs/11-operations](docs/11-operations/) |

## Cách sử dụng

> **ĐỌC TRƯỚC TIÊN:** Xem file [WORKFLOW-GUIDE.md](WORKFLOW-GUIDE.md) để hiểu quy trình làm việc phối hợp giữa Con người (bạn) và AI khi điền các tài liệu này.

1. Copy thư mục `design/` vào root dự án
2. Mở file bạn cần thiết kế, gạch đầu dòng thô các ý tưởng của bạn (nháp).
3. Đưa cho AI format lại, đề xuất bổ sung, phân tích rủi ro.
4. Bạn review, chốt quyết định và lưu bản cuối cùng.
5. Xóa các hướng dẫn placeholder (bắt đầu bằng dấu `>`) khi đã điền nội dung thực tế.
## Templates

| Template | Mục đích | Đường dẫn |
|----------|----------|-----------|
| Use Case | Mô tả một use-case | [_templates/use-case.md](_templates/use-case.md) |
| ADR | Ghi nhận quyết định kiến trúc | [_templates/adr.md](_templates/adr.md) |
| Workflow | Mô tả một workflow | [_templates/workflow.md](_templates/workflow.md) |
