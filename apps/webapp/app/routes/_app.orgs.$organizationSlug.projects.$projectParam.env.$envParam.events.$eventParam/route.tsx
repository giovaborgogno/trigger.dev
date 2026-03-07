import { ArrowPathIcon } from "@heroicons/react/20/solid";
import {
  type ActionFunctionArgs,
  type LoaderFunctionArgs,
  json,
} from "@remix-run/server-runtime";
import { type MetaFunction, Form, useSearchParams, useNavigation, useFetcher } from "@remix-run/react";
import { useState } from "react";
import { typedjson, useTypedLoaderData } from "remix-typedjson";
import { z } from "zod";
import type { ChartConfig } from "~/components/primitives/charts/Chart";
import { Chart } from "~/components/primitives/charts/ChartCompound";
import { CodeBlock } from "~/components/code/CodeBlock";
import { PageBody, PageContainer } from "~/components/layout/AppLayout";
import { Badge } from "~/components/primitives/Badge";
import { Button } from "~/components/primitives/Buttons";
import { Callout } from "~/components/primitives/Callout";
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
import { Input } from "~/components/primitives/Input";
import { NavBar, PageTitle } from "~/components/primitives/PageHeader";
import { Paragraph } from "~/components/primitives/Paragraph";
import { PopoverMenuItem } from "~/components/primitives/Popover";
import * as Property from "~/components/primitives/PropertyTable";
import {
  Table,
  TableBlankRow,
  TableBody,
  TableCell,
  TableCellMenu,
  TableHeader,
  TableHeaderCell,
  TableRow,
} from "~/components/primitives/Table";
import { TextLink } from "~/components/primitives/TextLink";
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
import { PublishEventService } from "~/v3/services/events/publishEvent.server";
import { v3EventParams, v3EventsPath, v3RunPath } from "~/utils/pathBuilder";

function formatRateLimit(rl: unknown): string {
  if (!rl || typeof rl !== "object") return "–";
  const obj = rl as Record<string, unknown>;
  if (typeof obj.limit === "number" && typeof obj.window === "string") {
    return `${obj.limit}/${obj.window}`;
  }
  return "–";
}

export const meta: MetaFunction<typeof loader> = ({ data, params }) => {
  const eventSlug = params.eventParam ? decodeURIComponent(params.eventParam) : undefined;
  const title = eventSlug
    ? `${eventSlug} | Events | Trigger.dev`
    : `Event Detail | Trigger.dev`;
  return [{ title }];
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
        <PageTitle
          title={event.slug}
          backButton={{
            to: v3EventsPath(organization, project, environment),
            text: "Events",
          }}
        />
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
                  {formatRateLimit(event.rateLimit)}
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
                maxLines={20}
                showLineNumbers
              />
            </div>
          )}

          {/* Stats Chart */}
          <div>
            <div className="flex items-center justify-between">
              <Header3 spacing>Event Activity</Header3>
              <div className="flex gap-0.5 rounded bg-charcoal-750 p-0.5">
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
              <Callout variant="info">
                No event activity in the selected period.
              </Callout>
            )}
            <div className="mt-2 flex gap-2">
              <Badge variant="extra-small">
                {stats.totals.eventCount.toLocaleString()} events
              </Badge>
              <Badge variant="extra-small">
                {stats.totals.totalFanOut.toLocaleString()} fan-out
              </Badge>
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
                        {formatRateLimit(sub.rateLimit)}
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
              <RecentEventsTable
                entries={recentHistory}
                organization={organization}
                project={project}
                environment={environment}
              />
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

type RecentEntry = {
  eventId: string;
  publishedAt: string;
  fanOutCount: number;
  payload: unknown;
  tags?: string[];
  publisherRunId?: string;
};

function RecentEventsTable({
  entries,
  organization,
  project,
  environment,
}: {
  entries: RecentEntry[];
  organization: { slug: string };
  project: { slug: string };
  environment: { slug: string };
}) {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  return (
    <Table variant="bright">
      <TableHeader>
        <TableRow>
          <TableHeaderCell>Event ID</TableHeaderCell>
          <TableHeaderCell>Published</TableHeaderCell>
          <TableHeaderCell>Fan-out</TableHeaderCell>
          <TableHeaderCell>Tags</TableHeaderCell>
          <TableHeaderCell>Publisher Run</TableHeaderCell>
          <TableHeaderCell alignment="right">Actions</TableHeaderCell>
        </TableRow>
      </TableHeader>
      <TableBody>
        {entries.map((entry) => (
          <RecentEventTableRow
            key={entry.eventId}
            entry={entry}
            isExpanded={expandedId === entry.eventId}
            onToggle={() =>
              setExpandedId(expandedId === entry.eventId ? null : entry.eventId)
            }
            organization={organization}
            project={project}
            environment={environment}
          />
        ))}
      </TableBody>
    </Table>
  );
}

function RecentEventTableRow({
  entry,
  isExpanded,
  onToggle,
  organization,
  project,
  environment,
}: {
  entry: RecentEntry;
  isExpanded: boolean;
  onToggle: () => void;
  organization: { slug: string };
  project: { slug: string };
  environment: { slug: string };
}) {
  const fetcher = useFetcher();
  const isReplaying = fetcher.state !== "idle";

  return (
    <>
      <TableRow>
        <TableCell onClick={onToggle} className="cursor-pointer">
          <span className="font-mono text-text-dimmed">
            {isExpanded ? "▼ " : "▶ "}
            {entry.eventId}
          </span>
        </TableCell>
        <TableCell>
          <DateTime date={new Date(entry.publishedAt)} />
        </TableCell>
        <TableCell>{entry.fanOutCount}</TableCell>
        <TableCell>
          {entry.tags && entry.tags.length > 0 ? (
            <div className="flex gap-1">
              {entry.tags.map((tag) => (
                <Badge key={tag} variant="extra-small">
                  {tag}
                </Badge>
              ))}
            </div>
          ) : (
            "–"
          )}
        </TableCell>
        <TableCell>
          {entry.publisherRunId ? (
            <TextLink
              to={v3RunPath(organization, project, environment, {
                friendlyId: entry.publisherRunId,
              })}
              className="text-xs"
            >
              {entry.publisherRunId}
            </TextLink>
          ) : (
            "–"
          )}
        </TableCell>
        <TableCellMenu
          popoverContent={
            <PopoverMenuItem
              icon={ArrowPathIcon}
              title={isReplaying ? "Replaying..." : "Replay"}
              disabled={isReplaying}
              onClick={() => {
                fetcher.submit(
                  {
                    action: "replay-single",
                    payload: JSON.stringify(entry.payload),
                  },
                  { method: "post" }
                );
              }}
            />
          }
        />
      </TableRow>
      {isExpanded && (
        <TableRow>
          <TableCell colSpan={6}>
            <div className="py-2">
              <div className="mb-1 text-xs font-medium text-text-dimmed">
                Payload
              </div>
              <CodeBlock
                code={JSON.stringify(entry.payload, null, 2)}
                language="json"
                showCopyButton
              />
            </div>
          </TableCell>
        </TableRow>
      )}
    </>
  );
}
