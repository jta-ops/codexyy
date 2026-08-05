#!/usr/bin/env python3
"""Reconcile local Codexyy plans against canonical Stripe subscriptions."""

import argparse
import json
import os
import sqlite3
import time
import uuid

import httpx

from credential_env import load_credential_environment

load_credential_environment()


def desired_plan(subscription: dict) -> tuple[str, float]:
    if subscription.get("status") not in {"active", "trialing"}:
        return "free", 0.0
    metadata = subscription.get("metadata") or {}
    plan = metadata.get("plan")
    if plan == "pro_max":
        try:
            amount = max(15.0, min(30.0, float(metadata.get("amount", 15))))
        except (TypeError, ValueError):
            amount = 15.0
        return "pro_max", amount
    return "pro", 0.0


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--apply", action="store_true", help="Apply corrections; default is dry-run")
    args = parser.parse_args()
    database = os.environ.get("CODEXYY_DB", "/home/ubuntu/codexyy/data.db")
    stripe_key = os.environ.get("STRIPE_SECRET_KEY", "")
    if not stripe_key:
        print(json.dumps({"status": "blocked", "reason": "stripe_not_configured"}))
        return 2

    checked = corrected = failed = 0
    with sqlite3.connect(database) as db, httpx.Client(timeout=20.0) as client:
        db.row_factory = sqlite3.Row
        users = db.execute(
            "SELECT id,plan,plan_amount,stripe_sub_id FROM users WHERE stripe_sub_id IS NOT NULL AND stripe_sub_id!=''"
        ).fetchall()
        for user in users:
            checked += 1
            response = client.get(
                f"https://api.stripe.com/v1/subscriptions/{user['stripe_sub_id']}",
                auth=(stripe_key, ""),
            )
            if response.status_code == 404:
                subscription = {"status": "missing", "metadata": {}}
            elif response.status_code == 200:
                subscription = response.json()
            else:
                failed += 1
                continue
            plan, amount = desired_plan(subscription)
            local_amount = float(user["plan_amount"] or 0)
            if user["plan"] == plan and (plan != "pro_max" or abs(local_amount - amount) < 0.01):
                continue
            corrected += 1
            db.execute(
                """INSERT INTO subscription_audit
                   (id,user_id,stripe_subscription_id,local_plan,stripe_status,action,created_at)
                   VALUES(?,?,?,?,?,?,?)""",
                (
                    uuid.uuid4().hex,
                    user["id"],
                    user["stripe_sub_id"],
                    user["plan"],
                    str(subscription.get("status") or "unknown"),
                    f"set_{plan}" if args.apply else f"would_set_{plan}",
                    int(time.time()),
                ),
            )
            if args.apply:
                if plan == "free":
                    db.execute(
                        "UPDATE users SET plan='free',plan_amount=0,stripe_sub_id=NULL WHERE id=?",
                        (user["id"],),
                    )
                else:
                    db.execute(
                        "UPDATE users SET plan=?,plan_amount=? WHERE id=?",
                        (plan, amount, user["id"]),
                    )
        db.commit()
    print(json.dumps({
        "status": "ok" if failed == 0 else "degraded",
        "mode": "apply" if args.apply else "dry-run",
        "checked": checked,
        "corrected": corrected,
        "failed": failed,
    }))
    return 0 if failed == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
