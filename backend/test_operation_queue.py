#!/usr/bin/env python3
"""Exercise persistent operation retries and provider circuit transitions."""

import asyncio
import sqlite3
import tempfile

import main


async def wait_for_status(job_id: str, expected: str) -> None:
    for _ in range(100):
        with sqlite3.connect(main.DB) as database:
            row = database.execute("SELECT status FROM operation_jobs WHERE id=?", (job_id,)).fetchone()
        if row and row[0] == expected:
            return
        await asyncio.sleep(0.05)
    raise AssertionError(f"job {job_id} did not reach {expected}")


async def run() -> None:
    original_db = main.DB
    original_send_email = main.send_email
    with tempfile.TemporaryDirectory(prefix="codexyy-queue-test-") as temp:
        main.DB = f"{temp}/queue.db"
        await main.init_db()
        deliveries: list[str] = []

        def accept_email(to: str, *args, **kwargs):
            deliveries.append(to)

        main.send_email = accept_email
        completed = await main.enqueue_operation(
            "email",
            main.email_operation_payload("queue@example.com", "Queue test", "<p>ok</p>", "ok"),
            delay=0,
        )
        worker = asyncio.create_task(main.operation_worker())
        await wait_for_status(completed, "completed")
        assert deliveries == ["queue@example.com"]

        def reject_email(*args, **kwargs):
            raise main.EmailDeliveryError("test rejection")

        main.send_email = reject_email
        failed = await main.enqueue_operation(
            "email",
            main.email_operation_payload("queue@example.com", "Queue test", "<p>fail</p>"),
            delay=0,
        )
        with sqlite3.connect(main.DB) as database:
            database.execute("UPDATE operation_jobs SET attempts=6 WHERE id=?", (failed,))
            database.commit()
        await wait_for_status(failed, "failed")
        worker.cancel()
        try:
            await worker
        except asyncio.CancelledError:
            pass

    main.DB = original_db
    main.send_email = original_send_email
    with main._provider_state_lock:
        main._provider_state.clear()
    for _ in range(4):
        main.provider_failed("test_provider")
    assert not main.provider_available("test_provider")
    main.provider_succeeded("test_provider")
    assert main.provider_available("test_provider")
    print("OPERATION_QUEUE_TEST ok completed terminal_failure circuit_recovery")


if __name__ == "__main__":
    asyncio.run(run())
