import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { BayseAdapter } from './bayse.adapter';

@Module({
  imports: [HttpModule],
  providers: [BayseAdapter],
  exports: [BayseAdapter],
})
export class BayseModule {}
