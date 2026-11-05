# 📊 Observability

## Three Pillars

### Metrics

| Metric | Type | Labels | Alert Threshold | Dashboard |
|--------|------|--------|----------------|-----------|
| http_request_duration_seconds | Histogram | method, path, status | p99 > 1s | |
| http_requests_total | Counter | method, path, status | | |
| | | | | |

### Logs

| Log Level | Khi nào dùng | Retention |
|-----------|-------------|----------|
| ERROR | Lỗi cần xử lý ngay | 90 days |
| WARN | Bất thường nhưng tự recover | 30 days |
| INFO | Business events quan trọng | 30 days |
| DEBUG | Chi tiết debug | 7 days |

**Log Format:**
```json
{
  "timestamp": "ISO8601",
  "level": "INFO",
  "service": "service-name",
  "traceId": "uuid",
  "message": "",
  "context": {}
}
```

### Traces

| Span | Service | Operation | Mô tả |
|------|---------|-----------|--------|
| | | | |

## Audit Trail

> Log lưu trữ các thay đổi trạng thái quan trọng, bắt buộc cho compliance và AI agent traceability. Không bao giờ được xóa.

| Audit Event | Triggered By | Dữ liệu lưu trữ | Mục đích |
|-------------|--------------|-----------------|----------|
| Order Status Changed | System, Admin, Agent | old_status, new_status, reason, user_id | Dispute resolution |
| | | | |

## Alerting Rules

| Alert | Condition | Severity | Channel | Runbook |
|-------|-----------|----------|---------|--------|
| High Error Rate | error_rate > 5% for 5m | Critical | PagerDuty | |
| | | | | |

## Dashboards

| Dashboard | Mục đích | Link |
|-----------|----------|------|
| Service Overview | Health overview | |
| Business Metrics | KPIs | |
