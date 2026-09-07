import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const flagSchema = z.object({
  id: z.string().uuid(),
  promise_recorded: z.boolean().optional(),
  notified_ar: z.boolean().optional(),
});

export const setMessageFlags = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => flagSchema.parse(data))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const patch: { promise_recorded?: boolean; notified_ar?: boolean } = {};
    if (typeof data.promise_recorded === "boolean") patch.promise_recorded = data.promise_recorded;
    if (typeof data.notified_ar === "boolean") patch.notified_ar = data.notified_ar;
    if (Object.keys(patch).length === 0) return { ok: true };

    const { error } = await supabaseAdmin.from("messages").update(patch).eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
