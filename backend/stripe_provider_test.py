#!/usr/bin/env python3
"""Run a destructive-safe Stripe test-mode subscription lifecycle.

This script refuses live credentials. It creates only Stripe test objects,
checks a Checkout Session, completes a test subscription, advances a test
clock through renewal, cancels it, and removes the disposable customer.
"""

from __future__ import annotations

import json
import os
import sys
import time
from typing import Any

import httpx

from credential_env import load_credential_environment


API = "https://api.stripe.com/v1"


def require_test_key(value: str) -> str:
    if value.startswith(("sk_live_", "rk_live_")):
        raise ValueError("refusing to run provider lifecycle with a live Stripe key")
    if not value.startswith(("sk_test_", "rk_test_")):
        raise ValueError("STRIPE_TEST_SECRET_KEY must be a Stripe test-mode secret key")
    return value


class StripeTest:
    def __init__(self, key: str):
        self.client = httpx.Client(auth=(key, ""), timeout=30.0)

    def request(self, method: str, path: str, data: dict[str, Any] | None = None) -> dict[str, Any]:
        response = self.client.request(method, API + path, data=data)
        if response.status_code >= 400:
            try:
                code = response.json().get("error", {}).get("code", "stripe_error")
            except ValueError:
                code = "stripe_error"
            raise RuntimeError(f"Stripe test request failed ({response.status_code}, {code})")
        return response.json()

    def wait_clock(self, clock_id: str, timeout: float = 60.0) -> dict[str, Any]:
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            clock = self.request("GET", f"/test_helpers/test_clocks/{clock_id}")
            if clock.get("status") == "ready":
                return clock
            time.sleep(1.0)
        raise RuntimeError("Stripe test clock did not become ready")


def main() -> int:
    load_credential_environment()
    try:
        key = require_test_key(os.environ.get("STRIPE_TEST_SECRET_KEY", ""))
    except ValueError as error:
        print(json.dumps({"status": "blocked", "reason": str(error)}))
        return 2

    stripe = StripeTest(key)
    created: dict[str, str] = {}
    try:
        now = int(time.time())
        clock = stripe.request("POST", "/test_helpers/test_clocks", {"frozen_time": now, "name": "codexyy-production-readiness"})
        created["clock"] = clock["id"]
        customer = stripe.request("POST", "/customers", {"email": "stripe-lifecycle@codexyy.dev", "test_clock": clock["id"], "metadata[test]": "codexyy"})
        created["customer"] = customer["id"]
        payment = stripe.request("POST", "/payment_methods/pm_card_visa/attach", {"customer": customer["id"]})
        stripe.request("POST", f"/customers/{customer['id']}", {"invoice_settings[default_payment_method]": payment["id"]})
        product = stripe.request("POST", "/products", {"name": "Codexyy provider lifecycle test", "metadata[test]": "codexyy"})
        created["product"] = product["id"]
        price = stripe.request("POST", "/prices", {"product": product["id"], "unit_amount": 100, "currency": "usd", "recurring[interval]": "month"})

        checkout = stripe.request("POST", "/checkout/sessions", {
            "mode": "subscription", "customer": customer["id"], "line_items[0][price]": price["id"], "line_items[0][quantity]": 1,
            "success_url": "https://codexyy.dev/dashboard?stripe_test=success", "cancel_url": "https://codexyy.dev/pro?stripe_test=cancel",
        })
        if checkout.get("mode") != "subscription" or checkout.get("status") != "open":
            raise RuntimeError("Stripe test checkout session is not ready")

        subscription = stripe.request("POST", "/subscriptions", {"customer": customer["id"], "items[0][price]": price["id"], "payment_behavior": "error_if_incomplete"})
        created["subscription"] = subscription["id"]
        if subscription.get("status") not in {"active", "trialing"}:
            raise RuntimeError("Stripe test subscription did not activate")
        before = stripe.request("GET", f"/invoices?customer={customer['id']}&limit=10")
        before_paid = len([invoice for invoice in before.get("data", []) if invoice.get("status") == "paid"])

        stripe.request("POST", f"/test_helpers/test_clocks/{clock['id']}/advance", {"frozen_time": now + 32 * 86400})
        stripe.wait_clock(clock["id"])
        after = stripe.request("GET", f"/invoices?customer={customer['id']}&limit=10")
        after_paid = len([invoice for invoice in after.get("data", []) if invoice.get("status") == "paid"])
        if after_paid <= before_paid:
            raise RuntimeError("Stripe test renewal invoice was not paid")

        cancelled = stripe.request("DELETE", f"/subscriptions/{subscription['id']}")
        if not cancelled.get("canceled_at"):
            raise RuntimeError("Stripe test subscription did not cancel")
        print(json.dumps({"status": "ok", "checkout": "open", "subscription": "active", "renewal": "paid", "cancellation": "complete"}))
        return 0
    finally:
        if created.get("subscription"):
            try:
                stripe.request("DELETE", f"/subscriptions/{created['subscription']}")
            except Exception:
                pass
        if created.get("product"):
            try:
                stripe.request("POST", f"/products/{created['product']}", {"active": "false"})
            except Exception:
                pass
        if created.get("customer"):
            try:
                stripe.request("DELETE", f"/customers/{created['customer']}")
            except Exception:
                pass
        if created.get("clock"):
            try:
                stripe.request("DELETE", f"/test_helpers/test_clocks/{created['clock']}")
            except Exception:
                pass
        stripe.client.close()


if __name__ == "__main__":
    raise SystemExit(main())
