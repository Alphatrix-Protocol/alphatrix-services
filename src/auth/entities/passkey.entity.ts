import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  CreateDateColumn,
  JoinColumn,
} from 'typeorm';
import { User } from './user.entity';

@Entity('passkeys')
export class Passkey {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  userId: string;

  @ManyToOne(() => User, (user) => user.passkeys)
  @JoinColumn({ name: 'userId' })
  user: User;

  @Column({ unique: true })
  credentialId: string;

  @Column({ type: 'bytea' })
  credentialPublicKey: Buffer;

  @Column({ type: 'bigint' })
  counter: number;

  @Column()
  deviceType: string;

  @Column()
  backedUp: boolean;

  @Column('simple-array')
  transports: string[];

  @CreateDateColumn()
  createdAt: Date;

  @Column({ nullable: true })
  lastUsedAt: Date;
}
