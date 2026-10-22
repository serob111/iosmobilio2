import { Global, Module } from '@nestjs/common';
import { createObjectStorageFromEnv } from '@mobilio/storage';
import { OBJECT_STORAGE } from './object-storage.token.js';

@Global()
@Module({
  providers: [{ provide: OBJECT_STORAGE, useFactory: () => createObjectStorageFromEnv() }],
  exports: [OBJECT_STORAGE],
})
export class StorageModule {}
