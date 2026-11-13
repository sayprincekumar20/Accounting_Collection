import { definePlugin } from "nitro";
import { cleanupExpiredReplyMedia } from "../src/lib/reply-media";

// Deletes expired reply attachments (Supabase storage) every 6 hours, as the Cloudflare cron trigger
// "0 */6 * * *" did before the move to a Node server. Runs inside the server process: first 1 minute after
// start, then every 6 hours. The timers do not keep the process alive on shutdown.
const SIX_HOURS = 6 * 60 * 60 * 1000;
const g = globalThis as unknown as { __replyMediaCleanup?: boolean };

async function run() {
  try {
    await cleanupExpiredReplyMedia(undefined);
  } catch (error) {
    console.error("[reply-media] scheduled cleanup failed:", error);
  }
}

export default definePlugin(() => {
  if (g.__replyMediaCleanup) return; // one schedule per process
  g.__replyMediaCleanup = true;
  setTimeout(() => void run(), 60_000).unref?.();
  setInterval(() => void run(), SIX_HOURS).unref?.();
});
