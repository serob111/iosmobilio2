import 'dotenv/config';
import './instrumentation.js';
import { json, urlencoded } from 'express';
import { toNodeHandler } from 'better-auth/node';
import { NestFactory } from '@nestjs/core';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module.js';
import { AuthService } from './auth/auth.service.js';
import { HttpExceptionFilter } from './common/http-exception.filter.js';

async function bootstrap() {
  // Better Auth needs the raw, unparsed request body (it parses JSON itself from the
  // Fetch API Request it builds) — bodyParser:false + mounting its handler before
  // Nest's own json()/urlencoded() middleware is the documented way to let both coexist.
  const app = await NestFactory.create(AppModule, { bufferLogs: true, bodyParser: false });
  app.useLogger(app.get(Logger));
  app.useGlobalFilters(new HttpExceptionFilter());
  // apps/web calls this api directly from the browser (not through Next's server), so
  // the session cookie Better Auth sets on this origin round-trips correctly —
  // credentials:true is required for that, and so is a specific (non-wildcard) origin.
  app.enableCors({ origin: process.env.WEB_ORIGIN ?? 'http://localhost:3000', credentials: true });

  const authService = app.get(AuthService);
  app.use('/api/auth', toNodeHandler(authService.auth));
  app.use(json());
  app.use(urlencoded({ extended: true }));

  await app.listen(process.env.PORT ?? 3000);
}
await bootstrap();
