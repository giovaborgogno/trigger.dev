import { type ClickHouse } from "@internal/clickhouse";
import { clickhouseClient } from "~/services/clickhouseInstance.server";
import { logger } from "~/services/logger.server";
import { BasePresenter } from "./basePresenter.server";

type EventListOptions = {
  projectId: string;
  environmentId: string;
  search?: string;
  showDeprecated?: boolean;
  page: number;
  pageSize?: number;
};

const DEFAULT_PAGE_SIZE = 25;

export type EventListItem = {
  id: string;
  slug: string;
  version: string;
  description: string | null;
  subscriberCount: number;
  recentEventCount: number;
  rateLimit: unknown | null;
  isDeprecated: boolean;
  createdAt: Date;
};

export type EventList = Awaited<ReturnType<EventListPresenter["call"]>>;

export class EventListPresenter extends BasePresenter {
  #clickhouse: ClickHouse;

  constructor(...args: ConstructorParameters<typeof BasePresenter>) {
    super(...args);
    this.#clickhouse = clickhouseClient;
  }

  public async call({
    projectId,
    environmentId,
    search,
    showDeprecated = false,
    page = 1,
    pageSize = DEFAULT_PAGE_SIZE,
  }: EventListOptions) {
    const hasFilters = !!search || showDeprecated;

    const where: any = { projectId };

    if (search) {
      where.slug = { contains: search, mode: "insensitive" };
    }

    if (!showDeprecated) {
      where.deprecatedAt = null;
    }

    const [totalCount, eventDefs] = await Promise.all([
      this._replica.eventDefinition.count({ where }),
      this._replica.eventDefinition.findMany({
        where,
        include: {
          _count: {
            select: {
              subscriptions: {
                where: { environmentId, enabled: true },
              },
            },
          },
        },
        orderBy: [{ slug: "asc" }, { createdAt: "desc" }],
        take: pageSize,
        skip: (page - 1) * pageSize,
      }),
    ]);

    // Fetch 24h event counts from ClickHouse (graceful degradation)
    let recentCounts: Record<string, number> = {};
    if (eventDefs.length > 0) {
      try {
        const slugs = eventDefs.map((e) => e.slug);
        const qb = this.#clickhouse.eventCounts.queryBuilder();

        qb.where("project_id = {projectId: String}", { projectId })
          .where("environment_id = {environmentId: String}", { environmentId })
          .where("bucket_start >= now() - INTERVAL 24 HOUR");

        // Use whereOr for multiple event types
        if (slugs.length === 1) {
          qb.where("event_type = {et: String}", { et: slugs[0]! });
        } else {
          qb.whereOr(
            slugs.map((slug, i) => ({
              clause: `event_type = {et${i}: String}`,
              params: { [`et${i}`]: slug },
            }))
          );
        }

        const [err, result] = await qb.execute();
        if (!err && result) {
          for (const row of result) {
            recentCounts[row.event_type] =
              (recentCounts[row.event_type] ?? 0) + row.event_count;
          }
        }
      } catch (e) {
        logger.warn("ClickHouse unavailable for event counts", {
          error: e instanceof Error ? e.message : String(e),
        });
      }
    }

    const totalPages = Math.ceil(totalCount / pageSize);

    const events: EventListItem[] = eventDefs.map((def) => ({
      id: def.id,
      slug: def.slug,
      version: def.version,
      description: def.description,
      subscriberCount: def._count.subscriptions,
      recentEventCount: recentCounts[def.slug] ?? 0,
      rateLimit: def.rateLimit,
      isDeprecated: def.deprecatedAt !== null,
      createdAt: def.createdAt,
    }));

    return {
      events,
      currentPage: page,
      totalPages,
      totalCount,
      hasFilters,
    };
  }
}
