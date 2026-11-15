import { Module } from '@nestjs/common';
import { IngestService } from './ingest.service';

// Operations bounded context (03-domain): what the workstations report back: audit records, sessions, alerts.
@Module({ providers: [IngestService], exports: [IngestService] })
export class OperationsModule {}
