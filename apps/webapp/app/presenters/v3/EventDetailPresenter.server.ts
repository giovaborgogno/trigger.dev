import { type ClickHouse } from "@internal/clickhouse";
import { clickhouseClient } from "~/services/clickhouseInstance.server";
import { logger } from "~/services/logger.server";
import { BasePresenter } from "./basePresenter.server";

type EventDetailOptions = {
  projectId: string;
  environmentId: string;
  eventSlug: string;
  statsPeriod?: string;
};

export type EventDetailData = Awaited<ReturnType<EventDetailPresenter["call"]>>;

export class EventDetailPresenter extends BasePresenter {
  #clickhouse: ClickHouse;

  constructor(...args: ConstructorParameters<typeof BasePresenter>) {
    super(...args);
    this.#clickhouse = clickhouseClient;
  }

  public async call({
    projectId,
    environmentId,
    eventSlug,
    statsPeriod = "24h",
  }: EventDetailOptions) {
    const event = await this._replica.eventDefinition.findFirst({
      where: { projectId, slug: eventSlug },
      orderBy: { createdAt: "desc" },
    });

    if (!event) {
      return null;
    }

    const [subscribers, stats, recentHistory] = await Promise.all([
      this._replica.eventSubscription.findMany({
        where: { eventDefinitionId: event.id, environmentId },
        select: {
          id: true,
          taskSlug: true,
          filter: true,
          pattern: true,
          consumerGroup: true,
          rateLimit: true,
          enabled: true,
          priority: true,
        },
        orderBy: { taskSlug: "asc" },
      }),
      this.#fetchStats(projectId, environmentId, eventSlug, statsPeriod),
      this.#fetchRecentHistory(projectId, environmentId, eventSlug),
    ]);

    return {
      event: {
        id: event.id,
        slug: event.slug,
        version: event.version,
        description: event.description,
        schema: event.schema,
        rateLimit: event.rateLimit,
        dlqConfig: event.dlqConfig,
        compatibleVersions: event.compatibleVersions,
        deprecatedAt: event.deprecatedAt,
        deprecatedMessage: event.deprecatedMessage,
        createdAt: event.createdAt,
      },
      subscribers,
      stats,
      recentHistory,
    };
  }

  async #fetchStats(
    projectId: string,
    environmentId: string,
    eventSlug: string,
    period: string
  ) {
    const intervalMap: Record<string, string> = {
      "1h": "1 HOUR",
      "6h": "6 HOUR",
      "24h": "24 HOUR",
      "7d": "7 DAY",
      "30d": "30 DAY",
    };

    const interval = intervalMap[period] ?? intervalMap["24h"];

    try {
      const qb = this.#clickhouse.eventCounts.queryBuilder();

      qb.where("project_id = {projectId: String}", { projectId })
        .where("environment_id = {environmentId: String}", { environmentId })
        .where("event_type = {eventType: String}", { eventType: eventSlug })
        .where(`bucket_start >= now() - INTERVAL ${interval}`)
        .orderBy("bucket_start ASC");

      const [err, result] = await qb.execute();

      if (err || !result) {
        return this.#emptyStats(period);
      }

      const buckets = result.map((row) => ({
        timestamp: row.bucket_start,
        eventCount: row.event_count,
        totalFanOut: row.total_fan_out,
      }));

      const totals = buckets.reduce(
        (acc, b) => ({
          eventCount: acc.eventCount + b.eventCount,
          totalFanOut: acc.totalFanOut + b.totalFanOut,
        }),
        { eventCount: 0, totalFanOut: 0 }
      );

      return { period, buckets, totals };
    } catch (e) {
      logger.warn("ClickHouse unavailable for event stats", {
        error: e instanceof Error ? e.message : String(e),
      });
      return this.#emptyStats(period);
    }
  }

  async #fetchRecentHistory(
    projectId: string,
    environmentId: string,
    eventSlug: string
  ) {
    try {
      const qb = this.#clickhouse.eventLog.queryBuilder();

      qb.where("project_id = {projectId: String}", { projectId })
        .where("environment_id = {environmentId: String}", { environmentId })
        .where("event_type = {eventType: String}", { eventType: eventSlug })
        .orderBy("published_at DESC, event_id DESC")
        .limit(20);

      const [err, result] = await qb.execute();

      if (err || !result) {
        return [];
      }

      return result.map((row) => {
        let payload: unknown;
        try {
          payload = JSON.parse(row.payload);
        } catch {
          payload = row.payload;
        }
        return {
          eventId: row.event_id,
          publishedAt: row.published_at,
          fanOutCount: row.fan_out_count,
          payload,
          tags: row.tags.length > 0 ? row.tags : undefined,
          publisherRunId: row.publisher_run_id || undefined,
        };
      });
    } catch (e) {
      logger.warn("ClickHouse unavailable for event history", {
        error: e instanceof Error ? e.message : String(e),
      });
      return [];
    }
  }

  #emptyStats(period: string) {
    return {
      period,
      buckets: [] as { timestamp: string; eventCount: number; totalFanOut: number }[],
      totals: { eventCount: 0, totalFanOut: 0 },
    };
  }
}
