import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PolymarketAdapter } from '../../venues/polymarket/polymarket.adapter';
import { BayseAdapter } from '../../venues/bayse/bayse.adapter';
import type { NormalizedMarket } from '../../venues/interfaces/venue-adapter.interface';
import { Market } from '../entities/market.entity';

@Injectable()
export class MarketFetchService {
  private readonly logger = new Logger(MarketFetchService.name);

  private static readonly BATCH_SIZE = 50;

  constructor(
    private readonly polymarketAdapter: PolymarketAdapter,
    private readonly bayseAdapter: BayseAdapter,
    @InjectRepository(Market) private readonly marketRepo: Repository<Market>,
  ) {}

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
}
