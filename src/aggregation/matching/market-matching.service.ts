import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import { Market } from '../entities/market.entity';
import { MarketGroup } from '../entities/market-group.entity';
import { MatchReviewQueue } from '../entities/match-review-queue.entity';
import { scoreMarketPair } from './matching.utils';

const MATCH_THRESHOLD = 0.75;
const REVIEW_THRESHOLD = 0.50;

@Injectable()
export class MarketMatchingService {
  private readonly logger = new Logger(MarketMatchingService.name);
  private running = false;

  constructor(
    @InjectRepository(Market) private readonly marketRepo: Repository<Market>,
    @InjectRepository(MarketGroup) private readonly groupRepo: Repository<MarketGroup>,
    @InjectRepository(MatchReviewQueue) private readonly reviewRepo: Repository<MatchReviewQueue>,
  ) {}

  async runMatching(): Promise<void> {
    if (this.running) {
      this.logger.warn('Matching already in progress — skipping');
      return;
    }
    this.running = true;

    try {
      await this.match();
    } finally {
      this.running = false;
    }
  }

  private async match(): Promise<void> {
    const start = Date.now();

    // Load all markets that haven't been assigned to a group yet
    const unmatched = await this.marketRepo.find({ where: { matchGroupId: IsNull() } });
    if (unmatched.length === 0) {
      this.logger.debug('No unmatched markets — skipping');
      return;
    }

    const byVenue = new Map<string, Market[]>();
    for (const m of unmatched) {
      const list = byVenue.get(m.venueId) ?? [];
      list.push(m);
      byVenue.set(m.venueId, list);
    }

    const venues = [...byVenue.keys()];
    const matchedIds = new Set<string>();
    const pairs: { a: Market; b: Market; score: number }[] = [];

    // Score every cross-venue pair (only comparing markets from different venues)
    for (let i = 0; i < venues.length; i++) {
      for (let j = i + 1; j < venues.length; j++) {
        const listA = byVenue.get(venues[i]) ?? [];
        const listB = byVenue.get(venues[j]) ?? [];

        for (const a of listA) {
          for (const b of listB) {
            const score = scoreMarketPair(a, b);
            if (score >= REVIEW_THRESHOLD) {
              pairs.push({ a, b, score });
            }
          }
        }
      }
    }

    // Greedy: process highest-scoring pairs first so each market is matched at most once
    pairs.sort((x, y) => y.score - x.score);

    let autoMatched = 0;
    let reviewQueued = 0;

    for (const { a, b, score } of pairs) {
      if (matchedIds.has(a.id) || matchedIds.has(b.id)) continue;

      if (score >= MATCH_THRESHOLD) {
        await this.createMatchGroup(a, b, score);
        matchedIds.add(a.id);
        matchedIds.add(b.id);
        autoMatched++;
      } else {
        // Only queue for review once per pair (skip if already queued from a previous run)
        const existing = await this.reviewRepo.findOne({
          where: { marketIdA: a.id, marketIdB: b.id },
        });
        if (!existing) {
          await this.reviewRepo.save(
            this.reviewRepo.create({
              marketIdA: a.id,
              marketIdB: b.id,
              titleA: a.title,
              titleB: b.title,
              score,
              status: 'pending',
              reviewedAt: null,
            }),
          );
        }
        reviewQueued++;
      }
    }

    // Create solo groups for markets that didn't match anything
    const remaining = unmatched.filter((m) => !matchedIds.has(m.id));
    await this.createSoloGroups(remaining);

    this.logger.log(
      `Matching done in ${Date.now() - start}ms — ` +
        `${autoMatched} pairs auto-matched, ${reviewQueued} queued for review, ` +
        `${remaining.length} solo groups created`,
    );
  }

  private async createMatchGroup(a: Market, b: Market, score: number): Promise<void> {
    const group = await this.groupRepo.save(
      this.groupRepo.create({
        canonicalTitle: a.title.length >= b.title.length ? a.title : b.title,
        category: a.category,
        resolutionDate: a.resolutionDate ?? b.resolutionDate,
        status: a.status === 'open' || b.status === 'open' ? 'open' : a.status,
        matchedAt: new Date(),
        matchScore: score,
      }),
    );

    await this.marketRepo.update({ id: a.id }, { matchGroupId: group.id });
    await this.marketRepo.update({ id: b.id }, { matchGroupId: group.id });
  }

  private async createSoloGroups(markets: Market[]): Promise<void> {
    if (markets.length === 0) return;

    // Batch-save all solo groups, then link each market by index
    const groups = await this.groupRepo.save(
      markets.map((m) =>
        this.groupRepo.create({
          canonicalTitle: m.title,
          category: m.category,
          resolutionDate: m.resolutionDate,
          status: m.status,
          matchedAt: null,
          matchScore: null,
        }),
      ),
    );

    // Update each market individually (different group ID per market)
    await Promise.all(
      markets.map((m, i) =>
        this.marketRepo.update({ id: m.id }, { matchGroupId: groups[i].id }),
      ),
    );
  }
}
