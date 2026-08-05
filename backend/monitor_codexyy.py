#!/usr/bin/env python3
"""Evaluate production health and alert only when the state changes."""

import json
import os
from pathlib import Path
import sqlite3
import time

import httpx

from main import DB, send_email


STATE_PATH = Path("/home/ubuntu/codexyy/monitor-state.json")
ALERT_EMAIL = os.environ.get("CODEXYY_ALERT_EMAIL", "jta@codexyy.dev")


def inspect() -> tuple[dict, list[str]]:
    report: dict = {"checked_at": int(time.time()), "checks": {}}
    problems: list[str] = []
    try:
        health = httpx.get("http://127.0.0.1:8765/healthz", timeout=5.0)
        report["checks"]["health"] = health.status_code
        if health.status_code != 200:
            problems.append(f"health endpoint returned {health.status_code}")
    except Exception as exc:
        report["checks"]["health"] = type(exc).__name__
        problems.append("health endpoint is unreachable")

    try:
        status_response = httpx.get("http://127.0.0.1:8765/api/status", timeout=15.0)
        status_response.raise_for_status()
        public_status = status_response.json()
        report["checks"]["public_status"] = public_status
        if public_status.get("status") != "operational":
            degraded = [
                name for name, value in public_status.get("checks", {}).items()
                if value.get("status") != "operational"
            ]
            problems.append("degraded services: " + ", ".join(degraded))
    except Exception as exc:
        report["checks"]["public_status"] = type(exc).__name__
        problems.append("public status could not be evaluated")

    try:
        metrics_response = httpx.get("http://127.0.0.1:8765/api/internal/metrics", timeout=10.0)
        metrics_response.raise_for_status()
        metrics = metrics_response.json()
        routes = metrics.get("routes", {})
        total_requests = sum(int(item.get("requests", 0)) for item in routes.values())
        total_errors = sum(int(item.get("errors", 0)) for item in routes.values())
        worst_latency = max((float(item.get("latency_ms_max", 0)) for item in routes.values()), default=0.0)
        report["checks"]["traffic"] = {
            "requests": total_requests,
            "errors": total_errors,
            "worst_latency_ms": round(worst_latency, 2),
        }
        if total_requests >= 20 and total_errors / total_requests >= 0.1:
            problems.append("server error rate is at least 10%")
        if worst_latency >= 15_000:
            problems.append("a request exceeded 15 seconds")
    except Exception as exc:
        report["checks"]["traffic"] = type(exc).__name__
        problems.append("internal metrics could not be evaluated")

    try:
        with sqlite3.connect(f"file:{DB}?mode=ro", uri=True) as database:
            failed_jobs = database.execute(
                "SELECT COUNT(*) FROM operation_jobs WHERE status='failed'"
            ).fetchone()[0]
            stalled_jobs = database.execute(
                "SELECT COUNT(*) FROM operation_jobs WHERE status IN ('pending','processing') AND created_at<?",
                (int(time.time()) - 3600,),
            ).fetchone()[0]
            drift_failures = database.execute(
                "SELECT COUNT(*) FROM subscription_audit WHERE action LIKE '%failed%' AND created_at>=?",
                (int(time.time()) - 86400,),
            ).fetchone()[0]
        report["checks"]["operations"] = {
            "failed_jobs": failed_jobs,
            "stalled_jobs": stalled_jobs,
            "subscription_drift_failures_24h": drift_failures,
        }
        if failed_jobs:
            problems.append(f"{failed_jobs} retry job(s) reached terminal failure")
        if stalled_jobs:
            problems.append(f"{stalled_jobs} retry job(s) have been pending over an hour")
        if drift_failures:
            problems.append(f"{drift_failures} subscription reconciliation failure(s) in 24 hours")
    except Exception as exc:
        report["checks"]["operations"] = type(exc).__name__
        problems.append("operation database metrics could not be evaluated")

    report["status"] = "alert" if problems else "ok"
    report["problems"] = problems
    return report, problems


def main() -> int:
    report, problems = inspect()
    previous: dict = {}
    if STATE_PATH.is_file():
        try:
            previous = json.loads(STATE_PATH.read_text())
        except Exception:
            previous = {}
    changed = previous.get("status") not in (None, report["status"])
    first_failure = previous.get("status") is None and bool(problems)
    if changed or first_failure:
        if problems:
            subject = "Codexyy production needs attention"
            summary = "\n".join(f"- {problem}" for problem in problems)
            color = "#ff6b35"
        else:
            subject = "Codexyy production recovered"
            summary = "All automated production checks are operational again."
            color = "#4effa8"
        message_html = (
            '<div style="background:#07070a;padding:32px;color:#e2e2ec;font-family:Arial">'
            '<div style="max-width:600px;margin:auto;padding:40px;border:1px solid #252535;border-radius:16px;background:#0d0d12">'
            '<b>codexyy<span style="color:#00d4ff">.</span> monitor</b>'
            f'<h1 style="color:{color}">{subject}</h1>'
            f'<p style="white-space:pre-wrap;line-height:1.7;color:#b0b0c2">{summary}</p>'
            '<a href="https://codexyy.dev/status" style="color:#00d4ff">Open status →</a>'
            '</div></div>'
        )
        try:
            send_email(ALERT_EMAIL, subject, message_html, summary, "platform@codexyy.dev", "Codexyy Monitor")
            report["alert_delivery"] = "accepted"
        except Exception as exc:
            report["alert_delivery"] = type(exc).__name__
    STATE_PATH.write_text(json.dumps(report, indent=2) + "\n")
    os.chmod(STATE_PATH, 0o600)
    print(json.dumps({"status": report["status"], "problems": len(problems), "alert": report.get("alert_delivery", "unchanged")}))
    return 1 if problems else 0


if __name__ == "__main__":
    raise SystemExit(main())
