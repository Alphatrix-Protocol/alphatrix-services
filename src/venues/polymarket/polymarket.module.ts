import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { PolymarketAdapter } from './polymarket.adapter';

@Module({
  imports: [HttpModule],
  providers: [PolymarketAdapter],
  exports: [PolymarketAdapter],
})
export class PolymarketModule {}
