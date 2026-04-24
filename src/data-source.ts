import 'dotenv/config';
import { DataSource } from 'typeorm';
import { User } from './auth/entities/user.entity';
import { Passkey } from './auth/entities/passkey.entity';
import { MagicLink } from './auth/entities/magic-link.entity';
import { MarketGroup } from './aggregation/entities/market-group.entity';
import { Market } from './aggregation/entities/market.entity';
import { MatchReviewQueue } from './aggregation/entities/match-review-queue.entity';

export const AppDataSource = new DataSource({
  type: 'postgres',
  url: process.env.DATABASE_URL,
  entities: [User, Passkey, MagicLink, MarketGroup, Market, MatchReviewQueue],
  migrations: ['src/migrations/*.ts'],
});
