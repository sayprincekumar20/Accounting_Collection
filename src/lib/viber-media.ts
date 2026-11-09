const supportedViberTypes = new Set([
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "text/plain",
  "text/csv",
]);

const supportedViberExtensions = new Set([
  ".jpg",
  ".jpeg",
  ".png",
  ".gif",
  ".webp",
  ".pdf",
  ".doc",
  ".docx",
  ".xls",
  ".xlsx",
  ".ppt",
  ".pptx",
  ".txt",
  ".csv",
]);

export function getViberAttachmentError(file: { name: string; type: string; size: number }) {
  if (!file.size || file.size > 15 * 1024 * 1024) {
    return "Each Viber attachment must be between 1 byte and 15 MB.";
  }
  const extension = file.name.match(/\.[^.]+$/)?.[0]?.toLowerCase();
  if (!extension || !supportedViberExtensions.has(extension)) {
    return "Viber attachments must be an image, PDF, Office document, TXT, or CSV file.";
  }
  if (file.type && !supportedViberTypes.has(file.type.toLowerCase())) {
    return "Viber attachments must be an image, PDF, Office document, TXT, or CSV file.";
  }
  return null;
}

export function getViberAttachmentBatchError(
  files: { name: string; type: string; size: number }[],
  existing: { size: number }[],
) {
  if (existing.length + files.length > 10) {
    return "You can attach up to 10 files to a Viber message.";
  }
  const invalidFile = files.find(getViberAttachmentError);
  if (invalidFile) return getViberAttachmentError(invalidFile)!;
  if (
    existing.reduce((total, file) => total + file.size, 0) +
      files.reduce((total, file) => total + file.size, 0) >
    20 * 1024 * 1024
  ) {
    return "The combined Viber attachment size must be 20 MB or smaller.";
  }
  return null;
}
