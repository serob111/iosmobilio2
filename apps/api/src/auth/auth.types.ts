export interface AuthenticatedUser {
  id: string;
  name: string;
  email: string;
}

declare module 'express' {
  interface Request {
    /** Set by AuthGuard once it has verified a Better Auth session exists. */
    user?: AuthenticatedUser;
  }
}
