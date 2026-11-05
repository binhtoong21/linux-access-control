# 🔌 API Design

## Base URL

```
https://api.example.com/v1
```

## Authentication

> Mô tả phương thức xác thực (JWT, API Key, OAuth2...)

## Endpoints

### [Resource Name]

| Method | Path | Mô tả | Auth | Request | Response |
|--------|------|--------|------|---------|----------|
| GET | /resources | List all | ✅ | Query params | 200: Resource[] |
| GET | /resources/:id | Get by ID | ✅ | - | 200: Resource |
| POST | /resources | Create | ✅ | Body: CreateDTO | 201: Resource |
| PUT | /resources/:id | Update | ✅ | Body: UpdateDTO | 200: Resource |
| DELETE | /resources/:id | Delete | ✅ | - | 204 |

## Error Format

```json
{
  "error": {
    "code": "RESOURCE_NOT_FOUND",
    "message": "Resource with id 'xxx' not found",
    "details": []
  }
}
```

## Error Codes

| Code | HTTP Status | Mô tả |
|------|------------|--------|
| VALIDATION_ERROR | 400 | |
| UNAUTHORIZED | 401 | |
| FORBIDDEN | 403 | |
| NOT_FOUND | 404 | |

## Idempotency & Concurrency

> API contract cho các operation cần an toàn khi retry (như thanh toán, trừ tiền).

| Path / Operation | Idempotency Key | Concurrency Control | Mô tả / Xử lý conflict |
|------------------|-----------------|---------------------|-------------------------|
| `POST /orders` | `Idempotency-Key` header | Optimistic Locking | Trả về 200 kèm data cũ nếu gửi trùng |
| | | | |

## Retry Policy

> Chiến lược retry cho các endpoint gọi đến external systems.

| External Endpoint | Retry Strategy | Backoff | Circuit Breaker Timeout |
|-------------------|----------------|---------|-------------------------|
| | | | |

## Rate Limiting

| Tier | Limit | Window |
|------|-------|--------|
| Default | 100 req | 1 minute |

## Versioning Strategy

> URL versioning (`/v1/`) / Header versioning / Query param?
