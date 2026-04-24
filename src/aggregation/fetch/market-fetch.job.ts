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

    try {
      const [polymarkets, bayseMarkets] = await Promise.all([
        this.marketFetchService.fetchAllPolymarkets(),
        this.marketFetchService.fetchAllBayesEvents(),
      ]);

      const combined = [...polymarkets, ...bayseMarkets];
      await this.marketFetchService.upsertMarkets(combined);

      const fetchDuration = Date.now() - start;
      this.logger.log(
        `sync-markets fetch+upsert done in ${fetchDuration}ms — ${combined.length} markets`,
      );

      // Run matching on newly-upserted markets
      await this.marketMatchingService.runMatching();

      this.logger.log(`sync-markets fully complete in ${Date.now() - start}ms`);
    } catch (err) {
      this.logger.error(`sync-markets failed after ${Date.now() - start}ms`, err);
    }
  }
}
