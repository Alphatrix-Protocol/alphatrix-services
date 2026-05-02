import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { WalletService } from '../wallet/wallet.service';
import { JwtPayload } from './interfaces/jwt-payload.interface';
import { User } from './entities/user.entity';
import { PrivyAccessTokenClaims } from './services/privy-token-verifier.service';

@Injectable()
export class AuthService {
  constructor(
    @InjectRepository(User) private readonly userRepo: Repository<User>,
    private readonly walletService: WalletService,
  ) {}

  async getMe(userId: string) {
    const user = await this.userRepo.findOne({ where: { id: userId } });
    if (!user) return null;
    return {
      id: user.id,
      privyUserId: user.privyUserId,
      email: user.email,
      name: user.name,
      avatarUrl: user.avatarUrl,
      solanaAddress: user.solanaAddress,
      usdcTokenAddress: user.usdcTokenAddress,
    };
  }

  async resolveJwtPayloadFromPrivyClaims(
    claims: PrivyAccessTokenClaims,
  ): Promise<JwtPayload> {
    let user = await this.userRepo.findOne({
      where: { privyUserId: claims.sub },
    });

    const resolvedEmail = claims.email ?? `${claims.sub}@privy.local`;

    if (!user) {
      user = await this.userRepo.save(
        this.userRepo.create({
          privyUserId: claims.sub,
          email: resolvedEmail,
        }),
      );
      await this.walletService.generateWalletsForUser(user.id);
    } else if (claims.email && user.email !== claims.email) {
      user.email = claims.email;
      user = await this.userRepo.save(user);
    }

    return {
      sub: user.id,
      privyUserId: claims.sub,
      email: user.email,
      appId: claims.aud,
      sessionId: claims.sid,
      issuer: claims.iss,
      iat: claims.iat,
      exp: claims.exp,
    };
  }
}
