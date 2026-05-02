import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { PrivyTokenVerifierService } from '../services/privy-token-verifier.service';
import { AuthService } from '../auth.service';

@Injectable()
export class JwtAuthGuard implements CanActivate {
  private readonly logger = new Logger(JwtAuthGuard.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly privyTokenVerifier: PrivyTokenVerifierService,
    private readonly authService: AuthService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest();
    const token = this.extractAccessToken(request);

    this.logger.debug(
      `${request.method} ${request.url} — token: ${token ? token.slice(0, 20) + '…' : 'MISSING'}`,
    );

    if (!token) throw new UnauthorizedException('Missing Privy access token');

    try {
      const verifiedClaims = await this.privyTokenVerifier.verifyAccessToken(token);
      this.logger.debug(`Token verified — privyUserId: ${verifiedClaims.sub}`);
      request.user =
        await this.authService.resolveJwtPayloadFromPrivyClaims(verifiedClaims);
      return true;
    } catch (err) {
      this.logger.warn(
        `Token verification failed — ${err instanceof Error ? err.message : String(err)}`,
      );
      throw new UnauthorizedException('Invalid or expired Privy access token');
    }
  }

  private extractAccessToken(
    request: Record<string, unknown>,
  ): string | null {
    const authHeader = request.headers?.['authorization'];
    if (typeof authHeader === 'string' && authHeader.startsWith('Bearer ')) {
      return authHeader.slice(7);
    }

    const cookies = request.cookies as Record<string, unknown> | undefined;
    const cookieToken = cookies?.['privy-token'];
    if (typeof cookieToken === 'string' && cookieToken.length > 0) {
      return cookieToken;
    }

    return null;
  }
}
