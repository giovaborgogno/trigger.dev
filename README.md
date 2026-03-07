<div align="center">

# Fanout.sh

### Durable pub/sub for background jobs

A fork of [Trigger.dev](https://trigger.dev) with a native event system: define events, subscribe tasks, publish — with fan-out, DLQ, filtering, replay, and more built in.

[![License](https://img.shields.io/badge/license-Apache%202.0-blue.svg)](./LICENSE)

</div>

## Three concepts

**Define an event:**

```typescript
import { event } from "@trigger.dev/sdk";
import { z } from "zod";

export const orderCreated = event({
  id: "order.created",
  schema: z.object({
    orderId: z.string(),
    amount: z.number(),
    customerId: z.string(),
  }),
});
```

**Subscribe tasks:**

```typescript
import { task } from "@trigger.dev/sdk";
import { orderCreated } from "./events";

export const sendReceipt = task({
  id: "send-receipt",
  on: orderCreated,
  run: async (payload) => {
    // payload is fully typed from the Zod schema
    await sendEmail(payload.customerId, payload.orderId);
  },
});
```

**Publish:**

```typescript
await orderCreated.publish({
  orderId: "order-123",
  amount: 500,
  customerId: "cust-1",
});
```

One event, N subscribers. Each gets its own durable run with retries, logging, and tracing.

## What's included

- **Fan-out** — One event triggers N tasks automatically
- **Dead letter queue** — Failed events go to DLQ with dashboard retry/discard
- **Event replay** — Re-publish historical events from a time range
- **Content-based filtering** — `filter: { amount: [{ $gte: 1000 }] }`
- **Ordering guarantees** — Sequential processing per key with `orderingKey`
- **Publish and wait** — Scatter-gather with `publishAndWait()`
- **Rate limiting** — Per-event, Redis-backed sliding window
- **Consumer groups** — Kafka-style load balancing with `consumerGroup`
- **Wildcard patterns** — `events.match("order.*")` for event families
- **Schema validation** — Zod, Valibot, ArkType — validated at publish time
- **Full persistence** — ClickHouse event log with materialized analytics views
- **Dashboard UI** — Events list, event detail with charts, DLQ management

## Based on Trigger.dev

This is a fork of [Trigger.dev](https://github.com/triggerdotdev/trigger.dev) (Apache 2.0). All the existing Trigger.dev features — durable execution, retries, queues, concurrency, realtime, schedules — are still here. Fanout.sh adds the event system on top.

For Trigger.dev docs and setup, see [trigger.dev/docs](https://trigger.dev/docs).

## Author

Giovanni Borgogno

## License

Apache 2.0 — see [LICENSE](./LICENSE).

---

# Trigger.dev (upstream)

Everything below is the original Trigger.dev README. Fanout.sh is a fork — all Trigger.dev features still work.

## About Trigger.dev

Trigger.dev is the open-source platform for building AI workflows in TypeScript. Long-running tasks with retries, queues, observability, and elastic scaling.

### Key features

- **[JavaScript and TypeScript SDK](https://trigger.dev/docs/tasks/overview)** - Build background tasks using familiar programming models
- **[Long-running tasks](https://trigger.dev/docs/runs/max-duration)** - Handle resource-heavy tasks without timeouts
- **[Durable cron schedules](https://trigger.dev/docs/tasks/scheduled#scheduled-tasks-cron)** - Create and attach recurring schedules of up to a year
- **[Trigger.dev Realtime](https://trigger.dev/docs/realtime/overview)** - Trigger, subscribe to, and get real-time updates for runs, with LLM streaming support
- **[Build extensions](https://trigger.dev/docs/config/extensions/overview#build-extensions)** - Hook directly into the build system and customize the build process
- **[React hooks](https://trigger.dev/docs/frontend/react-hooks#react-hooks)** - Interact with the Trigger.dev API on your frontend
- **[Batch triggering](https://trigger.dev/docs/triggering#tasks-batchtrigger)** - Initiate multiple runs of a task with custom payloads
- **[Concurrency & queues](https://trigger.dev/docs/queue-concurrency#concurrency-and-queues)** - Set concurrency rules to manage task execution
- **[Automatic retries](https://trigger.dev/docs/errors-retrying)** - Automatic retry on uncaught errors
- **[Checkpointing](https://trigger.dev/docs/how-it-works#the-checkpoint-resume-system)** - Durable tasks via checkpointing
- **[Observability & monitoring](https://trigger.dev/product/observability-and-monitoring)** - Full tracing and logs for every run

For full docs, see [trigger.dev/docs](https://trigger.dev/docs).

### Self-hosting

- [Docker guide](https://trigger.dev/docs/self-hosting/docker)
- [Kubernetes guide](https://trigger.dev/docs/self-hosting/kubernetes)

### Development

To setup and develop locally, follow the [development guide](./CONTRIBUTING.md).
