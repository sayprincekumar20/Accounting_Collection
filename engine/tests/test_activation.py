"""Activation through the Zoho function behind the 'Activate or Inactive' button."""

from app.zoho.activation import activate_account
from app.zoho.errors import ZohoAPIError

ACC = "5906238000080840012"


class Fn:
    zoho_activate_function = "activate_or_inactive"
    zoho_activate_function_arg = "accId"


class NoFn:
    zoho_activate_function = ""


class FakeClient:
    def __init__(self, status, function_sets=None, fails=False):
        self.status, self.function_sets, self.fails = status, function_sets, fails
        self.calls, self.updates = [], []

    def get_record(self, module, rid):
        return {"Customer_Status": self.status}

    def execute_function(self, name, args):
        self.calls.append((name, args))
        if self.fails:
            raise ZohoAPIError(400, "function error")
        if self.function_sets:
            self.status = self.function_sets
        return {"code": "success"}

    def update_record(self, module, rid, values, triggers=None):
        self.updates.append(values)


def test_activates_through_the_function_and_reads_back():
    c = FakeClient("Inactive", function_sets="Active")
    ok, msg = activate_account(c, ACC, Fn)
    assert ok and msg == "Customer Status set to Active (Zoho function activate_or_inactive)"
    assert c.calls == [("activate_or_inactive", {"accId": ACC})] and c.updates == []


def test_never_calls_a_toggling_function_on_an_active_account():
    c = FakeClient("Active", function_sets="Inactive")
    ok, msg = activate_account(c, ACC, Fn)
    assert ok and c.calls == [] and msg == "Customer Status already Active"


def test_function_that_did_not_activate_is_reported():
    c = FakeClient("Inactive", function_sets=None)
    ok, msg = activate_account(c, ACC, Fn)
    assert not ok and "Zoho kept 'Inactive' after the Zoho function" in msg


def test_function_error_is_reported():
    ok, msg = activate_account(FakeClient("Inactive", fails=True), ACC, Fn)
    assert not ok and msg.startswith("Activation failed:")


def test_without_a_function_the_field_is_written():
    c = FakeClient("Inactive")
    c.update_record = lambda m, r, v, t=None: setattr(c, "status", v["Customer_Status"])
    ok, msg = activate_account(c, ACC, NoFn)
    assert ok and msg.endswith("(field update)")
