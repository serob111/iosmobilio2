import { Module } from '@nestjs/common';
import { ShellReleasesController } from './shell-releases.controller.js';
import { ShellReleasesService } from './shell-releases.service.js';
import { ShellReleaseAuthGuard } from './shell-release-auth.guard.js';

@Module({
  controllers: [ShellReleasesController],
  providers: [ShellReleasesService, ShellReleaseAuthGuard],
})
export class ShellReleasesModule {}
