# 🗄️ Data Model

## ER Diagram

```mermaid
erDiagram
    ENTITY1 ||--o{ ENTITY2 : has
    ENTITY1 {
        string id PK
        string name
        datetime created_at
    }
    ENTITY2 {
        string id PK
        string entity1_id FK
    }
```

## Tables

### [Table Name]

| Column | Type | Nullable | Default | Mô tả |
|--------|------|----------|---------|--------|
| id | UUID | No | gen_random_uuid() | Primary key |
| | | | | |

**Indexes:**
- `idx_table_column` on (column)

**Constraints:**
- FK: column → other_table(id)

## Data Flow

> Dữ liệu di chuyển như thế nào giữa các hệ thống?

| Source | Destination | Trigger | Frequency |
|--------|------------|---------|----------|
| | | | |
