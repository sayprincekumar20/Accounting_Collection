import { definePlugin } from "nitro";
import { cleanupExpiredReplyMedia } from "../src/lib/reply-media";

export default definePlugin((nitroApp) => {
  nitroApp.hooks.hook("cloudflare:scheduled", async ({ env }) => {
    try {
      await cleanupExpiredReplyMedia(env);
    } catch (error) {
      console.error("[reply-media] scheduled cleanup failed:", error);
    }
  });
});
