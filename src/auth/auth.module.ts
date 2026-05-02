import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule } from '@nestjs/config';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { WalletModule } from '../wallet/wallet.module';
import { User } from './entities/user.entity';
import { PrivyTokenVerifierService } from './services/privy-token-verifier.service';

@Module({
  imports: [
    ConfigModule,
    TypeOrmModule.forFeature([User]),
    WalletModule,
  ],
  controllers: [AuthController],
  providers: [AuthService, PrivyTokenVerifierService, JwtAuthGuard],
  exports: [JwtAuthGuard, AuthService, PrivyTokenVerifierService],
})
export class AuthModule {}
