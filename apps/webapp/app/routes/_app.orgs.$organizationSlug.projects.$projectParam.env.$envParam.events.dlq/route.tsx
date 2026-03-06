import { BoltIcon } from "@heroicons/react/20/solid";
import { type MetaFunction, useFetcher, useSearchParams } from "@remix-run/react";
import { type LoaderFunctionArgs } from "@remix-run/server-runtime";
import { typedjson, useTypedLoaderData } from "remix-typedjson";
import { z } from "zod";
import { InlineCode } from "~/components/code/InlineCode";
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
import { InfoPanel } from "~/components/primitives/InfoPanel";
import { NavBar, PageAccessories, PageTitle } from "~/components/primitives/PageHeader";
import { Paragraph } from "~/components/primitives/Paragraph";
import {
  Table,
  TableBlankRow,
  TableBody,
  TableCell,
  TableHeader,
  TableHeaderCell,
  TableRow,
} from "~/components/primitives/Table";
import { SimpleTooltip } from "~/components/primitives/Tooltip";
import { useEnvironment } from "~/hooks/useEnvironment";
import { useOrganization } from "~/hooks/useOrganizations";
import { useProject } from "~/hooks/useProject";
import { redirectWithErrorMessage } from "~/models/message.server";
import { findProjectBySlug } from "~/models/project.server";
import { findEnvironmentBySlug } from "~/models/runtimeEnvironment.server";
import { DeadLetterListPresenter } from "~/presenters/v3/DeadLetterListPresenter.server";
import { requireUserId } from "~/services/session.server";
import {
  EnvironmentParamSchema,
  v3EventsDlqPath,
  v3EventsPath,
} from "~/utils/pathBuilder";

export const meta: MetaFunction = () => {
  return [{ title: `Dead Letter Queue | Trigger.dev` }];
};

const SearchFilters = z.object({
  status: z.enum(["PENDING", "RETRIED", "DISCARDED"]).optional(),
  eventType: z.string().optional(),
  cursor: z.string().optional(),
});

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const userId = await requireUserId(request);
  const { projectParam, organizationSlug, envParam } = EnvironmentParamSchema.parse(params);

  const project = await findProjectBySlug(organizationSlug, projectParam, userId);
  if (!project) {
    return redirectWithErrorMessage("/", request, "Project not found");
  }

  const environment = await findEnvironmentBySlug(project.id, envParam, userId);
  if (!environment) {
    return redirectWithErrorMessage("/", request, "Environment not found");
  }

  const url = new URL(request.url);
  const filters = SearchFilters.parse(Object.fromEntries(url.searchParams.entries()));

  const presenter = new DeadLetterListPresenter();
  const data = await presenter.call({
    projectId: project.id,
    environmentId: environment.id,
    ...filters,
  });

  return typedjson(data);
};

function DeadLetterStatusBadge({
  status,
}: {
  status: "PENDING" | "RETRIED" | "DISCARDED";
}) {
  const config = {
    PENDING: { label: "Pending", className: "text-warning" },
    RETRIED: { label: "Retried", className: "text-success" },
    DISCARDED: { label: "Discarded", className: "text-text-dimmed" },
  }[status];

  return (
    <Badge variant="extra-small" className={config.className}>
      {config.label}
    </Badge>
  );
}

function truncateError(error: unknown): string {
  if (!error) return "–";
  const str = typeof error === "string" ? error : JSON.stringify(error);
  return str.length > 80 ? str.slice(0, 80) + "..." : str;
}

export default function Page() {
  const { items, nextCursor, hasMore, pendingCount, eventTypes, hasFilters } =
    useTypedLoaderData<typeof loader>();
  const organization = useOrganization();
  const project = useProject();
  const environment = useEnvironment();
  const [searchParams, setSearchParams] = useSearchParams();
  const fetcher = useFetcher();

  const resourcePath = `/resources/orgs/${organization.slug}/projects/${project.slug}/env/${environment.slug}/events/dlq`;

  const currentStatus = searchParams.get("status") ?? "";
  const currentEventType = searchParams.get("eventType") ?? "";

  return (
    <PageContainer>
      <NavBar>
        <PageTitle title="Dead Letter Queue" />
        <PageAccessories>
          <div className="flex items-center gap-2">
            <LinkButton
              to={v3EventsPath(organization, project, environment)}
              variant="minimal/small"
            >
              Events
            </LinkButton>
            <LinkButton
              to={v3EventsDlqPath(organization, project, environment)}
              variant="tertiary/small"
            >
              Dead Letter Queue
            </LinkButton>
          </div>
        </PageAccessories>
      </NavBar>
      <PageBody>
        {items.length === 0 && !hasFilters ? (
          <MainCenteredContainer>
            <InfoPanel
              title="Dead letter queue is empty"
              icon={BoltIcon}
              iconClassName="text-success"
              panelClassName="max-w-full"
            >
              <Paragraph spacing variant="small">
                Events that fail to deliver to subscribers will appear here.
              </Paragraph>
            </InfoPanel>
          </MainCenteredContainer>
        ) : (
          <div className="flex flex-col gap-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <select
                  className="rounded border border-charcoal-700 bg-charcoal-800 px-2 py-1 text-xs text-text-bright"
                  value={currentStatus}
                  onChange={(e) => {
                    const params = new URLSearchParams(searchParams);
                    if (e.target.value) {
                      params.set("status", e.target.value);
                    } else {
                      params.delete("status");
                    }
                    params.delete("cursor");
                    setSearchParams(params);
                  }}
                >
                  <option value="">All statuses</option>
                  <option value="PENDING">Pending</option>
                  <option value="RETRIED">Retried</option>
                  <option value="DISCARDED">Discarded</option>
                </select>
                {eventTypes.length > 0 && (
                  <select
                    className="rounded border border-charcoal-700 bg-charcoal-800 px-2 py-1 text-xs text-text-bright"
                    value={currentEventType}
                    onChange={(e) => {
                      const params = new URLSearchParams(searchParams);
                      if (e.target.value) {
                        params.set("eventType", e.target.value);
                      } else {
                        params.delete("eventType");
                      }
                      params.delete("cursor");
                      setSearchParams(params);
                    }}
                  >
                    <option value="">All event types</option>
                    {eventTypes.map((et) => (
                      <option key={et} value={et}>
                        {et}
                      </option>
                    ))}
                  </select>
                )}
              </div>
              {pendingCount > 0 && (
                <Dialog>
                  <DialogTrigger asChild>
                    <Button variant="secondary/small">
                      Retry All Pending
                      <Badge variant="extra-small" className="ml-1.5">
                        {pendingCount}
                      </Badge>
                    </Button>
                  </DialogTrigger>
                  <DialogContent>
                    <DialogHeader>Retry All Pending</DialogHeader>
                    <DialogDescription>
                      This will re-trigger {pendingCount} pending dead letter
                      event{pendingCount !== 1 ? "s" : ""}. Are you sure?
                    </DialogDescription>
                    <DialogFooter>
                      <Button
                        variant="primary/small"
                        disabled={fetcher.state !== "idle"}
                        onClick={() => {
                          fetcher.submit(
                            {
                              action: "retry-all",
                              ...(currentEventType && {
                                eventType: currentEventType,
                              }),
                            },
                            { method: "post", action: resourcePath }
                          );
                        }}
                      >
                        {fetcher.state !== "idle"
                          ? "Retrying..."
                          : "Retry All"}
                      </Button>
                    </DialogFooter>
                  </DialogContent>
                </Dialog>
              )}
            </div>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHeaderCell>ID</TableHeaderCell>
                  <TableHeaderCell>Event Type</TableHeaderCell>
                  <TableHeaderCell>Task</TableHeaderCell>
                  <TableHeaderCell>Status</TableHeaderCell>
                  <TableHeaderCell>Attempts</TableHeaderCell>
                  <TableHeaderCell>Error</TableHeaderCell>
                  <TableHeaderCell>Created</TableHeaderCell>
                  <TableHeaderCell>Actions</TableHeaderCell>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.length === 0 ? (
                  <TableBlankRow colSpan={8}>
                    No dead letter events match your filters
                  </TableBlankRow>
                ) : (
                  items.map((item) => (
                    <TableRow key={item.id}>
                      <TableCell>
                        <span className="font-mono text-xs">
                          {item.friendlyId}
                        </span>
                      </TableCell>
                      <TableCell>
                        <InlineCode>{item.eventType}</InlineCode>
                      </TableCell>
                      <TableCell>{item.taskSlug}</TableCell>
                      <TableCell>
                        <DeadLetterStatusBadge status={item.status} />
                      </TableCell>
                      <TableCell>{item.attemptCount}</TableCell>
                      <TableCell>
                        {item.error ? (
                          <SimpleTooltip
                            button={
                              <span className="max-w-[200px] truncate text-xs">
                                {truncateError(item.error)}
                              </span>
                            }
                            content={
                              <pre className="max-w-md whitespace-pre-wrap text-xs">
                                {typeof item.error === "string"
                                  ? item.error
                                  : JSON.stringify(item.error, null, 2)}
                              </pre>
                            }
                          />
                        ) : (
                          "–"
                        )}
                      </TableCell>
                      <TableCell>
                        <DateTime date={item.createdAt} />
                      </TableCell>
                      <TableCell>
                        {item.status === "PENDING" && (
                          <div className="flex gap-1">
                            <Button
                              variant="minimal/small"
                              disabled={fetcher.state !== "idle"}
                              onClick={() => {
                                fetcher.submit(
                                  { action: "retry", id: item.id },
                                  { method: "post", action: resourcePath }
                                );
                              }}
                            >
                              Retry
                            </Button>
                            <Button
                              variant="minimal/small"
                              disabled={fetcher.state !== "idle"}
                              onClick={() => {
                                fetcher.submit(
                                  { action: "discard", id: item.id },
                                  { method: "post", action: resourcePath }
                                );
                              }}
                            >
                              Discard
                            </Button>
                          </div>
                        )}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
            {hasMore && nextCursor && (
              <div className="flex justify-center">
                <Button
                  variant="tertiary/small"
                  onClick={() => {
                    const params = new URLSearchParams(searchParams);
                    params.set("cursor", nextCursor);
                    setSearchParams(params);
                  }}
                >
                  Load more
                </Button>
              </div>
            )}
          </div>
        )}
      </PageBody>
    </PageContainer>
  );
}
