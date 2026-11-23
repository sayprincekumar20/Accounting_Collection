"""Set an Account's Customer Status to Active, and confirm it.

With ZOHO_ACTIVATE_FUNCTION set, the engine runs the Zoho function behind the Accounts
"Activate or Inactive" button (functions may change Customer Status where the API user's
profile may not); otherwise it writes the field. It acts only when the Account is not Active
yet (a toggling function can never switch an active account off) and reads the Account back.
"""

from app.assessment.alerts import ACTIVE_VALUE
from app.zoho.client import ZohoClient
from app.zoho.errors import ZohoError


def _status(client: ZohoClient, account_id: str) -> str | None:
    return client.get_record("Accounts", account_id).get("Customer_Status")


def _is_active(value) -> bool:
    return str(value or "").strip().lower() == ACTIVE_VALUE.lower()


def activate_account(client: ZohoClient, account_id: str, settings,
                     triggers: list[str] | None = None) -> tuple[bool, str]:
    """(activated, message). Never raises."""
    try:
        before = _status(client, account_id)
        if _is_active(before):
            return True, "Customer Status already Active"
        function = getattr(settings, "zoho_activate_function", "") or ""
        if function:
            client.execute_function(function, {
                getattr(settings, "zoho_activate_function_arg", "accId") or "accId": account_id})
            how = f"Zoho function {function}"
        else:
            client.update_record("Accounts", account_id, {"Customer_Status": ACTIVE_VALUE},
                                 triggers)
            how = "field update"
        after = _status(client, account_id)
    except ZohoError as exc:
        return False, f"Activation failed: {str(exc)[:300]}"
    if _is_active(after):
        return True, f"Customer Status set to Active ({how})"
    return False, (f"Customer Status could not be set: Zoho kept {after!r} after the {how} "
                   "(check the function, or the field permissions of the API user's profile)")
