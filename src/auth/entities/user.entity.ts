import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  OneToMany,
} from 'typeorm';
import { Passkey } from './passkey.entity';
import { MagicLink } from './magic-link.entity';

@Entity('users')
export class User {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ unique: true })
  email: string;

  @Column({ nullable: true })
  name: string;

  @Column({ nullable: true })
  avatarUrl: string;

  @Column({ unique: true, nullable: true })
  googleId: string;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @OneToMany(() => Passkey, (pk) => pk.user)
  passkeys: Passkey[];

  @OneToMany(() => MagicLink, (ml) => ml.user)
  magicLinks: MagicLink[];

  // Wallet fields — populated by wallet service (future)
  @Column({ nullable: true })
  solanaAddress: string;

  @Column({ nullable: true })
  solanaSecretKeyEnc: string;

  @Column({ nullable: true })
  polygonAddress: string;

  @Column({ nullable: true })
  polygonPrivKeyEnc: string;

  @Column({ nullable: true })
  walletsGeneratedAt: Date;
}
