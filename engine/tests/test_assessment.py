"""Phase 1D: matching rules, cross-document checks, Zoho proposals, recommendation.
Scenarios mirror real cases (anonymized)."""

from datetime import date

import pytest

from app.assessment.assess import DocInput, assess
from app.assessment.matching import (
    DIFFERENT,
    LIKELY_SAME,
    SAME,
    match_address,
    match_business,
    match_person,
    match_tin,
    natural_person_name,
)

TODAY = date(2026, 10, 7)


@pytest.mark.parametrize("a,b,expected", [
    ("Purok 1 Brgy. Masagana, Bay", "PUROK 1 MASAGANA 4033 BAY LAGUNA PHILIPPINES", SAME),
    ("LOT20, BLK23 RIZAL EXT., SAN ANTONIO 1203", "LOT 20, BLOCK 23 RIZAL EXT., SAN ANTONIO 1203",
     SAME),
    ("LOT 20, BLOCK 21 RIZAL EXT", "LOT 20, BLOCK 23 RIZAL EXT", DIFFERENT),
    ("REAL ST., SAMPAGUITA VILLAGE, BRGY76", "#10 SAMPAGUITA VILLAGE BARANGAY 76 6500", DIFFERENT),
])
def test_match_address(a, b, expected):
    assert match_address(a, b) == expected


@pytest.mark.parametrize("a,b,expected", [
    ("DELA CRUZ, JUAN", "JUAN DELA CRUZ", SAME),
    ("MARIA C. SANTOS", "MARIA SANTOS", SAME),                       # middle initial
    ("REYES, ANA DELOS SANTOS", "ANA REYES", LIKELY_SAME),           # middle name left out
    ("REYES, ANA DELOS SANTOS", "MARIA C. SANTOS", DIFFERENT),
    ("PEDRO PENDUKO JR.", "PEDRO PENDUKO", SAME),
])
def test_match_person(a, b, expected):
    assert match_person(a, b) == expected


def test_match_business_and_tin():
    assert match_business("JUAN'S MEAT SHOP", "JUAN MEAT SHOP") == SAME
    assert match_business("JUANS BISTRO AND GRILL", "JUAN'S BISTRO") == LIKELY_SAME
    assert match_business("SAMPLE BRAND MALL", "EXAMPLE FOODS INC.") == DIFFERENT
    assert match_tin("123-456-789-000", "123-456-789-00000") == SAME
    assert match_tin("123-456-789-00004", "123-456-789-00000") == DIFFERENT
    assert match_tin("123-456-789-00004", "123-456-789-00000", ignore_branch=True) == SAME
    assert natural_person_name("DELA CRUZ, JUAN") == "JUAN DELA CRUZ"


def f(value, normalized=None, grounding="EXACT", confidence=0.95):
    return {"value": value, "normalized": normalized or value, "grounding": grounding,
            "confidence": confidence}


def bir(tin="123-456-789-00000", name="DELA CRUZ, JUAN", trade="JUAN'S MEAT SHOP",
        ttype="SINGLE PROPRIETORSHIP ONLY (RESIDENT CITIZEN)", address="PUROK 1 MASAGANA 4033 BAY"):
    return DocInput("bir", "bir.jpg", "BIR_2303", {
        "tin": f(tin), "taxpayer_name": f(name), "trade_name": f(trade),
        "taxpayer_type": f(ttype), "registered_address": f(address),
        "line_of_business": f("RETAIL SALE OF MEAT")}, "VALID")


def dti(owner="JUAN DELA CRUZ", until="2028-05-11", status="VALID"):
    return DocInput("dti", "dti.jpg", "DTI_BN_CERT", {
        "owner_name": f(owner), "business_name": f("JUAN'S MEAT SHOP")}, status, until)


def permit(owner="JUAN DELA CRUZ", business="JUAN'S MEAT SHOP", until="2026-12-31",
           status="VALID"):
    return DocInput("permit", "permit.jpg", "MAYORS_PERMIT", {
        "owner_name": f(owner), "business_name": f(business),
        "business_address": f("PUROK 1 MASAGANA BAY")}, status, until)


ACCOUNTING = {"name": "MARIA SANTOS", "email": "maria@juanmeat.ph", "mobile": "0917 123 4567",
              "roles": {"Contact_of": "Accounting"}}
SNAPSHOT = {"Account_Name": "JUAN MEAT SHOP", "Invoice_Company_Name": "JUAN MEAT SHOP",
            "Owner_Name": "SALES REP NAME", "Owner": {"name": "SALES REP NAME"},
            "Billing_Street": "Purok 1 Brgy. Masagana, Bay", "Credit_Terms": "COD",
            "_contacts": [ACCOUNTING]}


def by_field(a):
    return {p["zoho_field"]: p for p in a["proposals"]}


def test_all_valid_and_consistent_is_active():
    a = assess(SNAPSHOT, [bir(), dti(), permit()], TODAY)
    assert a["recommendation"] == "ACTIVE"
    assert {c["attribute"]: c["status"] for c in a["cross_document"]}["owner_name"] == "CONSISTENT"
    p = by_field(a)
    assert p["Owner_Name"]["action"] == "CORRECT"
    assert p["Owner_Name"]["proposed_value"] == "JUAN DELA CRUZ"
    assert "sales rep" in p["Owner_Name"]["reason"]
    assert p["Tax_Identification_Number_TIN"]["action"] == "FILL"
    assert p["Type_of_Business_Organization"]["proposed_value"] == "Single Proprietorship"
    assert p["Invoice_Company_Name"]["action"] == "MATCH"
    assert p["Billing_Street"]["action"] == "MATCH"
    assert "Business_Permit" not in p          # files stay under Attachments only
    assert p["Owner_Name"]["confidence"] == 0.98  # three documents agree


def test_expired_required_documents_alert_but_do_not_block(monkeypatch):
    from app.assessment import policy
    docs = [bir(), dti(until="2026-05-11", status="EXPIRED"),
            permit(until="2025-12-31", status="EXPIRED")]
    a = assess(SNAPSHOT, docs, TODAY)                      # rules-1.4: alert only
    assert a["recommendation"] == "ACTIVE"
    assert len([r for r in a["reasons"] if "expired" in r]) == 2
    assert any("do not block activation (rules-1.4)" in r for r in a["reasons"])
    assert "Business_Permit" not in by_field(a)  # expired documents are not attached
    monkeypatch.setattr(policy, "EXPIRED_REQUIRED_DOCUMENT", "INACTIVE")   # stricter setting
    assert assess(SNAPSHOT, docs, TODAY)["recommendation"] == "INACTIVE"


def test_documents_of_another_person_hold_everything():
    gov_id = DocInput("id", "id.png", "GOVERNMENT_ID", {
        "full_name": f("REYES, ANA DELOS SANTOS"), "tin": f("987-654-321-000")}, "NO_EXPIRY")
    a = assess({"Account_Name": "ANA REYES"},
               [permit(owner="MARIA C. SANTOS", business="MARIA SANTOS MEAT STALL"), gov_id],
               TODAY)
    assert a["recommendation"] == "MANUAL_REVIEW"
    owner = [c for c in a["cross_document"] if c["attribute"] == "owner_name"][0]
    assert owner["status"] == "CONFLICT" and owner["severity"] == "CRITICAL"
    p = by_field(a)
    assert p["Owner_Name"]["action"] == "REVIEW_CONFLICT"
    assert all(x["action"] not in ("FILL", "CORRECT", "ATTACH") for x in a["proposals"])
    assert p["Tax_Identification_Number_TIN"]["action"] == "HOLD"
    assert p["Tax_Identification_Number_TIN"]["proposed_value"] == "987-654-321-000"


def test_corporation_needs_sec_and_has_no_picklist_value():
    corp = bir(tin="009-111-222-00004", name="EXAMPLE FOODS INC.", trade="EXAMPLE FOODS INC.",
               ttype="DOMESTIC CORPORATION")
    a = assess({"Account_Name": "SAMPLE BRAND MALL"}, [corp], TODAY)
    assert a["business_form"] == "CORPORATION"
    # rules-1.3: the BIR 2303 would be enough, but this Account fails the activation checks
    # (no COD, no contacts); the SEC certificate stays listed as still to collect
    assert a["recommendation"] == "MANUAL_REVIEW"
    assert any("Activation check not met: Payment Terms" in r for r in a["reasons"])
    assert any("SEC_CERT" in r for r in a["reasons"])
    p = by_field(a)
    assert p["Type_of_Business_Organization"]["action"] == "FILL"
    assert p["Type_of_Business_Organization"]["proposed_value"] == "Corporation"
    assert "Owner_Name" not in p  # a corporation's name is not a person
    assert p["Account_Name"]["action"] == "DIFFERS"  # brand vs registered name, flagged only
    assert p["Invoice_Company_Name"]["proposed_value"] == "EXAMPLE FOODS INC."  # as printed


def test_tin_conflict_between_bir_and_id_is_critical():
    gov_id = DocInput("id", "id.png", "GOVERNMENT_ID", {
        "full_name": f("DELA CRUZ, JUAN"), "tin": f("999-999-999-000")}, "NO_EXPIRY")
    a = assess(SNAPSHOT, [bir(), dti(), permit(), gov_id], TODAY)
    tin = [c for c in a["cross_document"] if c["attribute"] == "tin"][0]
    assert tin["status"] == "CONFLICT" and a["recommendation"] == "MANUAL_REVIEW"


def test_zoho_tin_that_differs_is_corrected():
    a = assess({**SNAPSHOT, "Tax_Identification_Number_TIN": "123-456-780-000"},
               [bir(), dti(), permit()], TODAY)
    assert by_field(a)["Tax_Identification_Number_TIN"]["action"] == "CORRECT"


def test_low_confidence_value_needs_attention():
    low = bir()
    low.fields["tin"] = f("123-456-789-00000", grounding="CONFLICT", confidence=0.3)
    p = by_field(assess(SNAPSHOT, [low, dti(), permit()], TODAY))["Tax_Identification_Number_TIN"]
    assert p["action"] == "FILL" and p["needs_attention"]


def test_critical_document_issue_forces_review():
    b = bir()
    b.issues = [{"code": "BRANCH_MISMATCH", "message": "x", "severity": "CRITICAL"}]
    assert assess(SNAPSHOT, [b, dti(), permit()], TODAY)["recommendation"] == "MANUAL_REVIEW"


def test_match_with_zoho_never_needs_attention():
    low = bir()
    low.fields["tin"] = f("123-456-789-00000", grounding="NOT_FOUND", confidence=0.45)
    a = assess({**SNAPSHOT, "Tax_Identification_Number_TIN": "123-456-789-00000"},
               [low, dti(), permit()], TODAY)
    p = by_field(a)["Tax_Identification_Number_TIN"]
    assert p["action"] == "MATCH" and p["needs_attention"] is False


def test_valid_until_source_is_explained():
    from app.assessment.assess import valid_until_source
    d = dti(until="2028-06-29")
    d.fields["valid_to"] = f("29 June 2028")
    assert valid_until_source(d) == "valid_to as printed: 29 June 2028"
    p = permit()
    p.issues = [{"code": "VALIDITY_DERIVED", "severity": "INFO",
                 "message": "No expiry printed; valid until 2026-12-31 "
                            "(Dec 31 of the date issued)"}]
    assert valid_until_source(p).startswith("derived: No expiry printed")
    assert valid_until_source(bir()) == "no expiry for this document type"
    a = assess(SNAPSHOT, [bir(), d, permit()], TODAY)
    data = {x["type"]: x for x in a["document_data"]}
    assert data["DTI_BN_CERT"]["valid_until_source"] == "valid_to as printed: 29 June 2028"
    req = {r["document_type"]: r for r in a["requirements"]}
    assert req["DTI_BN_CERT"]["valid_until_source"] == "valid_to as printed: 29 June 2028"


def test_required_document_without_printed_expiry_counts_as_valid():
    from app.assessment.assess import valid_until_source
    p = permit()
    p.validity_status, p.valid_until = "NO_EXPIRY", None
    p.issues = [{"code": "NO_EXPIRY_PRINTED", "severity": "WARNING",
                 "message": "No expiry date printed on this document (check the document)"}]
    a = assess(SNAPSHOT, [bir(), dti(), p], TODAY)
    assert a["recommendation"] == "ACTIVE"
    req = {r["document_type"]: r for r in a["requirements"]}
    assert req["MAYORS_PERMIT"]["status"] == "NO_EXPIRY"
    assert valid_until_source(p) == "no expiry date printed on this document"


def checks_of(a):
    return {c["key"]: c for c in a["activation_checks"]}


def test_activation_checks_all_met():
    c = checks_of(assess(SNAPSHOT, [bir(), dti(), permit()], TODAY))
    assert c["payment_terms"]["status"] == "PASS"
    assert c["accounting_contact"]["status"] == "PASS"
    assert c["invoice_name"]["status"] == "PASS"
    assert c["billing_address"]["status"] == "PASS"
    assert c["tin"]["status"] == "AFTER_UPDATE"          # empty in Zoho, filled from the BIR 2303


def test_not_cod_means_manual_review():
    a = assess({**SNAPSHOT, "Credit_Terms": "Net 30"}, [bir(), dti(), permit()], TODAY)
    assert a["recommendation"] == "MANUAL_REVIEW"
    assert "Payment Terms is COD" in a["reasons"][0]


def test_cod_spellings():
    from app.assessment.policy import is_cod
    assert is_cod("Cash On Delivery")              # the production picklist value
    assert is_cod("COD") and is_cod("Cash on Delivery") and is_cod("C.O.D".replace(".", ""))
    assert not is_cod("Net 30") and not is_cod("CODE 7") and not is_cod(None)


def test_accounting_contact_needs_a_name_and_a_mobile_or_an_email():
    bad = {**ACCOUNTING, "email": "maria at juanmeat", "mobile": None, "phone": None}
    a = assess({**SNAPSHOT, "_contacts": [bad]}, [bir(), dti(), permit()], TODAY)
    c = checks_of(a)["accounting_contact"]
    assert c["status"] == "FAIL" and "or an email in a valid format" in c["detail"]
    mobile_only = {**ACCOUNTING, "email": None}                  # rules-1.5: mobile is enough
    c = checks_of(assess({**SNAPSHOT, "_contacts": [mobile_only]}, [bir()], TODAY))
    assert c["accounting_contact"]["status"] == "PASS"
    entered = {**ACCOUNTING, "email": "fakeemail@gmail.com"}   # format ok: accepted as given
    c = checks_of(assess({**SNAPSHOT, "_contacts": [entered]}, [bir()], TODAY))
    assert c["accounting_contact"]["status"] == "PASS"
    other_role = {**ACCOUNTING, "roles": {"Contact_of": "Purchasing"}}
    c = checks_of(assess({**SNAPSHOT, "_contacts": [other_role]}, [bir()], TODAY))
    assert c["accounting_contact"]["detail"].startswith("no Contact with Contact of = Accounting")
    by_position = {**ACCOUNTING, "roles": {"Position_Role": "Accounting Manager"}}
    c = checks_of(assess({**SNAPSHOT, "_contacts": [by_position]}, [bir()], TODAY))
    assert c["accounting_contact"]["status"] == "PASS"


def test_primary_contact_counts_too():
    primary = {**ACCOUNTING, "roles": {"Contact_of": "Purchasing"}, "primary": True}
    c = checks_of(assess({**SNAPSHOT, "_contacts": [primary]}, [bir()], TODAY))
    assert c["accounting_contact"]["status"] == "PASS"
    assert c["accounting_contact"]["detail"].endswith("(primary contact)")
    assert "+63 917 123 4567" in c["accounting_contact"]["detail"]


def test_mobile_must_be_a_philippine_mobile():
    landline = {**ACCOUNTING, "mobile": "(02) 8123 4567", "email": None}
    c = checks_of(assess({**SNAPSHOT, "_contacts": [landline]}, [bir()], TODAY))
    assert c["accounting_contact"]["status"] == "FAIL"
    assert "Philippine format" in c["accounting_contact"]["detail"]
    assert "(has (02) 8123 4567)" in c["accounting_contact"]["detail"]
    in_phone_field = {**ACCOUNTING, "mobile": None, "phone": "0917 765 4321"}
    c = checks_of(assess({**SNAPSHOT, "_contacts": [in_phone_field]}, [bir()], TODAY))
    assert c["accounting_contact"]["status"] == "PASS"
    assert "+63 917 765 4321" in c["accounting_contact"]["detail"]


def test_ph_mobile_formats():
    from app.assessment.policy import ph_mobile
    for v in ("09171234567", "0917 123 4567", "0917-123-4567", "+639171234567",
              "+63 917 123 4567", "639171234567", "9171234567"):
        assert ph_mobile(v) == "+63 917 123 4567", v
    for v in ("(02) 8123 4567", "0817 123 4567", "0917123456", "091712345678", "", None,
              "tel 0917 123 4567"):
        assert ph_mobile(v) is None, v


def test_tin_in_zoho_differing_from_bir_fails():
    a = assess({**SNAPSHOT, "Tax_Identification_Number_TIN": "999-999-999-00000"},
               [bir(), dti(), permit()], TODAY)
    assert checks_of(a)["tin"]["status"] in ("AFTER_UPDATE", "FAIL")
    assert checks_of(a)["tin"]["detail"] != ""


def _high(doc):
    for v in doc.fields.values():
        v.update(confidence=0.98, grounding="EXACT")
    return doc


def test_auto_activation_needs_every_check():
    from app.assessment.alerts import status_decision
    docs = [_high(bir()), _high(dti()), _high(permit())]
    a = assess({**SNAPSHOT, "Tax_Identification_Number_TIN": "123-456-789-00000"}, docs, TODAY)
    assert a["recommendation"] == "ACTIVE"
    assert status_decision(a, None, 0.95)[0] == "ACTIVATE"
    # same documents, but no Accounting contact: not activated, reason given
    a = assess({**SNAPSHOT, "Tax_Identification_Number_TIN": "123-456-789-00000",
                "_contacts": []}, docs, TODAY)
    decision, why = status_decision(a, None, 0.95)
    assert a["recommendation"] == "MANUAL_REVIEW" and decision == "NO_CHANGE"
    assert "Accounting or primary contact" in a["reasons"][0]


def test_file_named_for_the_document_is_preferred():
    from app.assessment.assess import DocInput as D
    inside_other = bir()
    inside_other.document_id, inside_other.file_name = "credit", "Credit Increase_SMMegaFood.pdf"
    named = bir()
    named.document_id, named.file_name = "named", "2303_SMMegaFood.pdf"
    a = assess({**SNAPSHOT, "BIR_Registration_COR": None}, [inside_other, named, dti(),
                                                             permit()], TODAY)
    req = next(r for r in a["requirements"] if r["document_type"] == "BIR_2303")
    assert req["file"] == "2303_SMMegaFood.pdf"
    assert not [p for p in a["proposals"] if p["action"] == "ATTACH"]   # no file rows
    assert isinstance(D, type)



def test_rules_1_3_one_valid_document_is_enough(monkeypatch):
    from app.assessment import policy
    a = assess(SNAPSHOT, [bir()], TODAY)                        # only the BIR 2303
    assert a["recommendation"] == "ACTIVE"
    assert "One valid document is enough (rules-1.3); still to collect:" in a["reasons"]
    assert any("DTI_BN_CERT" in r for r in a["reasons"])
    monkeypatch.setattr(policy, "ACTIVATION_DOCUMENTS", "ALL_REQUIRED")   # rules-1.2
    assert assess(SNAPSHOT, [bir()], TODAY)["recommendation"] == "MANUAL_REVIEW"


def test_no_valid_document_still_needs_a_person():
    expired_permit = permit(until="2025-01-31", status="EXPIRED")
    assert assess(SNAPSHOT, [], TODAY)["recommendation"] == "MANUAL_REVIEW"
    assert assess(SNAPSHOT, [expired_permit], TODAY)["recommendation"] != "ACTIVE"


def test_only_an_expired_document_with_correct_values_is_activated_with_an_alert():
    from app.assessment.alerts import build_alerts
    a = assess(SNAPSHOT, [bir(), permit(until="2025-01-31", status="EXPIRED")], TODAY)
    assert a["recommendation"] == "ACTIVE"
    alerts = build_alerts(a, TODAY)
    assert any(x["code"] == "EXPIRED_DOCUMENT" and x["severity"] == "CRITICAL" for x in alerts)


# ---- whose documents are these? (DV-17: documents of other customers uploaded) ----------
def _bir_of(doc_id, tin, name):
    d = bir(tin=tin, name=name, trade=name, ttype="DOMESTIC CORPORATION",
            address="LT 7 BLK 4 MARIAN ROAD PARANAQUE CITY")
    d.document_id, d.file_name = doc_id, f"{doc_id}.jpg"
    return d


def test_documents_of_other_customers_are_not_counted():
    from app.assessment.alerts import build_alerts
    snap = {**SNAPSHOT, "Account_Name": "Zoho test Comp",
            "Invoice_Company_Name": "SPENCER FOODS CORPORATION"}
    docs = [_bir_of("bluemantle", "007-246-103-000", "BLUEMANTLE INDUSTRIES INC."),
            _bir_of("smmega", "646-908-137-00000", "SMMEGA FOOD INC.")]
    a = assess(snap, docs, TODAY)
    req = next(r for r in a["requirements"] if r["document_type"] == "BIR_2303")
    assert req["status"] == "NOT_THIS_CUSTOMER" and req["identity"] == "CONFLICT"
    assert "none matches the Account" in req["identity_note"]
    assert a["recommendation"] == "MANUAL_REVIEW"
    assert any("Required document of another business: BIR_2303" in r for r in a["reasons"])
    alerts = build_alerts(a, TODAY)
    assert any(x["code"] == "DOCUMENT_NOT_THIS_CUSTOMER" and x["severity"] == "CRITICAL"
               for x in alerts)


def test_tin_different_from_the_account_is_another_business():
    snap = {**SNAPSHOT, "Tax_Identification_Number_TIN": "123-456-789-00000"}
    other = _bir_of("other", "999-888-777-00000", "JUAN MEAT SHOP")
    req = next(r for r in assess(snap, [other, dti(), permit()], TODAY)["requirements"]
               if r["document_type"] == "BIR_2303")
    assert req["status"] == "NOT_THIS_CUSTOMER" and req["identity"] == "OTHER"
    assert "differs from the Account's TIN" in req["identity_note"]


def test_the_customers_own_document_wins_over_another_customers():
    mine = bir()                                         # JUAN'S MEAT SHOP, matches the Account
    other = _bir_of("other", "999-888-777-00000", "BLUEMANTLE INDUSTRIES INC.")
    a = assess(SNAPSHOT, [other, mine, dti(), permit()], TODAY)
    req = next(r for r in a["requirements"] if r["document_type"] == "BIR_2303")
    assert req["status"] == "VALID" and req["file"] == "bir.jpg" and req["identity"] == "MATCH"


def test_matching_documents_are_unchanged():
    a = assess(SNAPSHOT, [bir(), dti(), permit()], TODAY)
    assert {r["identity"] for r in a["requirements"]} == {"MATCH"}
    assert a["recommendation"] == "ACTIVE"


def test_unconfirmed_document_still_counts_but_is_flagged():
    from app.assessment.alerts import build_alerts
    snap = {**SNAPSHOT, "Account_Name": "BRAND X STORE", "Invoice_Company_Name": None}
    a = assess(snap, [_bir_of("b", "123-456-789-00000", "SOMETHING ELSE TRADING")], TODAY)
    req = next(r for r in a["requirements"] if r["document_type"] == "BIR_2303")
    assert req["status"] == "VALID" and req["identity"] == "UNCONFIRMED"
    assert any(x["code"] == "DOCUMENT_UNCONFIRMED" for x in build_alerts(a, TODAY))



# ---- rules-1.5: contact with a mobile or an email; Channel; Wet Market ---------------------
WET = {**SNAPSHOT, "Channel": "General Trade - Wet Market",
       "Account_Name": "(CAVITE WET MARKET) RHAINHEART MEATSHOP",
       "Invoice_Company_Name": "RHAINHEART MEAT SHOP", "Credit_Terms": "Cash On Delivery",
       "Billing_Street": "810 MOLINA ST., CARIDAD", "Billing_City": "CAVITE CITY",
       "Tax_Identification_Number_TIN": None,
       "_contacts": [{"name": "WARREN OMATANG", "mobile": "639608451481", "email": None,
                      "primary": True, "roles": {}}]}


def _wet_permit():
    return permit(owner="WARREN OMATANG", business="RHAINHEART MEAT SHOP")


def test_primary_contact_with_only_a_mobile_passes():
    c = checks_of(assess(WET, [_wet_permit()], TODAY))["accounting_contact"]
    assert c["status"] == "PASS" and "WARREN OMATANG" in c["detail"]
    assert "+63 960 845 1481" in c["detail"] and "(primary contact)" in c["detail"]


def test_wet_market_one_document_and_filled_fields_activate():
    from app.assessment.alerts import status_decision
    a = assess(WET, [_wet_permit()], TODAY)                  # only a Mayor's permit, no TIN
    assert a["channel"] == "General Trade - Wet Market" and a["channel_rule"] == "WET_MARKET"
    checks = checks_of(a)
    assert {k: c["status"] for k, c in checks.items()} == {k: "PASS" for k in checks}
    assert checks["tin"]["detail"] == "no TIN (not required for Wet Market)"
    assert "matching not required" in checks["invoice_name"]["detail"]
    assert a["recommendation"] == "ACTIVE"
    decision, why = status_decision(a, "Inactive", 0.95)
    assert decision == "ACTIVATE" and why.startswith("Wet Market rule")


def test_wet_market_barangay_clearance_alone_counts():
    from tests.test_assessment import DocInput, f
    brgy = DocInput("brgy", "brgy.jpg", "BARANGAY_CLEARANCE",
                    {"business_name": f("RHAINHEART MEAT SHOP")}, "VALID", "2026-12-31")
    a = assess(WET, [brgy], TODAY)
    assert a["recommendation"] == "ACTIVE"


def test_wet_market_still_needs_cod_contact_and_filled_fields():
    a = assess({**WET, "Invoice_Company_Name": None}, [_wet_permit()], TODAY)
    assert checks_of(a)["invoice_name"]["status"] in ("FAIL", "AFTER_UPDATE")
    b = assess({**WET, "Credit_Terms": "Net 30"}, [_wet_permit()], TODAY)
    assert b["recommendation"] == "MANUAL_REVIEW"


def test_wet_market_tin_on_the_documents_must_still_match():
    other = {**WET, "Tax_Identification_Number_TIN": "111-222-333-00000"}
    a = assess(other, [bir(tin="999-888-777-00000", name="WARREN OMATANG",
                           trade="RHAINHEART MEAT SHOP")], TODAY)
    assert a["recommendation"] == "MANUAL_REVIEW"


def test_other_channels_keep_the_full_checks():
    a = assess({**SNAPSHOT, "Channel": "Key Accounts - Food Service"}, [bir()], TODAY)
    assert a["channel"] == "Key Accounts - Food Service" and a["channel_rule"] is None
    assert checks_of(a)["invoice_name"]["label"] == "Invoice Company Name matches the documents"


# ---- contact details only from the customer's own form, never Rare Global Food's own ------
def _cis(phone=None, email=None, other=None):
    fields = {"registered_name": f("JUAN'S MEAT SHOP")}
    if phone:
        fields["phone"] = f(phone)
    if email:
        fields["email"] = f(email)
    d = DocInput("cis", "Credit Application Form.pdf", "CUSTOMER_INFO_SHEET", fields, None, None)
    d.other_fields = other or []
    return d


def _contact_props(a):
    return {p["zoho_field"]: p for p in a["proposals"] if p["zoho_field"] in ("Phone", "Email")}


def test_rare_global_food_letterhead_phone_is_never_proposed():
    """FRUS CORP: 02-886-8579 is RGF's own number on the Credit Application letterhead."""
    letterhead = [{"label": "Telephone Number", "value": "02-886-8579"},
                  {"label": "Email", "value": "info@rareglobalfood.com"}]
    a = assess({**SNAPSHOT, "Phone": None, "Email": None}, [bir(), _cis(other=letterhead)],
               TODAY)
    assert _contact_props(a) == {}


def test_phone_from_another_document_is_not_proposed():
    printed = permit()
    printed.other_fields = [{"label": "Tel. No.", "value": "(046) 431-0000"}]   # city hall
    a = assess({**SNAPSHOT, "Phone": None}, [bir(), printed], TODAY)
    assert "Phone" not in _contact_props(a)


def test_contact_from_the_customer_form_is_proposed():
    a = assess({**SNAPSHOT, "Phone": None, "Email": None},
               [bir(), _cis(phone="0917 555 1234", email="buyer@frus.ph")], TODAY)
    props = _contact_props(a)
    assert props["Phone"]["proposed_value"] == "0917 555 1234"
    assert props["Email"]["proposed_value"] == "buyer@frus.ph"


def test_customer_form_with_rgf_number_in_its_own_field_is_ignored():
    a = assess({**SNAPSHOT, "Phone": None}, [bir(), _cis(phone="(02) 886 8579")], TODAY)
    assert "Phone" not in _contact_props(a)
