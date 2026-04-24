import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
} from 'typeorm';

@Entity('match_review_queue')
export class MatchReviewQueue {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'market_id_a' })
  marketIdA: string;

  @Column({ name: 'market_id_b' })
  marketIdB: string;

  @Column({ name: 'title_a' })
  titleA: string;

  @Column({ name: 'title_b' })
  titleB: string;

  @Column({ type: 'float' })
  score: number;

  @Column({ default: 'pending' })
  status: string; // 'pending' | 'approved' | 'rejected'

  @Column({ name: 'reviewed_at', type: 'timestamptz', nullable: true })
  reviewedAt: Date | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
