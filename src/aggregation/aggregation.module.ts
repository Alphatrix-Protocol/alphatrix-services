import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MarketFetchService } from './fetch/market-fetch.service';
import { MarketFetchJob } from './fetch/market-fetch.job';
import { MarketGroup } from './entities/market-group.entity';
import { Market } from './entities/market.entity';
import { MatchReviewQueue } from './entities/match-review-queue.entity';
import { PolymarketModule } from '../venues/polymarket/polymarket.module';
import { BayseModule } from '../venues/bayse/bayse.module';

@Module({
  imports: [
    BullModule.registerQueue({ name: 'market-fetch' }),
    TypeOrmModule.forFeature([MarketGroup, Market, MatchReviewQueue]),
    PolymarketModule,
    BayseModule,
  ],
  providers: [MarketFetchService, MarketFetchJob],
  exports: [MarketFetchService],
})
export class AggregationModule {}
