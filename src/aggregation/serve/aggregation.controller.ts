import { Controller, Get, Post, Param, Query, HttpCode, Logger } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiQuery, ApiBearerAuth } from '@nestjs/swagger';
import { Public } from '../../auth/decorators/public.decorator';
import { AggregationService } from './aggregation.service';
import { MarketFetchService } from '../fetch/market-fetch.service';

@ApiTags('markets')
@ApiBearerAuth()
@Controller('markets')
export class AggregationController {
  private readonly logger = new Logger(AggregationController.name);

  constructor(
    private readonly aggregationService: AggregationService,
    private readonly marketFetchService: MarketFetchService,
  ) {}

  @Public()
  @Get()
  @ApiOperation({ summary: 'List markets — interleaved across all venues by default' })
  @ApiQuery({ name: 'category', required: false })
  @ApiQuery({ name: 'status', required: false, enum: ['open', 'closed', 'resolved'] })
  @ApiQuery({ name: 'venueId', required: false, enum: ['polymarket', 'bayse'] })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'size', required: false, type: Number })
  findAll(
    @Query('category') category?: string,
    @Query('status') status?: string,
    @Query('venueId') venueId?: string,
    @Query('page') page = 1,
    @Query('size') size = 20,
  ) {
    return this.aggregationService.findAll({
      category,
      status,
      venueId,
      page: Number(page),
      size: Number(size),
    });
  }

  @Public()
  @Post('sync')
  @HttpCode(202)
  @ApiOperation({ summary: 'Trigger a market sync — returns immediately, runs in background' })
  sync() {
    (async () => {
      try {
        const polymarkets = await this.marketFetchService.fetchAllPolymarkets();
        await this.marketFetchService.upsertMarkets(polymarkets);

        const bayseMarkets = await this.marketFetchService.fetchAllBayesEvents();
        await this.marketFetchService.upsertMarkets(bayseMarkets);

        await this.marketFetchService.expireStaleMarkets();
      } catch (err: unknown) {
        this.logger.error('Manual sync failed', err instanceof Error ? err.message : err);
      }
    })();

    return { message: 'Sync started in background — check server logs for progress' };
  }

  @Public()
  @Get(':id')
  @ApiOperation({ summary: 'Get a single market by ID, group UUID, or venueMarketId' })
  findOne(@Param('id') id: string) {
    return this.aggregationService.findOne(id);
  }

  @Public()
  @Get(':id/price-history')
  @ApiOperation({ summary: 'Price history for a market — candles for primary venue, line for others' })
  @ApiQuery({ name: 'range', required: false, enum: ['1W', '1M', '3M', 'all'], description: 'Default: 3M' })
  findPriceHistory(
    @Param('id') id: string,
    @Query('range') range = '3M',
  ) {
    return this.aggregationService.findPriceHistory(id, range);
  }

  @Public()
  @Get(':id/trades')
  @ApiOperation({ summary: 'Recent trades for a market' })
  @ApiQuery({ name: 'limit', required: false, type: Number, description: 'Default: 20' })
  findTrades(
    @Param('id') id: string,
    @Query('limit') limit = 20,
  ) {
    return this.aggregationService.findTrades(id, Number(limit));
  }
}
