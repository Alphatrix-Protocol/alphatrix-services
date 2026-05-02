import { Processor, Process } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import { Job } from 'bull';
import { MarketFetchService } from './market-fetch.service';
import { MarketMatchingService } from '../matching/market-matching.service';

@Processor('market-fetch')
export class MarketFetchJob {
  private readonly logger = new Logger(MarketFetchJob.name);

  constructor(
    private readonly marketFetchService: MarketFetchService,
    private readonly marketMatchingService: MarketMatchingService,
  ) {}

  @Process('sync-markets')
  async handleSyncMarkets(_job: Job): Promise<void> {
    const start = Date.now();
    this.logger.log(`sync-markets started at ${new Date(start).toISOString()}`);

    let total = 0;

    try {
      // Sequential: upsert each venue before fetching the next so an OOM on one
      // venue doesn't lose the other venue's already-fetched data.
      const polymarkets = await this.marketFetchService.fetchAllPolymarkets();
      await this.marketFetchService.upsertMarkets(polymarkets);
      total += polymarkets.length;
      this.logger.log(`Polymarket upserted: ${polymarkets.length}`);

      const bayseMarkets = await this.marketFetchService.fetchAllBayesEvents();
      await this.marketFetchService.upsertMarkets(bayseMarkets);
      total += bayseMarkets.length;
      this.logger.log(`Bayse upserted: ${bayseMarkets.length}`);

      await this.marketFetchService.expireStaleMarkets();

      this.logger.log(
        `sync-markets fetch+upsert done in ${Date.now() - start}ms — ${total} markets total`,
      );

      await this.marketMatchingService.runMatching();

      this.logger.log(`sync-markets fully complete in ${Date.now() - start}ms`);
    } catch (err) {
      this.logger.error(`sync-markets failed after ${Date.now() - start}ms`, err);
    }
  }
}
