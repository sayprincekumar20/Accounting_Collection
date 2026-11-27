"""Split a Philippine address from a document into Zoho's billing fields:
Billing_Street, Billing_Barangay, Billing_City1 (Master_Location), Billing_Province, Billing_Code.

Built for BIR 2303 / Customer Information Sheet / permit addresses, e.g.
'2426 SULU ST., BRGY. STA. CRUZ BLUMENTRITT, MANILA 1014' or
'LT 7 BLK 4 MARIAN ROAD, SAN MARTIN DE PORRES, PARANAQUE CITY, METRO MANILA 1700'.
A part that cannot be found is left out (no proposal), never guessed."""

import re
import unicodedata

NCR = "National Capital Region (Manila)"
NCR_CITIES = {
    "MANILA": "Manila", "QUEZON": "Quezon City", "MAKATI": "Makati", "PASIG": "Pasig",
    "TAGUIG": "Taguig", "MANDALUYONG": "Mandaluyong", "MARIKINA": "Marikina", "PASAY": "Pasay",
    "PARANAQUE": "Parañaque", "LAS PINAS": "Las Piñas", "MUNTINLUPA": "Muntinlupa",
    "CALOOCAN": "Caloocan", "MALABON": "Malabon", "NAVOTAS": "Navotas", "VALENZUELA": "Valenzuela",
    "SAN JUAN": "San Juan", "PATEROS": "Pateros",
}
# Zoho's Billing State/Province values (the dropdown); NCR handled above
PROVINCES = [
    "Abra", "Agusan del Norte", "Agusan del Sur", "Aklan", "Albay", "Antique", "Apayao",
    "Aurora", "Basilan", "Bataan", "Batanes", "Batangas", "Benguet", "Biliran", "Bohol",
    "Bukidnon", "Bulacan", "Cagayan", "Camarines Norte", "Camarines Sur", "Camiguin", "Capiz",
    "Catanduanes", "Cavite", "Cebu", "Cotabato", "Davao de Oro", "Davao del Norte",
    "Davao del Sur", "Davao Occidental", "Davao Oriental", "Dinagat Islands", "Eastern Samar",
    "Guimaras", "Ifugao", "Ilocos Norte", "Ilocos Sur", "Iloilo", "Isabela", "Kalinga",
    "La Union", "Laguna", "Lanao del Norte", "Lanao del Sur", "Leyte", "Maguindanao",
    "Marinduque", "Masbate", "Misamis Occidental", "Misamis Oriental", "Mountain Province",
    "Negros Occidental", "Negros Oriental", "Northern Samar", "Nueva Ecija", "Nueva Vizcaya",
    "Occidental Mindoro", "Oriental Mindoro", "Palawan", "Pampanga", "Pangasinan", "Quezon",
    "Quirino", "Rizal", "Romblon", "Samar", "Sarangani", "Siquijor", "Sorsogon",
    "South Cotabato", "Southern Leyte", "Sultan Kudarat", "Sulu", "Surigao del Norte",
    "Surigao del Sur", "Tarlac", "Tawi-Tawi", "Zambales", "Zamboanga del Norte",
    "Zamboanga del Sur", "Zamboanga Sibugay",
]
_NCR_WORDS = ("METRO MANILA", "NATIONAL CAPITAL REGION", "NCR")
# names whose ñ is lost in plain text
_ENYE = {"DASMARINAS": "Dasmariñas", "BINAN": "Biñan", "PENARANDA": "Peñaranda",
         "SANTO NINO": "Santo Niño", "STO NINO": "Sto. Niño", "PINAS": "Piñas"}
_STREET_HINT = re.compile(r"\b(ST|STREET|AVE|AVENUE|RD|ROAD|BLVD|DRIVE|DR|LOT|LT|BLK|BLOCK|"
                          r"PHASE|BLDG|BUILDING|UNIT|FLR|FLOOR|SUBD|VILLAGE|PUROK|SITIO|"
                          r"HIGHWAY|HWY|ZONE|NO)\b\.?")


def _plain(text: str) -> str:
    t = unicodedata.normalize("NFKD", str(text or "")).encode("ascii", "ignore").decode()
    return re.sub(r"\s+", " ", t).strip()


def _key(text: str) -> str:
    return re.sub(r"[^A-Z0-9 ]", "", _plain(text).upper()).strip()


def _title(text: str) -> str:
    if _key(text) in _ENYE:
        return _ENYE[_key(text)]
    small = {"de", "del", "ng", "la", "las", "los", "of"}
    words = _plain(text).strip(" ,.").split()
    return " ".join(w.lower() if i and w.lower() in small else w.capitalize()
                    for i, w in enumerate(words))


def parse(address: str | None) -> dict:
    """{street, barangay, city, province, zip}; missing parts are None."""
    out = {"street": None, "barangay": None, "city": None, "province": None, "zip": None}
    text = _plain(address)
    if not text:
        return out
    # ZIP: a 4-digit number at the end (not a lot / house / unit number)
    m = re.search(r"(?<![#\w-])(\d{4})\s*(?:PHILIPPINES|PH)?\s*[.,]?\s*$", text, re.I)
    if m:
        out["zip"] = m.group(1)
        text = text[:m.start()].rstrip(" ,.")
    parts = [p.strip() for p in re.split(r",|\n|;", text) if p.strip(" .")]
    used: set[int] = set()

    # province: NCR words or a province name as a whole part (or at the end of one)
    for i in range(len(parts) - 1, -1, -1):
        k = _key(parts[i])
        if any(w in k for w in _NCR_WORDS):
            out["province"], parts[i] = NCR, re.sub(
                r"(?i)metro manila|national capital region|\bncr\b", "", parts[i]).strip(" ()-")
            if not parts[i]:
                used.add(i)
            break
        prov = next((p for p in sorted(PROVINCES, key=len, reverse=True)
                     if k == _key(p) or k.endswith(" " + _key(p))), None)
        if prov and i > 0:
            out["province"] = prov
            rest = re.sub(rf"(?i)\s*{re.escape(prov)}$", "", parts[i]).strip()
            if rest:
                parts[i] = rest
            else:
                used.add(i)
            break

    # city: "X CITY", "CITY OF X", or a Metro Manila city name
    city_i = None
    for i in range(len(parts) - 1, -1, -1):
        if i in used:
            continue
        k = _key(parts[i])
        m = re.match(r"^CITY OF (.+)$", k) or re.match(r"^(.+?) CITY$", k)
        name = m.group(1).strip() if m else (k if k in NCR_CITIES else None)
        if name:
            # provincial cities keep "City" (Cavite City is not the province Cavite)
            out["city"] = NCR_CITIES.get(name, _title(name) + (" City" if m else ""))
            if name in NCR_CITIES:
                out["province"] = NCR
            city_i = i
            used.add(i)
            break
    if city_i is None:          # a part right before the province, e.g. "IMUS, CAVITE"
        last = max((i for i in range(len(parts)) if i not in used), default=None)
        if out["province"] and out["province"] != NCR and last is not None and last > 0 \
                and not re.search(r"\d", parts[last]) and not _STREET_HINT.search(
                    _key(parts[last])):
            out["city"], city_i = _title(parts[last]), last
            used.add(last)

    # barangay: "BRGY. X" anywhere, else the part right before the city (no numbers / street)
    for i, p in enumerate(parts):
        m = re.search(r"(?i)\b(?:BRGY|BGY|BARANGAY)\.?\s+(.+)$", p)
        if m and i not in used:
            out["barangay"] = _title(m.group(1))
            before = p[:m.start()].strip(" ,.")
            if before:
                parts[i] = before
            else:
                used.add(i)
            break
    else:
        if city_i is not None and city_i > 1:
            j = city_i - 1
            if j not in used and not re.search(r"\d", parts[j]) \
                    and not _STREET_HINT.search(_key(parts[j])):
                out["barangay"] = _title(parts[j])
                used.add(j)

    street = [parts[i] for i in range(len(parts)) if i not in used
              and (city_i is None or i < city_i)]
    out["street"] = ", ".join(p.strip(" ,") for p in street).strip(" ,") or None
    return out


def same_part(a, b) -> bool:
    return _key(a) == _key(b) or bool(_key(a)) and _key(a).replace(" CITY", "") == \
        _key(b).replace(" CITY", "")
