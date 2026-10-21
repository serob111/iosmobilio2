import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';

/** Opts a route out of the global AuthGuard (see app.module.ts's APP_GUARD provider). */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
