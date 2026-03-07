import { ArrowLeftIcon } from "@heroicons/react/20/solid";
import { type ActionFunctionArgs, type LoaderFunctionArgs } from "@remix-run/server-runtime";
import { type MetaFunction, Form, useSearchParams, useNavigation, useFetcher } from "@remix-run/react";
import { useState } from "react";
import { typedjson, useTypedLoaderData } from "remix-typedjson";
import { z } from "zod";
import type { ChartConfig } from "~/components/primitives/charts/Chart";
import { Chart } from "~/components/primitives/charts/ChartCompound";
import { CodeBlock } from "~/components/code/CodeBlock";
import { MainCenteredContainer, PageBody, PageContainer } from "~/components/layout/AppLayout";
import { Badge } from "~/components/primitives/Badge";
import { Button, LinkButton } from "~/components/primitives/Buttons";
import { DateTime } from "~/components/primitives/DateTime";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTrigger,
} from "~/components/primitives/Dialog";
import { Header3 } from "~/components/primitives/Headers";
import { InfoPanel } from "~/components/primitives/InfoPanel";
import { Input } from "~/components/primitives/Input";
import { NavBar, PageAccessories, PageTitle } from "~/components/primitives/PageHeader";
import { Paragraph } from "~/components/primitives/Paragraph";
import * as Property from "~/components/primitives/PropertyTable";
import {
  Table,
  TableBlankRow,
  TableBody,
  TableCell,
  TableHeader,
  TableHeaderCell,
  TableRow,
} from "~/components/primitives/Table";
import { EnabledStatus } from "~/components/runs/v3/EnabledStatus";
import { useEnvironment } from "~/hooks/useEnvironment";
import { useOrganization } from "~/hooks/useOrganizations";
import { useProject } from "~/hooks/useProject";
import {
  redirectWithErrorMessage,
  redirectWithSuccessMessage,
} from "~/models/message.server";
import { findProjectBySlug } from "~/models/project.server";
import { findEnvironmentBySlug } from "~/models/runtimeEnvironment.server";
import { EventDetailPresenter } from "~/presenters/v3/EventDetailPresenter.server";
import { clickhouseClient } from "~/services/clickhouseInstance.server";
import { requireUserId } from "~/services/session.server";
import { ServiceValidationError } from "~/v3/services/baseService.server";
import { writeEventLog } from "~/v3/services/events/eventLogWriter.server";
import { ReplayEventsService } from "~/v3/services/events/replayEvents.server";
import { v3EventParams, v3EventsPath, v3RunPath } from "~/utils/pathBuilder";

export const meta: MetaFunction = () => {
  return [{ title: `Event Detail | Trigger.dev` }];
};

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const userId = await requireUserId(request);
  const { projectParam, organizationSlug, envParam, eventParam } =
    v3EventParams.parse(params);

  const project = await findProjectBySlug(organizationSlug, projectParam, userId);
  if (!project) {
    return redirectWithErrorMessage("/", request, "Project not found");
  }

  const environment = await findEnvironmentBySlug(project.id, envParam, userId);
  if (!environment) {
    return redirectWithErrorMessage("/", request, "Environment not found");
  }

  const url = new URL(request.url);
  const statsPeriod = url.searchParams.get("period") ?? "24h";

  const presenter = new EventDetailPresenter();
  const data = await presenter.call({
    projectId: project.id,
    environmentId: environment.id,
    eventSlug: decodeURIComponent(eventParam),
    statsPeriod,
  });

  if (!data) {
    return redirectWithErrorMessage(
      v3EventsPath({ slug: organizationSlug }, { slug: projectParam }, { slug: envParam }),
      request,
      "Event not found"
    );
  }

  return typedjson(data);
};

import { json } from "@remix-run/server-runtime";
import { PublishEventService } from "~/v3/services/events/publishEvent.server";

const ActionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("replay"), from: z.string(), to: z.string() }),
  z.object({ action: z.literal("replay-single"), payload: z.string() }),
]);

export const action = async ({ request, params }: ActionFunctionArgs) => {
  const userId = await requireUserId(request);
  const { projectParam, organizationSlug, envParam, eventParam } =
    v3EventParams.parse(params);

  const project = await findProjectBySlug(organizationSlug, projectParam, userId);
  if (!project) {
    return redirectWithErrorMessage("/", request, "Project not found");
  }

  const environment = await findEnvironmentBySlug(project.id, envParam, userId);
  if (!environment) {
    return redirectWithErrorMessage("/", request, "Environment not found");
  }

  const formData = await request.formData();
  const parsed = ActionSchema.safeParse(Object.fromEntries(formData));

  if (!parsed.success) {
    return redirectWithErrorMessage(request.url, request, "Invalid parameters");
  }

  const eventSlug = decodeURIComponent(eventParam);

  try {
    if (parsed.data.action === "replay") {
      const service = new ReplayEventsService(
        clickhouseClient,
        undefined,
        undefined,
        writeEventLog
      );

      const result = await service.call({
        eventSlug,
        environment,
        from: new Date(parsed.data.from),
        to: new Date(parsed.data.to),
      });

      return redirectWithSuccessMessage(
        request.url,
        request,
        `Replayed ${result.replayedCount} events (${result.skippedCount} skipped)`
      );
    }

    if (parsed.data.action === "replay-single") {
      const payload = JSON.parse(parsed.data.payload);
      const service = new PublishEventService(undefined, undefined, writeEventLog);
      const result = await service.call(eventSlug, environment, payload);

      return json({
        success: true,
        eventId: result.eventId,
        runs: result.runs.length,
      });
    }
  } catch (error) {
    const message =
      error instanceof ServiceValidationError
        ? error.message
        : "Failed to replay event";
    if (parsed.data.action === "replay") {
      return redirectWithErrorMessage(request.url, request, message);
    }
    return json({ success: false, error: message }, { status: 422 });
  }
};

const chartConfig = {
  eventCount: {
    label: "Events Published",
    color: "#7655fd",
  },
  totalFanOut: {
    label: "Fan-out Deliveries",
    color: "#3b82f6",
  },
} satisfies ChartConfig;

const periods = ["1h", "6h", "24h", "7d", "30d"] as const;

export default function Page() {
  const { event, subscribers, stats, recentHistory } =
    useTypedLoaderData<typeof loader>();
  const organization = useOrganization();
  const project = useProject();
  const environment = useEnvironment();
  const [searchParams, setSearchParams] = useSearchParams();
  const navigation = useNavigation();

  const currentPeriod = searchParams.get("period") ?? "24h";
  const isSubmitting = navigation.state === "submitting";

  return (
    <PageContainer>
      <NavBar>
        <PageTitle title={event.slug} />
        <PageAccessories>
          <LinkButton
            to={v3EventsPath(organization, project, environment)}
            variant="minimal/small"
            LeadingIcon={ArrowLeftIcon}
          >
            All Events
          </LinkButton>
        </PageAccessories>
      </NavBar>
      <PageBody scrollable>
        <div className="flex flex-col gap-6">
          {/* Metadata */}
          <Property.Table>
            <Property.Item>
              <Property.Label>Slug</Property.Label>
              <Property.Value>{event.slug}</Property.Value>
            </Property.Item>
            <Property.Item>
              <Property.Label>Version</Property.Label>
              <Property.Value>{event.version}</Property.Value>
            </Property.Item>
            {event.description && (
              <Property.Item>
                <Property.Label>Description</Property.Label>
                <Property.Value>{event.description}</Property.Value>
              </Property.Item>
            )}
            {event.rateLimit && (
              <Property.Item>
                <Property.Label>Rate Limit</Property.Label>
                <Property.Value>
                  {(event.rateLimit as any).limit}/{(event.rateLimit as any).window}
                </Property.Value>
              </Property.Item>
            )}
            {event.dlqConfig && (
              <Property.Item>
                <Property.Label>DLQ Config</Property.Label>
                <Property.Value>
                  {JSON.stringify(event.dlqConfig)}
                </Property.Value>
              </Property.Item>
            )}
            <Property.Item>
              <Property.Label>Status</Property.Label>
              <Property.Value>
                {event.deprecatedAt ? (
                  <div className="flex items-center gap-2">
                    <Badge variant="extra-small" className="text-warning">
                      Deprecated
                    </Badge>
                    {event.deprecatedMessage && (
                      <span className="text-xs text-text-dimmed">
                        {event.deprecatedMessage}
                      </span>
                    )}
                  </div>
                ) : (
                  <EnabledStatus enabled={true} />
                )}
              </Property.Value>
            </Property.Item>
            <Property.Item>
              <Property.Label>Created</Property.Label>
              <Property.Value>
                <DateTime date={event.createdAt} />
              </Property.Value>
            </Property.Item>
          </Property.Table>

          {/* Schema */}
          {event.schema && (
            <div>
              <Header3 spacing>Schema</Header3>
              <CodeBlock
                code={JSON.stringify(event.schema, null, 2)}
                language="json"
                showCopyButton
              />
            </div>
          )}

          {/* Stats Chart */}
          <div>
            <div className="flex items-center justify-between">
              <Header3 spacing>Event Activity</Header3>
              <div className="flex gap-1">
                {periods.map((p) => (
                  <Button
                    key={p}
                    variant={currentPeriod === p ? "tertiary/small" : "minimal/small"}
                    onClick={() => {
                      const params = new URLSearchParams(searchParams);
                      params.set("period", p);
                      setSearchParams(params);
                    }}
                  >
                    {p}
                  </Button>
                ))}
              </div>
            </div>
            {stats.buckets.length > 0 ? (
              <Chart.Root
                config={chartConfig}
                data={stats.buckets}
                dataKey="timestamp"
                showLegend={false}
                enableZoom={false}
                minHeight="250px"
              >
                <Chart.Bar stackId="a" />
              </Chart.Root>
            ) : (
              <Paragraph variant="small" className="text-text-dimmed">
                No event activity in the selected period.
              </Paragraph>
            )}
            <div className="mt-2 flex gap-4 text-xs text-text-dimmed">
              <span>Total events: {stats.totals.eventCount.toLocaleString()}</span>
              <span>Total fan-out: {stats.totals.totalFanOut.toLocaleString()}</span>
            </div>
          </div>

          {/* Subscribers */}
          <div>
            <Header3 spacing>Subscribers ({subscribers.length})</Header3>
            {subscribers.length === 0 ? (
              <Paragraph variant="small" className="text-text-dimmed">
                No tasks are subscribed to this event.
              </Paragraph>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHeaderCell>Task</TableHeaderCell>
                    <TableHeaderCell>Filter</TableHeaderCell>
                    <TableHeaderCell>Pattern</TableHeaderCell>
                    <TableHeaderCell>Consumer Group</TableHeaderCell>
                    <TableHeaderCell>Rate Limit</TableHeaderCell>
                    <TableHeaderCell>Enabled</TableHeaderCell>
                    <TableHeaderCell>Priority</TableHeaderCell>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {subscribers.map((sub) => (
                    <TableRow key={sub.id}>
                      <TableCell>{sub.taskSlug}</TableCell>
                      <TableCell>
                        {sub.filter ? (
                          <span
                            className="max-w-[200px] truncate"
                            title={JSON.stringify(sub.filter)}
                          >
                            {JSON.stringify(sub.filter)}
                          </span>
                        ) : (
                          "–"
                        )}
                      </TableCell>
                      <TableCell>{sub.pattern ?? "–"}</TableCell>
                      <TableCell>{sub.consumerGroup ?? "–"}</TableCell>
                      <TableCell>
                        {sub.rateLimit
                          ? `${(sub.rateLimit as any).limit}/${(sub.rateLimit as any).window}`
                          : "–"}
                      </TableCell>
                      <TableCell>
                        <EnabledStatus enabled={sub.enabled} />
                      </TableCell>
                      <TableCell>{sub.priority}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </div>

          {/* Recent History */}
          <div>
            <Header3 spacing>Recent Events</Header3>
            {recentHistory.length === 0 ? (
              <Paragraph variant="small" className="text-text-dimmed">
                No recent events recorded.
              </Paragraph>
            ) : (
              <div className="flex flex-col gap-2">
                {recentHistory.map((entry) => (
                  <RecentEventRow key={entry.eventId} entry={entry} eventSlug={event.slug} />
                ))}
              </div>
            )}
          </div>

          {/* Replay Dialog */}
          <div>
            <Dialog>
              <DialogTrigger asChild>
                <Button variant="secondary/small">Replay Events</Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>Replay Events</DialogHeader>
                <DialogDescription>
                  Re-publish historical events for "{event.slug}" in the
                  specified time range.
                </DialogDescription>
                <Form method="post">
                  <input type="hidden" name="action" value="replay" />
                  <div className="flex flex-col gap-3">
                    <label className="flex flex-col gap-1">
                      <span className="text-xs text-text-dimmed">From</span>
                      <Input
                        type="datetime-local"
                        name="from"
                        required
                      />
                    </label>
                    <label className="flex flex-col gap-1">
                      <span className="text-xs text-text-dimmed">To</span>
                      <Input
                        type="datetime-local"
                        name="to"
                        required
                      />
                    </label>
                  </div>
                  <DialogFooter className="mt-4">
                    <Button
                      type="submit"
                      variant="primary/small"
                      disabled={isSubmitting}
                    >
                      {isSubmitting ? "Replaying..." : "Replay"}
                    </Button>
                  </DialogFooter>
                </Form>
              </DialogContent>
            </Dialog>
          </div>
        </div>
      </PageBody>
    </PageContainer>
  );
}

function RecentEventRow({
  entry,
  eventSlug,
}: {
  entry: {
    eventId: string;
    publishedAt: string;
    fanOutCount: number;
    payload: unknown;
    tags?: string[];
    publisherRunId?: string;
  };
  eventSlug: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const fetcher = useFetcher();
  const isReplaying = fetcher.state !== "idle";
  const replayResult = fetcher.data as
    | { success: true; eventId: string; runs: number }
    | { success: false; error: string }
    | undefined;

  return (
    <div className="rounded border border-charcoal-700 bg-charcoal-850">
      <div
        className="flex cursor-pointer items-center gap-4 px-3 py-2 text-xs hover:bg-charcoal-800"
        onClick={() => setExpanded(!expanded)}
      >
        <span className="w-5 text-text-dimmed">{expanded ? "▼" : "▶"}</span>
        <span className="w-48 truncate font-mono text-text-dimmed">
          {entry.eventId}
        </span>
        <span className="w-44">
          <DateTime date={new Date(entry.publishedAt)} />
        </span>
        <span className="w-16 text-text-dimmed">
          {entry.fanOutCount} fan-out
        </span>
        {entry.tags && entry.tags.length > 0 && (
          <div className="flex gap-1">
            {entry.tags.map((tag) => (
              <Badge key={tag} variant="extra-small">
                {tag}
              </Badge>
            ))}
          </div>
        )}
        <div className="ml-auto flex items-center gap-2">
          {replayResult?.success && (
            <span className="text-success">Replayed</span>
          )}
          <Button
            variant="minimal/small"
            disabled={isReplaying}
            onClick={(e) => {
              e.stopPropagation();
              fetcher.submit(
                {
                  action: "replay-single",
                  payload: JSON.stringify(entry.payload),
                },
                { method: "post" }
              );
            }}
          >
            {isReplaying ? "Replaying..." : "Replay"}
          </Button>
        </div>
      </div>
      {expanded && (
        <div className="border-t border-charcoal-700 px-3 py-2">
          <div className="mb-1 text-xs font-medium text-text-dimmed">Payload</div>
          <CodeBlock
            code={JSON.stringify(entry.payload, null, 2)}
            language="json"
            showCopyButton
          />
          {entry.publisherRunId && (
            <div className="mt-2 text-xs text-text-dimmed">
              Publisher Run: <span className="font-mono">{entry.publisherRunId}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
