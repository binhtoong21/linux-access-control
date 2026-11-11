import { Controller, Get } from '@nestjs/common';

// GET /api/v1/system/health (08-api/api.md). Components (db, mqtt, crl) are added as their modules land.
@Controller('system')
export class SystemHealthController {
  @Get('health')
  health(): { status: 'ok'; version: string } {
    return { status: 'ok', version: process.env.npm_package_version ?? '0.1.0' };
  }
}
