import { Module } from '@nestjs/common';
import { HistoryController } from './history.controller';
import { HistoryService } from './history.service';
import { IngestService } from './ingest.service';
import { SessionInferenceService } from './session-inference.service';

// Operations bounded context (03-domain): what the workstations report back (audit records, sessions, alerts) and its read API.
@Module({
  controllers: [HistoryController],
  providers: [IngestService, SessionInferenceService, HistoryService],
  exports: [IngestService, SessionInferenceService],
})
export class OperationsModule {}
