import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
  Unique,
  Index,
} from 'typeorm';
import { MarketGroup } from './market-group.entity';

@Entity('markets')
@Unique(['venueId', 'venueMarketId'])
@Index(['matchGroupId'])
@Index(['status'])
@Index(['category'])
export class Market {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'match_group_id', nullable: true })
  matchGroupId: string | null;

  @ManyToOne(() => MarketGroup, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'match_group_id' })
  matchGroup: MarketGroup | null;

  @Column({ name: 'venue_id' })
  venueId: string;

  @Column({ name: 'venue_market_id' })
  venueMarketId: string;

  @Column()
  title: string;

  @Column()
  category: string;

  @Column()
  engine: string; // 'clob' | 'amm'

  @Column({ name: 'resolution_date', type: 'timestamptz', nullable: true })
  resolutionDate: Date | null;

  @Column({ default: 'open' })
  status: string;

  @Column({ name: 'volume24h', type: 'float', default: 0 })
  volume24h: number;

  @Column({ type: 'float', default: 0 })
  liquidity: number;

  @Column({ name: 'raw_data', type: 'jsonb' })
  rawData: Record<string, unknown>;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
