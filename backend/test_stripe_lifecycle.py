#!/usr/bin/env python3
"""Deterministic local Stripe webhook lifecycle test (no provider writes)."""

import asyncio
import hashlib
import hmac
import json
import sqlite3
import tempfile
import time

import httpx

import main


async def run() -> None:
    original_db = main.DB
    original_webhook_secret = main.STRIPE_WEBHOOK_SECRET
    with tempfile.TemporaryDirectory(prefix="codexyy-stripe-test-") as temp:
        main.DB = f"{temp}/stripe.db"
        main.STRIPE_WEBHOOK_SECRET = "whsec_codexyy_local_test"
        await main.init_db()
        with sqlite3.connect(main.DB) as database:
            database.execute(
                "INSERT INTO users(id,google_id,email,name,plan,created_at) VALUES(?,?,?,?,?,?)",
                ("user_test", "google_test", "stripe-test@example.com", "Stripe Test", "free", int(time.time())),
            )
            database.commit()

        transport = httpx.ASGITransport(app=main.app)
        async with httpx.AsyncClient(transport=transport, base_url="https://codexyy.dev") as client:
            async def deliver(event: dict) -> dict:
                payload = json.dumps(event, separators=(",", ":")).encode()
                timestamp = str(int(time.time()))
                signature = hmac.new(
                    main.STRIPE_WEBHOOK_SECRET.encode(),
                    timestamp.encode() + b"." + payload,
                    hashlib.sha256,
                ).hexdigest()
                response = await client.post(
                    "/api/stripe/webhook",
                    content=payload,
                    headers={
                        "Content-Type": "application/json",
                        "Stripe-Signature": f"t={timestamp},v1={signature}",
                    },
                )
                response.raise_for_status()
                return response.json()

            checkout = {
                "id": "evt_checkout_local", "type": "checkout.session.completed",
                "data": {"object": {
                    "metadata": {"codexyy_user_id": "user_test", "plan": "pro", "amount": "5"},
                    "subscription": "sub_local", "customer": "cus_local",
                }},
            }
            assert (await deliver(checkout))["ok"] is True
            assert (await deliver(checkout))["duplicate"] is True
            with sqlite3.connect(main.DB) as database:
                assert database.execute("SELECT plan FROM users WHERE id='user_test'").fetchone()[0] == "pro"

            renewal = {
                "id": "evt_renewal_local", "type": "customer.subscription.updated",
                "data": {"object": {
                    "id": "sub_local", "status": "active",
                    "metadata": {"plan": "pro_max", "amount": "20"},
                }},
            }
            await deliver(renewal)
            with sqlite3.connect(main.DB) as database:
                plan, amount = database.execute(
                    "SELECT plan,plan_amount FROM users WHERE id='user_test'"
                ).fetchone()
                assert plan == "pro_max" and amount == 20

            cancellation = {
                "id": "evt_cancel_local", "type": "customer.subscription.deleted",
                "data": {"object": {"id": "sub_local"}},
            }
            await deliver(cancellation)
            with sqlite3.connect(main.DB) as database:
                plan, subscription = database.execute(
                    "SELECT plan,stripe_sub_id FROM users WHERE id='user_test'"
                ).fetchone()
                assert plan == "free" and subscription is None

            bad_payload = b'{"id":"evt_bad","type":"customer.subscription.updated"}'
            bad_response = await client.post(
                "/api/stripe/webhook",
                content=bad_payload,
                headers={"Stripe-Signature": f"t={int(time.time())},v1={'0' * 64}"},
            )
            assert bad_response.status_code == 400

    main.DB = original_db
    main.STRIPE_WEBHOOK_SECRET = original_webhook_secret
    print("STRIPE_LIFECYCLE_TEST ok checkout duplicate renewal cancellation signature")


if __name__ == "__main__":
    asyncio.run(run())
