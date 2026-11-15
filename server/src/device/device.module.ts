import { Module } from '@nestjs/common';
import { APP_CONFIG, AppConfig } from '../config';
import { CertificateAuthority } from '../shared/crypto/pki';
import { EnrollmentAgentController, EnrollmentRequestsController } from './enrollment.controller';
import { EnrollmentService } from './enrollment.service';
import { CERTIFICATE_AUTHORITY, PkiService } from './pki.service';
import { WorkstationsController } from './workstations.controller';
import { WorkstationsService } from './workstations.service';
import { ZonesController } from './zones.controller';
import { ZonesService } from './zones.service';

// Device bounded context (03-domain): zones, workstations, their profiles and certificates; enrollment endpoints come next.
@Module({
  controllers: [ZonesController, EnrollmentAgentController, WorkstationsController, EnrollmentRequestsController],
  providers: [
    ZonesService,
    WorkstationsService,
    {
      provide: CERTIFICATE_AUTHORITY,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig): Promise<CertificateAuthority> => CertificateAuthority.load(config.caCertFile, config.caKeyFile),
    },
    PkiService,
    EnrollmentService,
  ],
  exports: [PkiService],
})
export class DeviceModule {}
