import { Module } from '@nestjs/common';
import { IngestService } from './ingest.service';
import { SessionInferenceService } from './session-inference.service';

// Operations bounded context (03-domain): what the workstations report back: audit records, sessions, alerts.
@Module({ providers: [IngestService, SessionInferenceService], exports: [IngestService, SessionInferenceService] })
export class OperationsModule {}
