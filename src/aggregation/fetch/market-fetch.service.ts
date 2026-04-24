import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
import { ConfigService } from '@nestjs/config';
import { Repository } from 'typeorm';
import { PolymarketAdapter } from '../../venues/polymarket/polymarket.adapter';
import { BayseAdapter } from '../../venues/bayse/bayse.adapter';
import type { NormalizedMarket } from '../../venues/interfaces/venue-adapter.interface';
import { Market } from '../entities/market.entity';

@Injectable()
export class MarketFetchService implements OnModuleInit {
  private readonly logger = new Logger(MarketFetchService.name);
  private static readonly BATCH_SIZE = 50;

  constructor(
    private readonly polymarketAdapter: PolymarketAdapter,
    private readonly bayseAdapter: BayseAdapter,
    private readonly configService: ConfigService,
    @InjectRepository(Market) private readonly marketRepo: Repository<Market>,
    @InjectQueue('market-fetch') private readonly marketFetchQueue: Queue,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.marketFetchQueue.add(
      'sync-markets',
      {},
      {
        repeat: {
          every: this.configService.get<number>('MARKET_FETCH_INTERVAL_MS', 60000),
        },
        removeOnComplete: true,
        removeOnFail: false,
      },
    );
    this.logger.log('sync-markets repeatable job registered');
  }

  async fetchAllPolymarkets(): Promise<NormalizedMarket[]> {
    try {
      const markets = await this.polymarketAdapter.fetchMarkets();
      this.logger.log(`Fetched ${markets.length} Polymarket markets`);
      return markets;
    } catch (err) {
      this.logger.error('Failed to fetch Polymarket markets', err);
      return [];
    }
  }

  async fetchAllBayesEvents(): Promise<NormalizedMarket[]> {
    try {
      const markets = await this.bayseAdapter.fetchMarkets();
      this.logger.log(`Fetched ${markets.length} Bayse events`);
      return markets;
    } catch (err) {
      this.logger.error('Failed to fetch Bayse events', err);
      return [];
    }
  }

  async upsertMarkets(markets: NormalizedMarket[]): Promise<void> {
    if (markets.length === 0) return;

    const now = new Date();
    const batches: NormalizedMarket[][] = [];
    for (let i = 0; i < markets.length; i += MarketFetchService.BATCH_SIZE) {
      batches.push(markets.slice(i, i + MarketFetchService.BATCH_SIZE));
    }

    await Promise.all(
      batches.map((batch) =>
        this.marketRepo
          .createQueryBuilder()
          .insert()
          .into(Market)
          .values(
            batch.map((m) => ({
              venueId: m.venueId,
              venueMarketId: m.venueMarketId,
              title: m.title,
              category: m.category,
              engine: m.engine,
              resolutionDate: m.resolutionDate,
              status: m.status,
              volume24h: m.volume24h,
              liquidity: m.liquidity,
              rawData: m,
              updatedAt: now,
            })) as any,
          )
          .orUpdate(
            ['title', 'status', 'resolution_date', 'volume24h', 'liquidity', 'raw_data', 'updated_at'],
            ['venue_id', 'venue_market_id'],
          )
          .execute(),
      ),
    );

    this.logger.log(`Upserted ${markets.length} markets`);
  }
}
