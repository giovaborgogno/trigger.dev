import { BasePresenter } from "./basePresenter.server";

type DeadLetterListOptions = {
  projectId: string;
  environmentId: string;
  status?: "PENDING" | "RETRIED" | "DISCARDED";
  eventType?: string;
  cursor?: string;
  limit?: number;
};

const DEFAULT_LIMIT = 25;

export type DeadLetterListData = Awaited<ReturnType<DeadLetterListPresenter["call"]>>;

export class DeadLetterListPresenter extends BasePresenter {
  public async call({
    projectId,
    environmentId,
    status,
    eventType,
    cursor,
    limit = DEFAULT_LIMIT,
  }: DeadLetterListOptions) {
    const hasFilters = !!status || !!eventType;

    const baseWhere: any = { projectId, environmentId };
    if (status) baseWhere.status = status;
    if (eventType) baseWhere.eventType = eventType;

    const cursorWhere = cursor
      ? { ...baseWhere, createdAt: { lt: new Date(cursor) } }
      : baseWhere;

    const [items, pendingCount, eventTypeGroups] = await Promise.all([
      this._replica.deadLetterEvent.findMany({
        where: cursorWhere,
        orderBy: { createdAt: "desc" },
        take: limit + 1,
      }),
      this._replica.deadLetterEvent.count({
        where: { projectId, environmentId, status: "PENDING" },
      }),
      this._replica.deadLetterEvent.groupBy({
        by: ["eventType"],
        where: { projectId, environmentId },
      }),
    ]);

    const hasMore = items.length > limit;
    const data = items.slice(0, limit);
    const lastItem = data[data.length - 1];

    return {
      items: data.map((item) => ({
        id: item.id,
        friendlyId: item.friendlyId,
        eventType: item.eventType,
        payload: item.payload,
        taskSlug: item.taskSlug,
        status: item.status as "PENDING" | "RETRIED" | "DISCARDED",
        error: item.error,
        attemptCount: item.attemptCount,
        sourceEventId: item.sourceEventId,
        createdAt: item.createdAt,
        processedAt: item.processedAt,
      })),
      nextCursor: hasMore && lastItem ? lastItem.createdAt.toISOString() : null,
      hasMore,
      pendingCount,
      eventTypes: eventTypeGroups.map((g) => g.eventType),
      hasFilters,
    };
  }
}
