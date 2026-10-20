import { Global, Module } from '@nestjs/common';
import { DbService } from './db.service.js';

/** Global so every feature module can inject DbService without re-importing DbModule. */
@Global()
@Module({
  providers: [DbService],
  exports: [DbService],
})
export class DbModule {}
