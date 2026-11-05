# 🛡️ Threat Model

## Assets

> Những gì cần bảo vệ?

| Asset | Sensitivity | Mô tả |
|-------|------------|--------|
| User data | High | |
| API keys | Critical | |

## Threat Actors

| Actor | Motivation | Capability |
|-------|-----------|------------|
| External attacker | | |
| Malicious insider | | |

## Permission Matrix (RBAC/ABAC)

> WHO có thể thực hiện hành động (WHAT) trên tài nguyên nào (ON WHICH RESOURCE).

| Role / Actor | Resource | Allowed Actions | Conditions (ABAC) |
|--------------|----------|-----------------|-------------------|
| Customer | Order | Read, Cancel | Own orders only |
| Admin | Order | Read, Refund | Any order |
| | | | |

## STRIDE Analysis

| Threat Type | Threat | Component | Mitigation | Status |
|-------------|--------|-----------|-----------|--------|
| **S**poofing | | | | |
| **T**ampering | | | | |
| **R**epudiation | | | | |
| **I**nformation Disclosure | | | | |
| **D**enial of Service | | | | |
| **E**levation of Privilege | | | | |

## Security Controls

| Control | Layer | Implementation | Status |
|---------|-------|---------------|--------|
| Authentication | API | | |
| Authorization | API | | |
| Encryption at rest | Data | | |
| Encryption in transit | Network | TLS 1.3 | |
| Input validation | Application | | |
| Rate limiting | API Gateway | | |

## Compliance

| Standard | Applicable | Status |
|----------|-----------|--------|
| GDPR | | |
| SOC 2 | | |
