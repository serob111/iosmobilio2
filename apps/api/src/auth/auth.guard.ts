import { CanActivate, Injectable, UnauthorizedException, type ExecutionContext } from '@nestjs/common';
import { fromNodeHeaders } from 'better-auth/node';
import type { Request } from 'express';
import { AuthService } from './auth.service.js';
import './auth.types.js';

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private readonly authService: AuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const result = await this.authService.auth.api.getSession({
      headers: fromNodeHeaders(request.headers),
    });
    if (!result) {
      throw new UnauthorizedException();
    }
    request.user = result.user;
    return true;
  }
}
