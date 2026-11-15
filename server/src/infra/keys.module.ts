import { Global, Module } from '@nestjs/common';
import { APP_CONFIG, AppConfig } from '../config';
import { loadMasterKey, loadUidVault, UidVault } from '../shared/crypto/uid-vault';

/** Injection token of the master key (Buffer, 32 bytes) that K_m is derived from. */
export const MASTER_KEY = Symbol('MASTER_KEY');

@Global()
@Module({
  providers: [
    { provide: UidVault, inject: [APP_CONFIG], useFactory: (config: AppConfig) => loadUidVault(config.keysDir, config.uidEncKeyId) },
    { provide: MASTER_KEY, inject: [APP_CONFIG], useFactory: (config: AppConfig): Buffer => loadMasterKey(config.keysDir) },
  ],
  exports: [UidVault, MASTER_KEY],
})
export class KeysModule {}
