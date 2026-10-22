declare module 'express' {
  interface Request {
    /** Set by nestjs-pino's genReqId (see app.module.ts) — the same id tagging its logs. */
    id?: string;
  }
}
