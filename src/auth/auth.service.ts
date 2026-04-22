import {
  Injectable,
  UnauthorizedException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { WalletService } from '../wallet/wallet.service';
import { GoogleStrategy } from './strategies/google.strategy';
import { PasskeyStrategy } from './strategies/passkey.strategy';
import { MagicLinkStrategy } from './strategies/magic-link.strategy';
import { JwtPayload } from './interfaces/jwt-payload.interface';
import { User } from './entities/user.entity';
import { Passkey } from './entities/passkey.entity';
import { MagicLink } from './entities/magic-link.entity';
import type {
  RegistrationResponseJSON,
  AuthenticationResponseJSON,
} from '@simplewebauthn/types';
import { nanoid } from 'nanoid';
import * as bcrypt from 'bcrypt';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    @InjectRepository(User) private readonly userRepo: Repository<User>,
    @InjectRepository(Passkey) private readonly passkeyRepo: Repository<Passkey>,
    @InjectRepository(MagicLink) private readonly magicLinkRepo: Repository<MagicLink>,
    private readonly jwtService: JwtService,
    private readonly config: ConfigService,
    private readonly walletService: WalletService,
    private readonly googleStrategy: GoogleStrategy,
    private readonly passkeyStrategy: PasskeyStrategy,
    private readonly magicLinkStrategy: MagicLinkStrategy,
  ) {}

  // ─── Google ──────────────────────────────────────────────────────────────

  async googleAuth(idToken: string) {
    const payload = await this.googleStrategy.verifyToken(idToken);
    if (!payload?.email) throw new UnauthorizedException('Invalid Google token');

    let user = await this.userRepo.findOne({ where: { googleId: payload.sub } });
    let wallet: { solanaAddress: string; usdcTokenAddress: string } | null = null;

    if (!user) {
      const byEmail = await this.userRepo.findOne({ where: { email: payload.email } });

      if (byEmail) {
        byEmail.googleId = payload.sub;
        user = await this.userRepo.save(byEmail);
      } else {
        const newUser = Object.assign(new User(), {
          email: payload.email as string,
          name: payload.name ?? null,
          avatarUrl: payload.picture ?? null,
          googleId: payload.sub as string,
        });
        user = await this.userRepo.save(newUser);
        wallet = await this.walletService.generateWalletsForUser(user.id);
      }
    }

    return this.issueTokenResponse(user as User, wallet);
  }

  // ─── Passkey ─────────────────────────────────────────────────────────────

  async passkeyRegisterOptions(email: string) {
    let user = await this.userRepo.findOne({ where: { email } });
    if (!user) {
      user = await this.userRepo.save(this.userRepo.create({ email }));
      await this.walletService.generateWalletsForUser(user.id);
    }
    return this.passkeyStrategy.generateRegistrationOptions(email, user.id);
  }

  async passkeyRegisterVerify(email: string, credential: RegistrationResponseJSON) {
    const user = await this.userRepo.findOne({ where: { email } });
    if (!user) throw new BadRequestException('User not found');

    const result = await this.passkeyStrategy.verifyRegistration(email, credential);
    if (!result.verified || !result.registrationInfo) {
      throw new UnauthorizedException('Passkey registration failed');
    }

    const { credential: cred, credentialDeviceType, credentialBackedUp } =
      result.registrationInfo;

    await this.passkeyRepo.save(
      this.passkeyRepo.create({
        userId: user.id,
        credentialId: cred.id,
        credentialPublicKey: Buffer.from(cred.publicKey),
        counter: cred.counter,
        deviceType: credentialDeviceType,
        backedUp: credentialBackedUp,
        transports: credential.response.transports ?? [],
      }),
    );

    // Wallet was generated at register/options step — return addresses if present
    const freshUser = await this.userRepo.findOne({ where: { id: user.id } });
    const wallet = freshUser?.solanaAddress && freshUser?.usdcTokenAddress
      ? { solanaAddress: freshUser.solanaAddress, usdcTokenAddress: freshUser.usdcTokenAddress }
      : null;
    return this.issueTokenResponse(user, wallet);
  }

  async passkeyLoginOptions(email: string) {
    return this.passkeyStrategy.generateAuthenticationOptions(email);
  }

  async passkeyLoginVerify(email: string, credential: AuthenticationResponseJSON) {
    const { verified, passkeyId } = await this.passkeyStrategy.verifyAuthentication(
      email,
      credential,
    );

    if (!verified.verified || !verified.authenticationInfo) {
      throw new UnauthorizedException('Passkey authentication failed');
    }

    await this.passkeyRepo.update(passkeyId, {
      counter: verified.authenticationInfo.newCounter,
      lastUsedAt: new Date(),
    });

    const user = await this.userRepo.findOne({ where: { email } });
    if (!user) throw new UnauthorizedException();

    return this.issueTokenResponse(user);
  }

  // ─── Magic link ──────────────────────────────────────────────────────────

  async magicLinkSend(email: string) {
    let user = await this.userRepo.findOne({ where: { email } });
    if (!user) {
      user = await this.userRepo.save(this.userRepo.create({ email }));
      await this.walletService.generateWalletsForUser(user.id);
    }
    // Wallet is generated here; address returned at verify step when JWT is issued

    const rawToken = nanoid(48);
    const tokenHash = await bcrypt.hash(rawToken, 10);
    const expiryMinutes = this.config.get<number>('MAGIC_LINK_EXPIRY_MINUTES') ?? 15;
    const expiresAt = new Date(Date.now() + Number(expiryMinutes) * 60 * 1000);

    await this.magicLinkRepo.save(
      this.magicLinkRepo.create({ userId: user.id, tokenHash, expiresAt }),
    );

    const appUrl = this.config.get<string>('APP_URL') ?? 'http://localhost:8000';
    const link = `${appUrl}/auth/verify?token=${rawToken}`;

    // TODO: send via Resend / SendGrid
    this.logger.log(`Magic link for ${email}: ${link}`);

    return { message: 'Magic link sent' };
  }

  async magicLinkVerify(rawToken: string) {
    const user = await this.magicLinkStrategy.verifyToken(rawToken);
    if (!user) throw new UnauthorizedException('Invalid or expired magic link');
    const wallet = user.solanaAddress && user.usdcTokenAddress
      ? { solanaAddress: user.solanaAddress, usdcTokenAddress: user.usdcTokenAddress }
      : null;
    return this.issueTokenResponse(user, wallet);
  }

  // ─── Me ──────────────────────────────────────────────────────────────────

  async getMe(userId: string) {
    return this.userRepo.findOne({ where: { id: userId } });
  }

  // ─── Helpers ─────────────────────────────────────────────────────────────

  private issueTokenResponse(
    user: User,
    wallet?: { solanaAddress: string; usdcTokenAddress: string } | null,
  ) {
    const payload: JwtPayload = { sub: user.id, email: user.email };
    return {
      accessToken: this.jwtService.sign(payload),
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        avatarUrl: user.avatarUrl,
        ...(wallet ?? {}),
      },
    };
  }
}
