import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { MarketGroup } from '../entities/market-group.entity';
import { Market } from '../entities/market.entity';

interface FindAllParams {
  category?: string;
  status?: string;
  venueId?: string;
  page: number;
  size: number;
}

const KNOWN_VENUES = ['polymarket', 'bayse'];

@Injectable()
export class AggregationService {
  constructor(
    @InjectRepository(MarketGroup)
    private readonly marketGroupRepo: Repository<MarketGroup>,
    @InjectRepository(Market)
    private readonly marketRepo: Repository<Market>,
  ) {}

  async findAll({ category, status, venueId, page, size }: FindAllParams) {
    // When filtering by a specific venue, return a simple paginated list
    if (venueId) {
      return this.findByVenue({ venueId, category, status, page, size });
    }

    // Default: interleave markets from all known venues so neither dominates
    const perVenue = Math.ceil(size / KNOWN_VENUES.length);

    const venuePages = await Promise.all(
      KNOWN_VENUES.map((v) =>
        this.findByVenue({ venueId: v, category, status, page, size: perVenue }),
      ),
    );

    // Interleave: [poly[0], bayse[0], poly[1], bayse[1], ...]
    const interleaved: Market[] = [];
    const maxLen = Math.max(...venuePages.map((vp) => vp.data.length));
    for (let i = 0; i < maxLen; i++) {
      for (const vp of venuePages) {
        if (i < vp.data.length) interleaved.push(vp.data[i]);
      }
    }

    const total = venuePages.reduce((sum, vp) => sum + vp.total, 0);

    return { data: interleaved.slice(0, size), total, page, size };
  }

  private async findByVenue({
    venueId,
    category,
    status,
    page,
    size,
  }: Required<Pick<FindAllParams, 'venueId'>> & Omit<FindAllParams, 'venueId'>) {
    const qb = this.marketRepo
      .createQueryBuilder('m')
      .where('m.venueId = :venueId', { venueId });

    if (category) qb.andWhere('m.category = :category', { category });
    if (status) qb.andWhere('m.status = :status', { status });
    else qb.andWhere("m.status = 'open'"); // default: only open markets

    const [data, total] = await qb
      .orderBy('m.liquidity', 'DESC')
      .skip((page - 1) * size)
      .take(size)
      .getManyAndCount();

    return { data, total };
  }

  async findOne(id: string) {
    const group = await this.marketGroupRepo.findOne({
      where: { id },
      relations: ['markets'],
    });

    if (!group) {
      const market = await this.marketRepo.findOne({ where: { id } });
      if (!market) throw new NotFoundException(`Market ${id} not found`);
      return market;
    }

    return group;
  }
}
