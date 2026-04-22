import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { CacheModule } from '@nestjs/cache-manager';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtStrategy } from './strategies/jwt.strategy';
import { GoogleStrategy } from './strategies/google.strategy';
import { PasskeyStrategy } from './strategies/passkey.strategy';
import { MagicLinkStrategy } from './strategies/magic-link.strategy';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { WalletModule } from '../wallet/wallet.module';
import { User } from './entities/user.entity';
import { Passkey } from './entities/passkey.entity';
import { MagicLink } from './entities/magic-link.entity';

@Module({
  imports: [
    PassportModule,
    CacheModule.register(),
    TypeOrmModule.forFeature([User, Passkey, MagicLink]),
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.get<string>('JWT_SECRET'),
        signOptions: {
          expiresIn: (config.get<string>('JWT_EXPIRES_IN') ?? '7d') as any,
        },
      }),
    }),
    WalletModule,
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    JwtStrategy,
    GoogleStrategy,
    PasskeyStrategy,
    MagicLinkStrategy,
    JwtAuthGuard,
  ],
  exports: [JwtAuthGuard, JwtModule],
})
export class AuthModule {}
