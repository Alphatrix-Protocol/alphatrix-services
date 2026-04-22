import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, IsNull, MoreThan } from 'typeorm';
import { MagicLink } from '../entities/magic-link.entity';
import * as bcrypt from 'bcrypt';

@Injectable()
export class MagicLinkStrategy {
  constructor(
    @InjectRepository(MagicLink)
    private readonly magicLinkRepo: Repository<MagicLink>,
  ) {}

  async verifyToken(rawToken: string) {
    const now = new Date();
    const candidates = await this.magicLinkRepo.find({
      where: { usedAt: IsNull(), expiresAt: MoreThan(now) },
      relations: ['user'],
    });

    for (const link of candidates) {
      const match = await bcrypt.compare(rawToken, link.tokenHash);
      if (match) {
        await this.magicLinkRepo.update(link.id, { usedAt: now });
        return link.user;
      }
    }

    return null;
  }
}
