"""Detect unusual CPU activity against recent historical patterns."""

import sqlite3

import numpy as np
import pandas as pd

from setup_database import DATABASE_PATH, get_metrics


MINIMUM_HISTORY_HOURS = 21 * 24
RECENT_HOURS = 3 * 24
BASELINE_DAYS = 28
SURGE_THRESHOLD = 0.40
MINIMUM_ABSOLUTE_INCREASE = 15.0


def insufficient_result(instance_id: str) -> dict:
    """Build the standard result for an instance without enough history."""
    return {
        "instance_id": instance_id,
        "surge_risk": False,
        "surge_risk_score": 0.0,
        "insufficient_data": True,
    }


def detect_surge_risk(instance_id: str) -> dict:
    """Compare the latest three days with prior weekday/hour CPU patterns."""
    metrics = get_metrics(instance_id)

    # Require at least three weeks of hourly observations before comparing patterns.
    if len(metrics) < MINIMUM_HISTORY_HOURS:
        return insufficient_result(instance_id)

    metrics = metrics.sort_values("timestamp").copy()
    if metrics["timestamp"].iloc[-1] - metrics["timestamp"].iloc[0] < pd.Timedelta(
        days=21
    ):
        return insufficient_result(instance_id)

    # Use exactly the latest 72 observations as the recent three-day window.
    recent = metrics.tail(RECENT_HOURS).copy()
    recent_start = recent["timestamp"].iloc[0]
    baseline_start = recent_start - pd.Timedelta(days=BASELINE_DAYS)

    # Use the previous 28 days, excluding the recent three days, as the baseline.
    historical = metrics[
        (metrics["timestamp"] >= baseline_start)
        & (metrics["timestamp"] < recent_start)
    ].copy()

    historical["weekday"] = historical["timestamp"].dt.dayofweek
    historical["hour"] = historical["timestamp"].dt.hour
    expected_cpu = (
        historical.groupby(["weekday", "hour"])["cpu_utilization"]
        .mean()
        .rename("expected_cpu")
        .reset_index()
    )

    recent["weekday"] = recent["timestamp"].dt.dayofweek
    recent["hour"] = recent["timestamp"].dt.hour
    comparisons = recent.merge(expected_cpu, on=["weekday", "hour"], how="inner")
    comparisons = comparisons[comparisons["expected_cpu"] > 0]

    if comparisons.empty:
        return insufficient_result(instance_id)

    # A deviation of 0.40 means the actual CPU is 40% above expected.
    deviations = (
        comparisons["cpu_utilization"] / comparisons["expected_cpu"]
    ) - 1
    absolute_increases = (
        comparisons["cpu_utilization"] - comparisons["expected_cpu"]
    )

    # Both the relative and absolute thresholds must be exceeded.
    qualifying = (deviations > SURGE_THRESHOLD) & (
        absolute_increases >= MINIMUM_ABSOLUTE_INCREASE
    )
    surge_risk = bool(qualifying.any())

    if surge_risk:
        worst_deviation = float(deviations[qualifying].max())
    else:
        worst_deviation = 0.0

    # Map 40% over expected to 0.5 and 100% over expected to 1.0.
    if worst_deviation >= SURGE_THRESHOLD:
        score = 0.5 + ((worst_deviation - SURGE_THRESHOLD) / 0.60) * 0.5
        surge_risk_score = float(np.clip(score, 0.0, 1.0))
    else:
        surge_risk_score = 0.0

    return {
        "instance_id": instance_id,
        "surge_risk": surge_risk,
        "surge_risk_score": round(surge_risk_score, 3),
        "insufficient_data": False,
    }


def get_real_instance_ids() -> list[str]:
    """Return real AWS instance IDs stored in the metrics database."""
    with sqlite3.connect(DATABASE_PATH) as connection:
        rows = connection.execute(
            """
            SELECT DISTINCT instance_id
            FROM metrics
            WHERE source = 'real'
            ORDER BY instance_id
            """
        ).fetchall()

    return [row[0] for row in rows]


def print_summary(results: list[dict]) -> None:
    """Print surge detection results in a readable table."""
    print("\nSurge risk summary")
    print(
        f"{'Instance':<24} {'Surge risk':<12} "
        f"{'Risk score':>10}  {'Insufficient data'}"
    )
    print("-" * 70)

    for result in results:
        print(
            f"{result['instance_id']:<24} "
            f"{str(result['surge_risk']):<12} "
            f"{result['surge_risk_score']:>10.3f}  "
            f"{result['insufficient_data']}"
        )


if __name__ == "__main__":
    synthetic_instance_ids = [
        "server_1",
        "server_2",
        "server_3",
        "server_4",
        "server_5",
        "server_6",
    ]
    instance_ids = synthetic_instance_ids + get_real_instance_ids()
    results = [detect_surge_risk(instance_id) for instance_id in instance_ids]
    print_summary(results)
