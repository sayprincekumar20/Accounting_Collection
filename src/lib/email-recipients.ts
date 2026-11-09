const emailAddressPattern =
  /^[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9](?:[A-Z0-9-]*[A-Z0-9])?(?:\.[A-Z0-9](?:[A-Z0-9-]*[A-Z0-9])?)+$/i;

export function parseEmailRecipients(value: string): string[] {
  const recipients: string[] = [];
  let token = "";
  let quoted = false;
  let angleDepth = 0;

  for (const character of value) {
    if (character === '"') quoted = !quoted;
    if (!quoted && character === "<") angleDepth += 1;
    if (!quoted && character === ">") angleDepth = Math.max(0, angleDepth - 1);
    if (!quoted && angleDepth === 0 && (character === "," || character === ";")) {
      if (token.trim()) recipients.push(parseRecipient(token));
      token = "";
    } else {
      token += character;
    }
  }
  if (token.trim()) recipients.push(parseRecipient(token));

  const unique = new Map<string, string>();
  for (const recipient of recipients) unique.set(recipient.toLowerCase(), recipient);
  return [...unique.values()];
}

export function getReplyAllCcRecipients({
  toRecipients,
  headerTo,
  headerCc,
  businessEmail,
  extraCc = [],
}: {
  toRecipients: string[];
  headerTo: string;
  headerCc: string;
  businessEmail: string;
  extraCc?: string[];
}): string[] {
  const alreadyTo = new Set(toRecipients.map((address) => address.toLowerCase()));
  return parseEmailRecipients([headerTo, headerCc, ...extraCc].filter(Boolean).join(", ")).filter(
    (address) =>
      address.toLowerCase() !== businessEmail.toLowerCase() &&
      !alreadyTo.has(address.toLowerCase()),
  );
}

function parseRecipient(token: string): string {
  const value = token.trim();
  const angleAddress = value.match(/<([^<>]+)>/);
  const address = (angleAddress?.[1] ?? value).trim();
  if (!emailAddressPattern.test(address)) {
    throw new Error(`Invalid email address: ${value}`);
  }
  return address;
}
