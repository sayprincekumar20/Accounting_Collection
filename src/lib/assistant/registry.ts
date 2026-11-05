// AI assistant: central ACTION REGISTRY. Every capability of the assistant is one registered action with
// an id, a description (shown to the model), a zod parameter schema (validated before execution), a kind
// (read = data only, write = changes data / contacts clients, ui = navigation in the dashboard), a
// permission level (for future roles; one shared login today), a confirmation flag (write actions run
// only after the user confirms in the chat) and an execute function. Every execution is audit-logged.
import { z } from "zod";
import { insertDataTableRows } from "@/lib/n8n-datatable";

export type ActionKind = "read" | "write" | "ui";
export type Permission = "viewer" | "ar" | "admin";

export interface ActionContext {
  userName: string;
  sessionId: string;
  page: string;
  /** Client ids of the current working set (result of the previous search), for follow-up questions. */
  workingSet: string[];
}

export interface ActionResult {
  /** Compact data for the model (keep it small). */
  data: unknown;
  /** Optional new working set (client ids) for follow-up questions. */
  workingSet?: { ids: string[]; label: string };
  /** Optional UI operation for the dashboard (navigate / refresh). */
  ui?: {
    op: "navigate" | "refresh";
    to?: string | undefined;
    search?: Record<string, string> | undefined;
  };
  /** One line for the audit log. */
  summary: string;
}

export interface ActionDef<S extends z.ZodTypeAny = z.ZodTypeAny> {
  id: string;
  description: string;
  kind: ActionKind;
  permission: Permission;
  needsConfirmation: boolean;
  params: S;
  execute: (args: z.infer<S>, ctx: ActionContext) => Promise<ActionResult>;
}

const registry = new Map<string, ActionDef>();

export function registerAction<S extends z.ZodTypeAny>(def: ActionDef<S>): void {
  if (registry.has(def.id)) throw new Error(`Action ${def.id} registered twice`);
  registry.set(def.id, def as unknown as ActionDef);
}

export function getAction(id: string): ActionDef | undefined {
  return registry.get(id);
}

export function listActions(): ActionDef[] {
  return [...registry.values()];
}

/** JSON schema of a zod object (subset sufficient for the model's tool definitions). */
export function toJsonSchema(schema: z.ZodTypeAny): Record<string, unknown> {
  const t = schema._def.typeName as string;
  const desc = schema.description ? { description: schema.description } : {};
  if (t === "ZodOptional" || t === "ZodNullable" || t === "ZodDefault")
    return { ...toJsonSchema(schema._def.innerType), ...desc };
  if (t === "ZodObject") {
    const shape = (schema as z.ZodObject<z.ZodRawShape>).shape;
    const properties: Record<string, unknown> = {};
    const required: string[] = [];
    for (const [k, v] of Object.entries(shape)) {
      properties[k] = toJsonSchema(v as z.ZodTypeAny);
      const tn = (v as z.ZodTypeAny)._def.typeName;
      if (tn !== "ZodOptional" && tn !== "ZodDefault") required.push(k);
    }
    return { type: "object", properties, required, additionalProperties: false, ...desc };
  }
  if (t === "ZodString") return { type: "string", ...desc };
  if (t === "ZodNumber") return { type: "number", ...desc };
  if (t === "ZodBoolean") return { type: "boolean", ...desc };
  if (t === "ZodEnum") return { type: "string", enum: schema._def.values, ...desc };
  if (t === "ZodArray") return { type: "array", items: toJsonSchema(schema._def.type), ...desc };
  return { ...desc };
}

/** Tool definitions for the model (OpenAI function-calling format). */
export function toolDefinitions(): {
  type: "function";
  function: { name: string; description: string; parameters: Record<string, unknown> };
}[] {
  return listActions().map((a) => ({
    type: "function" as const,
    function: {
      name: a.id,
      description:
        a.description +
        (a.needsConfirmation
          ? " (REQUIRES user confirmation; the dashboard asks the user before it runs.)"
          : ""),
      parameters: toJsonSchema(a.params),
    },
  }));
}

const AUDIT_TABLE = "n5ryqNbBAlp69rWV";

export async function audit(
  ctx: ActionContext,
  actionId: string,
  kind: string,
  args: unknown,
  status: string,
  summary: string,
): Promise<void> {
  try {
    await insertDataTableRows(AUDIT_TABLE, [
      {
        timestamp: new Date().toISOString(),
        user_name: ctx.userName.slice(0, 80),
        session_id: ctx.sessionId.slice(0, 80),
        page: ctx.page.slice(0, 200),
        action_id: actionId,
        kind,
        args: JSON.stringify(args ?? {}).slice(0, 2000),
        status,
        result_summary: summary.slice(0, 500),
      },
    ]);
  } catch (e) {
    console.error("[assistant] audit log failed:", e);
  }
}

/**
 * Validate and run one action. Write actions only run when `confirmed` is true (the user clicked
 * Confirm in the chat); otherwise a confirmation request is returned. Everything is audited.
 */
export async function runAction(
  id: string,
  rawArgs: unknown,
  ctx: ActionContext,
  confirmed = false,
): Promise<{
  ok: boolean;
  result?: ActionResult;
  error?: string;
  needsConfirmation?: { id: string; args: unknown; description: string };
}> {
  const def = registry.get(id);
  if (!def) return { ok: false, error: `Unknown action: ${id}` };
  const parsed = def.params.safeParse(rawArgs ?? {});
  if (!parsed.success) {
    const msg = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    await audit(ctx, id, def.kind, rawArgs, "INVALID", msg);
    return { ok: false, error: `Invalid arguments: ${msg}` };
  }
  if (def.needsConfirmation && !confirmed) {
    await audit(
      ctx,
      id,
      def.kind,
      parsed.data,
      "AWAITING_CONFIRMATION",
      def.description.slice(0, 200),
    );
    return {
      ok: false,
      needsConfirmation: { id, args: parsed.data, description: def.description },
    };
  }
  try {
    const result = await def.execute(parsed.data, ctx);
    await audit(ctx, id, def.kind, parsed.data, "OK", result.summary);
    return { ok: true, result };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await audit(ctx, id, def.kind, parsed.data, "ERROR", msg);
    return { ok: false, error: msg };
  }
}
