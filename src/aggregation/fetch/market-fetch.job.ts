import { Processor } from '@nestjs/bull';

@Processor('market-fetch')
export class MarketFetchJob {}
