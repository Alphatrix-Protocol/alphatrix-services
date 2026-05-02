import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JWTPayload, importSPKI, jwtVerify } from 'jose';

export interface PrivyAccessTokenClaims {
  sub: string;
  aud: string;
  iss: string;
  sid: string;
  iat: number;
  exp: number;
  email?: string;
}

@Injectable()
export class PrivyTokenVerifierService {
  private readonly logger = new Logger(PrivyTokenVerifierService.name);
  private readonly appId: string;
  private readonly issuer: string;
  private readonly verificationKey: string;

  constructor(config: ConfigService) {
    this.appId = config.get<string>('PRIVY_APP_ID') ?? '';
    this.issuer = config.get<string>('PRIVY_JWT_ISSUER') ?? 'privy.io';
    this.verificationKey = config.get<string>('PRIVY_VERIFICATION_KEY') ?? '';

    if (!this.appId || !this.verificationKey) {
      this.logger.warn(
        'PRIVY_APP_ID or PRIVY_VERIFICATION_KEY not set — all protected routes will reject requests',
      );
    }
  }

  async verifyAccessToken(token: string): Promise<PrivyAccessTokenClaims> {
    if (!this.appId || !this.verificationKey) {
      throw new UnauthorizedException('Privy auth is not configured on this server');
    }
    const publicKey = await importSPKI(this.verificationKey.replace(/\\n/g, '\n'), 'ES256');

    const { payload } = await jwtVerify(token, publicKey, {
      issuer: this.issuer,
      audience: this.appId,
    });

    return this.assertRequiredClaims(payload);
  }

  private assertRequiredClaims(payload: JWTPayload): PrivyAccessTokenClaims {
    const sub = payload.sub;
    const audValue = Array.isArray(payload.aud) ? payload.aud[0] : payload.aud;
    const iss = payload.iss;
    const sid = typeof payload.sid === 'string' ? payload.sid : '';
    const iat = payload.iat;
    const exp = payload.exp;
    const email = typeof payload.email === 'string' ? payload.email : undefined;

    if (!sub || !audValue || !iss || !sid || !iat || !exp) {
      throw new UnauthorizedException('Privy token is missing required claims');
    }

    return {
      sub,
      aud: String(audValue),
      iss: String(iss),
      sid,
      iat,
      exp,
      email,
    };
  }
}
