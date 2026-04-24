import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  OneToMany,
} from 'typeorm';
import { Market } from './market.entity';

@Entity('market_groups')
export class MarketGroup {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'canonical_title' })
  canonicalTitle: string;

  @Column()
  category: string;

  @Column({ name: 'resolution_date', type: 'timestamptz', nullable: true })
  resolutionDate: Date | null;

  @Column({ default: 'open' })
  status: string;

  @Column({ name: 'matched_at', type: 'timestamptz', nullable: true })
  matchedAt: Date | null;

  @Column({ name: 'match_score', type: 'float', nullable: true })
  matchScore: number | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;

  @OneToMany(() => Market, (m) => m.matchGroup)
  markets: Market[];
}
