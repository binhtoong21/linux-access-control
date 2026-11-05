# 🔄 Data Migrations

## Quy ước

- Tên migration: `YYYYMMDD_HHMMSS_mô_tả.sql`
- Mỗi migration phải có rollback script
- Không sửa migration đã chạy trên production

## Migration Log

| # | Migration | Mô tả | Date | Status | Rollback |
|---|-----------|-------|------|--------|----------|
| 1 | | | | Pending / Applied | ✅ / ❌ |

## Migration Strategy

> Mô tả chiến lược migration: zero-downtime? blue-green? expand-contract?

## Notes

- Luôn test migration trên staging trước production
- Backup database trước khi chạy migration
