import { Controller, Get, Post, Param, Query, HttpCode, Logger } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiQuery, ApiBearerAuth } from '@nestjs/swagger';
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

  @Get()
  @ApiOperation({ summary: 'List markets — interleaved across all venues by default' })
  @ApiQuery({ name: 'category', required: false })
  @ApiQuery({ name: 'status', required: false, enum: ['open', 'closed', 'resolved'] })
  @ApiQuery({ name: 'venueId', required: false, enum: ['polymarket', 'bayse'], description: 'Filter to a single venue' })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'size', required: false, type: Number })
  findAll(
    @Query('category') category?: string,
    @Query('status') status?: string,
    @Query('venueId') venueId?: string,
    @Query('page') page = 1,
    @Query('size') size = 20,
  ) {
    return this.aggregationService.findAll({ category, status, venueId, page: Number(page), size: Number(size) });
  }

  @Post('sync')
  @HttpCode(202)
  @ApiOperation({ summary: 'Trigger a market sync — returns immediately, runs in background' })
  sync() {
    // Fire and forget — do not await
    Promise.all([
      this.marketFetchService.fetchAllPolymarkets(),
      this.marketFetchService.fetchAllBayesEvents(),
    ]).then(([polymarkets, bayseMarkets]) => {
      const combined = [...polymarkets, ...bayseMarkets];
      return this.marketFetchService.upsertMarkets(combined);
    }).catch((err: unknown) => {
      this.logger.error('Manual sync failed', err instanceof Error ? err.message : err);
    });

    return { message: 'Sync started in background — check server logs for progress' };
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a single market by ID' })
  findOne(@Param('id') id: string) {
    return this.aggregationService.findOne(id);
  }
}
