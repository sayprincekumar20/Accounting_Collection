const gsm7Basic =
  "@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !\"#¤%&'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà";

const gsm7Extension = "\f^{}\\[~]|€";

export type SmsEncoding = "GSM-7" | "Unicode";

export type SmsSegmentEstimate = {
  encoding: SmsEncoding;
  characters: number;
  segments: number;
  units: number;
  unitsPerSegment: number;
};

export function estimateSmsSegments(message: string): SmsSegmentEstimate {
  let gsm7Units = 0;
  let isGsm7 = true;

  for (const character of message) {
    if (gsm7Basic.includes(character)) {
      gsm7Units += 1;
    } else if (gsm7Extension.includes(character)) {
      gsm7Units += 2;
    } else {
      isGsm7 = false;
      break;
    }
  }

  if (isGsm7) {
    const unitsPerSegment = gsm7Units > 160 ? 153 : 160;
    return {
      encoding: "GSM-7",
      characters: [...message].length,
      segments: gsm7Units === 0 ? 0 : Math.ceil(gsm7Units / unitsPerSegment),
      units: gsm7Units,
      unitsPerSegment,
    };
  }

  const units = message.length;
  const unitsPerSegment = units > 70 ? 67 : 70;
  return {
    encoding: "Unicode",
    characters: [...message].length,
    segments: units === 0 ? 0 : Math.ceil(units / unitsPerSegment),
    units,
    unitsPerSegment,
  };
}
