import { BoltIcon } from "@heroicons/react/20/solid";
import { BookOpenIcon, MagnifyingGlassIcon } from "@heroicons/react/24/solid";
import { type MetaFunction, useSearchParams } from "@remix-run/react";
import { type LoaderFunctionArgs } from "@remix-run/server-runtime";
import { typedjson, useTypedLoaderData } from "remix-typedjson";
import { z } from "zod";
import { MainCenteredContainer, PageBody, PageContainer } from "~/components/layout/AppLayout";
import { LinkButton } from "~/components/primitives/Buttons";
import { InlineCode } from "~/components/code/InlineCode";
import { DateTime } from "~/components/primitives/DateTime";
import { InfoPanel } from "~/components/primitives/InfoPanel";
import { Input } from "~/components/primitives/Input";
import { NavBar, PageAccessories, PageTitle } from "~/components/primitives/PageHeader";
import { PaginationControls } from "~/components/primitives/Pagination";
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
import { EnabledStatus } from "~/components/runs/v3/EnabledStatus";
import { useEnvironment } from "~/hooks/useEnvironment";
import { useOrganization } from "~/hooks/useOrganizations";
import { useProject } from "~/hooks/useProject";
import { redirectWithErrorMessage } from "~/models/message.server";
import { findProjectBySlug } from "~/models/project.server";
import { findEnvironmentBySlug } from "~/models/runtimeEnvironment.server";
import { EventListPresenter } from "~/presenters/v3/EventListPresenter.server";
import { requireUserId } from "~/services/session.server";
import {
  docsPath,
  EnvironmentParamSchema,
  v3EventPath,
  v3EventsDlqPath,
  v3EventsPath,
} from "~/utils/pathBuilder";

export const meta: MetaFunction = () => {
  return [{ title: `Events | Trigger.dev` }];
};

const SearchFilters = z.object({
  search: z.string().optional(),
  showDeprecated: z.coerce.boolean().optional(),
  page: z.coerce.number().min(1).default(1),
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

  const presenter = new EventListPresenter();
  const list = await presenter.call({
    projectId: project.id,
    environmentId: environment.id,
    ...filters,
  });

  return typedjson(list);
};

export default function Page() {
  const { events, currentPage, totalPages, totalCount, hasFilters } =
    useTypedLoaderData<typeof loader>();
  const organization = useOrganization();
  const project = useProject();
  const environment = useEnvironment();
  const [searchParams, setSearchParams] = useSearchParams();

  const search = searchParams.get("search") ?? "";

  return (
    <PageContainer>
      <NavBar>
        <PageTitle title="Events" />
        <PageAccessories>
          <div className="flex items-center gap-2">
            <LinkButton
              to={v3EventsPath(organization, project, environment)}
              variant={
                !searchParams.has("_dlq") ? "tertiary/small" : "minimal/small"
              }
            >
              Events
            </LinkButton>
            <LinkButton
              to={v3EventsDlqPath(organization, project, environment)}
              variant="minimal/small"
            >
              Dead Letter Queue
            </LinkButton>
          </div>
        </PageAccessories>
      </NavBar>
      <PageBody>
        {totalCount === 0 && !hasFilters ? (
          <MainCenteredContainer>
            <InfoPanel
              title="No events defined yet"
              icon={BoltIcon}
              iconClassName="text-amber-500"
              panelClassName="max-w-full"
              accessory={
                <LinkButton
                  to={docsPath("v3/events")}
                  variant="docs/small"
                  LeadingIcon={BookOpenIcon}
                >
                  Event system docs
                </LinkButton>
              }
            >
              <Paragraph spacing variant="small">
                Define events with <InlineCode>createEvent()</InlineCode> in your
                code and subscribe tasks using the <InlineCode>on</InlineCode>{" "}
                option.
              </Paragraph>
            </InfoPanel>
          </MainCenteredContainer>
        ) : (
          <div className="flex flex-col gap-4">
            <div className="flex items-center gap-3">
              <div className="relative w-64">
                <MagnifyingGlassIcon className="absolute left-2.5 top-2.5 h-4 w-4 text-text-dimmed" />
                <Input
                  placeholder="Search events..."
                  className="pl-9"
                  value={search}
                  onChange={(e) => {
                    const params = new URLSearchParams(searchParams);
                    if (e.target.value) {
                      params.set("search", e.target.value);
                    } else {
                      params.delete("search");
                    }
                    params.delete("page");
                    setSearchParams(params);
                  }}
                />
              </div>
              <label className="flex items-center gap-1.5 text-xs text-text-dimmed">
                <input
                  type="checkbox"
                  checked={searchParams.get("showDeprecated") === "true"}
                  onChange={(e) => {
                    const params = new URLSearchParams(searchParams);
                    if (e.target.checked) {
                      params.set("showDeprecated", "true");
                    } else {
                      params.delete("showDeprecated");
                    }
                    params.delete("page");
                    setSearchParams(params);
                  }}
                />
                Show deprecated
              </label>
            </div>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHeaderCell>Event</TableHeaderCell>
                  <TableHeaderCell>Version</TableHeaderCell>
                  <TableHeaderCell>Subscribers</TableHeaderCell>
                  <TableHeaderCell>24h Events</TableHeaderCell>
                  <TableHeaderCell>Rate Limit</TableHeaderCell>
                  <TableHeaderCell>Status</TableHeaderCell>
                </TableRow>
              </TableHeader>
              <TableBody>
                {events.length === 0 ? (
                  <TableBlankRow colSpan={6}>
                    No events match your filters
                  </TableBlankRow>
                ) : (
                  events.map((event) => {
                    const path = v3EventPath(organization, project, environment, {
                      slug: event.slug,
                    });
                    const cellClass = event.isDeprecated ? "opacity-50" : "";
                    return (
                      <TableRow key={event.id}>
                        <TableCell to={path} isTabbableCell className={cellClass}>
                          <InlineCode>{event.slug}</InlineCode>
                        </TableCell>
                        <TableCell to={path} className={cellClass}>
                          {event.version}
                        </TableCell>
                        <TableCell to={path} className={cellClass}>
                          {event.subscriberCount}
                        </TableCell>
                        <TableCell to={path} className={cellClass}>
                          {event.recentEventCount.toLocaleString()}
                        </TableCell>
                        <TableCell to={path} className={cellClass}>
                          {event.rateLimit
                            ? `${(event.rateLimit as any).limit}/${(event.rateLimit as any).window}`
                            : "–"}
                        </TableCell>
                        <TableCell to={path}>
                          <EnabledStatus enabled={!event.isDeprecated} />
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
            {totalPages > 1 && (
              <PaginationControls currentPage={currentPage} totalPages={totalPages} />
            )}
          </div>
        )}
      </PageBody>
    </PageContainer>
  );
}
