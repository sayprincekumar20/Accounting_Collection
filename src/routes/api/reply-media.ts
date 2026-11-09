import { createFileRoute } from "@tanstack/react-router";
import {
  MAX_REPLY_FILES,
  MAX_REPLY_FILE_SIZE,
  MAX_REPLY_TOTAL_SIZE,
  deleteReplyMedia,
  storeReplyMedia,
} from "@/lib/reply-media";
import { getViberAttachmentError } from "@/lib/viber-media";

export const Route = createFileRoute("/api/reply-media")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const uploadedIds: string[] = [];
        try {
          if (!request.headers.get("content-type")?.includes("multipart/form-data")) {
            return Response.json({ error: "Expected multipart form data" }, { status: 415 });
          }

          const form = await request.formData();
          const channel = form.get("channel");
          const files = form
            .getAll("files")
            .filter((value): value is File => value instanceof File);
          if (!files.length) {
            return Response.json({ error: "Select at least one file" }, { status: 400 });
          }
          if (channel === "viber") {
            const invalidFile = files.find((file) =>
              getViberAttachmentError({ name: file.name, type: file.type, size: file.size }),
            );
            if (invalidFile) {
              return Response.json(
                {
                  error: getViberAttachmentError({
                    name: invalidFile.name,
                    type: invalidFile.type,
                    size: invalidFile.size,
                  }),
                },
                { status: 415 },
              );
            }
          }
          if (files.length > MAX_REPLY_FILES) {
            return Response.json(
              { error: `You can attach up to ${MAX_REPLY_FILES} files at once.` },
              { status: 413 },
            );
          }
          if (files.some((file) => file.size > MAX_REPLY_FILE_SIZE)) {
            return Response.json(
              {
                error: `Each attachment must be ${MAX_REPLY_FILE_SIZE / 1024 / 1024} MB or smaller.`,
              },
              { status: 413 },
            );
          }
          if (files.reduce((total, file) => total + file.size, 0) > MAX_REPLY_TOTAL_SIZE) {
            return Response.json(
              {
                error: `The combined attachment size must be ${MAX_REPLY_TOTAL_SIZE / 1024 / 1024} MB or smaller.`,
              },
              { status: 413 },
            );
          }

          const attachments = [];
          for (const file of files) {
            const attachment = await storeReplyMedia(file);
            attachments.push(attachment);
            uploadedIds.push(attachment.id);
          }

          return Response.json(
            { attachments },
            {
              headers: { "Cache-Control": "no-store" },
            },
          );
        } catch (error) {
          if (uploadedIds.length) {
            await deleteReplyMedia(uploadedIds).catch((cleanupError) => {
              console.error("[reply-media] upload rollback failed:", cleanupError);
            });
          }
          console.error("[reply-media] upload failed:", error);
          return Response.json(
            { error: error instanceof Error ? error.message : "Failed to upload attachments" },
            { status: 500 },
          );
        }
      },
      DELETE: async ({ request }) => {
        try {
          const body = (await request.json()) as { ids?: unknown };
          const ids = body.ids;
          if (
            !Array.isArray(ids) ||
            !ids.every((id): id is string => typeof id === "string" && /^[a-f0-9]{64}$/.test(id))
          ) {
            return Response.json({ error: "Invalid attachment references" }, { status: 400 });
          }
          await deleteReplyMedia(ids);
          return new Response(null, { status: 204 });
        } catch (error) {
          console.error("[reply-media] delete failed:", error);
          return Response.json(
            { error: error instanceof Error ? error.message : "Failed to remove attachment" },
            { status: 500 },
          );
        }
      },
    },
  },
});
