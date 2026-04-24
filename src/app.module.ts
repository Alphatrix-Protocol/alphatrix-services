import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bull';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthModule } from './auth/auth.module';
import { AggregationModule } from './aggregation/aggregation.module';
import { JwtAuthGuard } from './auth/guards/jwt-auth.guard';
import { User } from './auth/entities/user.entity';
import { Passkey } from './auth/entities/passkey.entity';
import { MagicLink } from './auth/entities/magic-link.entity';
import { MarketGroup } from './aggregation/entities/market-group.entity';
import { Market } from './aggregation/entities/market.entity';
import { MatchReviewQueue } from './aggregation/entities/match-review-queue.entity';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        type: 'postgres',
        url: config.get<string>('DATABASE_URL'),
        entities: [User, Passkey, MagicLink, MarketGroup, Market, MatchReviewQueue],
        synchronize: true,
      }),
    }),
    BullModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        redis: config.get<string>('REDIS_URL') ?? 'redis://localhost:6379',
      }),
    }),
    AuthModule,
    AggregationModule,
  ],
  controllers: [AppController],
  providers: [AppService, { provide: APP_GUARD, useClass: JwtAuthGuard }],
})
export class AppModule {}
