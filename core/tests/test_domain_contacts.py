import pytest

from app.domain.contacts import classify_contact, email_domain_typo, is_ph_mobile

BASE = {"email": "acct@client.ph", "phone": "09171234567", "contact_person": "Ana"}


def codes(**over):
    return [i["code"] for i in classify_contact(**{**BASE, **over})["issues"]]


def test_a_complete_valid_contact_has_nothing_to_fix_and_is_reachable_both_ways():
    assert classify_contact(**BASE) == {"issues": [], "reach": {"email": True, "phone": True}}


def test_no_phone_and_no_email_is_not_reachable():
    r = classify_contact(**{**BASE, "email": "", "phone": ""})
    assert [i["code"] for i in r["issues"]] == ["NO_CONTACT"]
    assert r["reach"] == {"email": False, "phone": False}


def test_email_only_is_flagged_but_still_reachable_by_email():
    r = classify_contact(**{**BASE, "phone": ""})
    assert [i["code"] for i in r["issues"]] == ["NO_MOBILE"]
    assert r["reach"] == {"email": True, "phone": False}


def test_bounced_email_with_a_valid_mobile_is_reachable_by_phone_only():
    r = classify_contact(**BASE, bounce="Email bounced: address not found (Nov 13)")
    assert r["issues"][0]["code"] == "BOUNCED" and r["issues"][0]["detail"] == "address not found (Nov 13)"
    assert r["reach"] == {"email": False, "phone": True}


def test_bounced_email_and_invalid_phone_cannot_be_reached():
    r = classify_contact(**{**BASE, "phone": "63962051595"}, bounce="Email bounced: blocked")
    assert [i["code"] for i in r["issues"]] == ["BOUNCED", "BAD_PHONE"]
    assert r["reach"] == {"email": False, "phone": False}


def test_placeholder_internal_invalid_email_no_person_wrong_person():
    assert codes(email="maukas@fake.com") == ["FAKE_EMAIL"]
    assert codes(email="ar@rareglobalfood.com") == ["INTERNAL_EMAIL"]
    assert codes(email="ana@client") == ["INVALID_EMAIL"]
    assert codes(contact_person="") == ["NO_PERSON"]
    assert codes(wrong_person="Client said wrong person") == ["WRONG_PERSON"]


def test_typo_domains_are_flagged_real_ones_never():
    assert email_domain_typo("SUNRICH123@GMAILLLL.COM") == "gmail.com"
    assert email_domain_typo("a@yahooo.com") == "yahoo.com"
    assert email_domain_typo("a@gmail.con") == "gmail.com"
    assert email_domain_typo("a@hotmial.com") == "hotmail.com"
    for ok in [
        "a@gmail.com",
        "a@mail.com",
        "a@ymail.com",
        "a@live.com",
        "a@yahoo.com.ph",
        "a@armynavy.com.ph",
        "a@sodexo.com",
        "a@accor.com",
    ]:
        assert email_domain_typo(ok) == ""


def test_typo_domain_makes_the_email_unusable():
    r = classify_contact(email="SUNRICH123@GMAILLLL.COM", phone="639173041524", contact_person="Miki Garcia")
    assert r["issues"][0]["code"] == "INVALID_EMAIL" and "typo for @gmail.com" in r["issues"][0]["detail"]
    assert r["reach"] == {"email": False, "phone": True}


@pytest.mark.parametrize(
    "raw,ok",
    [
        ("09171234567", True),
        ("639171234567", True),
        ("9171234567", True),
        ("63962051595", False),
        ("0917", False),
    ],
)
def test_ph_mobile(raw, ok):
    assert is_ph_mobile(raw) is ok
