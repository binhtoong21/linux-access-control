# 💥 Failure Model

> Mô hình hóa các failure modes và chiến lược xử lý.

## Failure Modes

| # | Component | Failure Mode | Impact | Probability | Severity | Mitigation |
|---|-----------|-------------|--------|-------------|----------|------------|
| 1 | Database | Connection timeout | Service unavailable | Medium | High | Connection pool, retry |
| 2 | | | | | | |

## Dependency Matrix

| Service | Hard Dependencies | Soft Dependencies | Fallback |
|---------|------------------|-------------------|----------|
| | | | |

## Resilience Patterns

| Pattern | Applied to | Configuration |
|---------|-----------|---------------|
| Circuit Breaker | | Threshold: 5, Timeout: 30s |
| Retry | | Max: 3, Backoff: exponential |
| Timeout | | 5s |
| Bulkhead | | |
| Fallback | | |

## Chaos Engineering (nếu áp dụng)

| Experiment | Target | Expected Result | Actual Result |
|-----------|--------|----------------|---------------|
| | | | |

## Recovery Procedures

| Scenario | Steps | RTO | RPO |
|----------|-------|-----|-----|
| | | | |
