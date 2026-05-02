import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import { Market } from '../entities/market.entity';
import { MarketGroup } from '../entities/market-group.entity';
import { MatchReviewQueue } from '../entities/match-review-queue.entity';
import { scoreMarketPair } from './matching.utils';

const MATCH_THRESHOLD = 0.75;
const REVIEW_THRESHOLD = 0.50;
const MAX_PER_VENUE = 500;
const SOLO_BATCH = 100;
const MATCH_TIMEOUT_MS = 45_000;

@Injectable()
export class MarketMatchingService {
  private readonly logger = new Logger(MarketMatchingService.name);
  private isMatchingInProgress = false;

  constructor(
    @InjectRepository(Market) private readonly marketRepo: Repository<Market>,
    @InjectRepository(MarketGroup) private readonly groupRepo: Repository<MarketGroup>,
    @InjectRepository(MatchReviewQueue) private readonly reviewRepo: Repository<MatchReviewQueue>,
  ) {}

  async runMatching(): Promise<void> {
    if (this.isMatchingInProgress) {
      this.logger.warn('Matching already in progress — skipping');
      return;
    }
    this.isMatchingInProgress = true;
    try {
      await Promise.race([
        this.match(),
        new Promise<never>((_, reject) =>
          setTimeout(
            () => reject(new Error(`timed out after ${MATCH_TIMEOUT_MS}ms`)),
            MATCH_TIMEOUT_MS,
          ),
        ),
      ]);
    } catch (err) {
      this.logger.error(
        `Matching run failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      this.isMatchingInProgress = false;
    }
  }

  private async match(): Promise<void> {
    const start = Date.now();

    // Get distinct venues that have unmatched open markets, then pull
    // top MAX_PER_VENUE by volume24h DESC per venue at the DB level.
    const venueRows = await this.marketRepo
      .createQueryBuilder('m')
      .select('DISTINCT m.venue_id', 'venueId')
      .where('m.match_group_id IS NULL AND m.status = :status', { status: 'open' })
      .getRawMany<{ venueId: string }>();

    if (venueRows.length === 0) {
      this.logger.debug('No unmatched open markets — skipping');
      return;
    }

    const perVenue = await Promise.all(
      venueRows.map(({ venueId }) =>
        this.marketRepo.find({
          where: { matchGroupId: IsNull(), status: 'open', venueId },
          take: MAX_PER_VENUE,
          order: { volume24h: 'DESC' },
        }),
      ),
    );

    const unmatched = perVenue.flat();

    if (unmatched.length === 0) {
      this.logger.debug('No unmatched open markets — skipping');
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
          await new Promise((r) => setImmediate(r));
        }
      }
    }

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

  // Batch-inserts market_groups (100 rows per INSERT) then links markets back
  // with a single CASE-WHEN UPDATE per batch — no per-row round-trips.
  private async createSoloGroups(markets: Market[]): Promise<void> {
    if (markets.length === 0) return;

    for (let i = 0; i < markets.length; i += SOLO_BATCH) {
      const chunk = markets.slice(i, i + SOLO_BATCH);

      const result = await this.groupRepo
        .createQueryBuilder()
        .insert()
        .into(MarketGroup)
        .values(
          chunk.map((m) => ({
            canonicalTitle: m.title,
            category: m.category,
            resolutionDate: m.resolutionDate,
            status: m.status,
            matchedAt: null,
            matchScore: null,
          })),
        )
        .returning('id')
        .execute();

      const groupIds = result.generatedMaps.map((g) => g.id as string);
      await this.batchLinkMarkets(chunk, groupIds);
    }
  }

  // Single UPDATE ... CASE id WHEN $1::uuid THEN $2::uuid ... per batch.
  private async batchLinkMarkets(chunk: Market[], groupIds: string[]): Promise<void> {
    const params: string[] = [];
    const caseFragments: string[] = [];

    for (let k = 0; k < chunk.length; k++) {
      params.push(chunk[k].id, groupIds[k]);
      caseFragments.push(`WHEN $${params.length - 1}::uuid THEN $${params.length}::uuid`);
    }

    const inList = chunk.map((_, k) => `$${k * 2 + 1}::uuid`).join(', ');
    await this.marketRepo.query(
      `UPDATE markets SET match_group_id = CASE id ${caseFragments.join(' ')} END WHERE id IN (${inList})`,
      params,
    );
  }
}
