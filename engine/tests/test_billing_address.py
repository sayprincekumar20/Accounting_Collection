"""Billing address split into Zoho's billing fields (rules-1.6)."""

from datetime import date

from app.assessment.address import parse
from app.assessment.assess import assess
from app.review.apply import apply_rows
from tests.test_assessment import SNAPSHOT, DocInput, bir, f

TODAY = date(2026, 11, 27)
NCR = "National Capital Region (Manila)"


def test_parse_ph_addresses():
    assert parse("2426 SULU ST., BRGY. STA. CRUZ BLUMENTRITT, MANILA 1014") == {
        "street": "2426 SULU ST.", "barangay": "Sta. Cruz Blumentritt", "city": "Manila",
        "province": NCR, "zip": "1014"}
    p = parse("LT 7 BLK 4 MARIAN ROAD, SAN MARTIN DE PORRES, PARANAQUE CITY, METRO MANILA 1700")
    assert (p["barangay"], p["city"], p["province"], p["zip"]) == (
        "San Martin de Porres", "Parañaque", NCR, "1700")
    p = parse("810 MOLINA ST., CARIDAD, CAVITE CITY, CAVITE 4100")
    assert (p["city"], p["province"]) == ("Cavite City", "Cavite")
    p = parse("BLK 3 LOT 5 PH 2, BRGY SALITRAN, DASMARINAS, CAVITE")
    assert (p["barangay"], p["city"], p["province"], p["zip"]) == (
        "Salitran", "Dasmariñas", "Cavite", None)


def _props(a):
    return {p["zoho_field"]: p for p in a["proposals"] if p["zoho_field"].startswith("Billing_")}


def test_one_row_per_billing_field_from_the_customer_sheet_first():
    cis = DocInput("cis", "CIS.pdf", "CUSTOMER_INFO_SHEET",
                   {"billing_address": f("2426 SULU ST., BRGY. STA. CRUZ BLUMENTRITT, MANILA 1014"),
                    "registered_name": f("JUAN'S MEAT SHOP")}, None, None)
    snap = {**SNAPSHOT, "Billing_Street": None, "Billing_City1": None, "Billing_Province": None}
    props = _props(assess(snap, [bir(), cis], TODAY))
    assert props["Billing_Street"]["proposed_value"] == "2426 SULU ST."     # sheet, not BIR
    assert props["Billing_Barangay"]["proposed_value"] == "Sta. Cruz Blumentritt"
    assert props["Billing_City1"]["proposed_value"] == "Manila"
    assert props["Billing_Province"]["proposed_value"] == NCR
    assert props["Billing_Code"]["proposed_value"] == "1014"
    assert props["Billing_City1"]["action"] == "FILL"


def test_matching_parts_are_information_only_and_differences_need_a_decision():
    address = f("2426 SULU ST., BRGY. STA. CRUZ, MANILA 1014")
    cis = DocInput("cis", "CIS.pdf", "CUSTOMER_INFO_SHEET", {"billing_address": address},
                   None, None)
    snap = {**SNAPSHOT, "Billing_Street": "2426 Sulu St.", "Billing_Barangay": "Tondo",
            "Billing_City1": {"name": "Manila", "id": "1"}, "Billing_Province": NCR}
    props = _props(assess(snap, [cis], TODAY))
    assert props["Billing_City1"]["action"] == "MATCH"
    assert props["Billing_Province"]["action"] == "MATCH"
    assert props["Billing_Barangay"]["action"] == "CORRECT"                # reviewer decides


class Zoho:
    def __init__(self):
        self.account = {"Billing_City1": None, "Billing_Province": None}
        self.updates = []

    def get_record(self, module, rid):
        return self.account

    def search_records(self, module, criteria):
        assert module == "Master_Location"
        return [{"id": "777", "Name": "Manila"}] if "Manila" in criteria else []

    def update_record(self, module, rid, values, triggers=None):
        self.updates.append(values)
        for k, v in values.items():
            self.account[k] = {"id": v["id"], "name": "Manila"} if isinstance(v, dict) else v


def test_city_is_written_as_the_master_location_record():
    zoho = Zoho()
    result = apply_rows(zoho, "acc", [
        {"id": "1", "zoho_field": "Billing_City1", "decision": "Approve", "value": "Manila",
         "current_value": None},
        {"id": "2", "zoho_field": "Billing_Province", "decision": "Approve", "value": NCR,
         "current_value": None}], dry_run=False)
    assert zoho.updates[0] == {"Billing_City1": {"id": "777"}, "Billing_Province": NCR}
    assert {r.zoho_field: r.outcome for r in result.rows} == {
        "Billing_City1": "APPLIED", "Billing_Province": "APPLIED"}


def test_city_not_in_the_locations_list_is_not_written():
    zoho = Zoho()
    result = apply_rows(zoho, "acc", [
        {"id": "1", "zoho_field": "Billing_City1", "decision": "Approve", "value": "Nowhere",
         "current_value": None}], dry_run=False)
    assert result.rows[0].outcome == "FAILED" and "not in the Master_Location" in \
        result.rows[0].detail
    assert zoho.updates == []


def test_address_without_commas_from_a_bir_2303():
    """DV-31: the BIR 2303 address is read as one line, without commas."""
    p = parse("LT 7 BLK 4 MARIAN ROAD BRGY SAN MARTIN DE PORRES UPS 11 PARANAQUE CITY 1700")
    assert p == {"street": "LT 7 BLK 4 MARIAN ROAD, UPS 11", "barangay": "San Martin de Porres",
                 "city": "Parañaque", "province": NCR, "zip": "1700"}
    q = parse("UNIT 5 GROUND FLR ABC BLDG QUEZON AVE QUEZON CITY METRO MANILA 1100")
    assert (q["street"], q["city"], q["province"]) == (
        "UNIT 5 GROUND FLR ABC BLDG QUEZON AVE", "Quezon City", NCR)
    r = parse("810 MOLINA ST CARIDAD CAVITE CITY CAVITE 4100")
    assert (r["city"], r["province"], r["zip"]) == ("Cavite City", "Cavite", "4100")


def test_numbered_barangay_is_kept():
    p = parse("123 RIZAL AVE BRGY 123 ZONE 9 CALOOCAN CITY 1400")
    assert p["city"] == "Caloocan" and p["barangay"].startswith("123")
