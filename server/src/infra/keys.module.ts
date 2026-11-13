import { Global, Module } from '@nestjs/common';
import { APP_CONFIG, AppConfig } from '../config';
import { loadUidVault, UidVault } from '../shared/crypto/uid-vault';

@Global()
@Module({
  providers: [
    { provide: UidVault, inject: [APP_CONFIG], useFactory: (config: AppConfig) => loadUidVault(config.keysDir, config.uidEncKeyId) },
  ],
  exports: [UidVault],
})
export class KeysModule {}
