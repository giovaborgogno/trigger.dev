import { json } from "@remix-run/server-runtime";
import { type ActionFunctionArgs } from "@remix-run/server-runtime";
import { z } from "zod";
import { findProjectBySlug } from "~/models/project.server";
import { findEnvironmentBySlug } from "~/models/runtimeEnvironment.server";
import { requireUserId } from "~/services/session.server";
import { EnvironmentParamSchema } from "~/utils/pathBuilder";
import { ServiceValidationError } from "~/v3/services/baseService.server";
import { DeadLetterManagementService } from "~/v3/services/events/deadLetterManagement.server";

const ActionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("retry"), id: z.string() }),
  z.object({ action: z.literal("discard"), id: z.string() }),
  z.object({ action: z.literal("retry-all"), eventType: z.string().optional() }),
]);

export async function action({ request, params }: ActionFunctionArgs) {
  const userId = await requireUserId(request);
  const { organizationSlug, projectParam, envParam } = EnvironmentParamSchema.parse(params);

  const project = await findProjectBySlug(organizationSlug, projectParam, userId);
  if (!project) {
    throw new Response("Not Found", { status: 404 });
  }

  const environment = await findEnvironmentBySlug(project.id, envParam, userId);
  if (!environment) {
    throw new Response("Not Found", { status: 404 });
  }

  const formData = await request.formData();
  const parsed = ActionSchema.safeParse(Object.fromEntries(formData));

  if (!parsed.success) {
    return json({ success: false, error: "Invalid action" }, { status: 400 });
  }

  const service = new DeadLetterManagementService();

  try {
    switch (parsed.data.action) {
      case "retry": {
        const result = await service.retry(parsed.data.id, environment);
        return json({ success: true, ...result });
      }
      case "discard": {
        const result = await service.discard(parsed.data.id, environment);
        return json({ success: true, ...result });
      }
      case "retry-all": {
        const result = await service.retryAll({
          projectId: project.id,
          environmentId: environment.id,
          eventType: parsed.data.eventType || undefined,
          environment,
        });
        return json({ success: true, ...result });
      }
    }
  } catch (error) {
    if (error instanceof ServiceValidationError) {
      return json(
        { success: false, error: error.message },
        { status: error.status ?? 422 }
      );
    }
    return json({ success: false, error: "Something went wrong" }, { status: 500 });
  }
}
