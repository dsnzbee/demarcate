"""Generate synthetic EC2 CPU and memory metrics for a demo."""

from pathlib import Path

import numpy as np
import pandas as pd


RANDOM_SEED = 42
OUTPUT_FILE = Path(__file__).with_name("synthetic_metrics.csv")


def generate_data() -> pd.DataFrame:
    """Create 90 days of hourly metrics for six fake servers."""
    rng = np.random.default_rng(RANDOM_SEED)

    # A fixed end date makes the demo output repeatable from run to run.
    end_time = pd.Timestamp("2026-07-17 23:00:00", tz="UTC")
    timestamps = pd.date_range(
        end=end_time,
        periods=90 * 24,
        freq="h",
    )

    # Different servers have different normal operating loads.
    baselines = {
        "server_1": 12,
        "server_2": 25,
        "server_3": 42,
        "server_4": 58,
        "server_5": 32,
        "server_6": 8,
    }

    # Surges are deliberately applied only to server_2, server_4, and server_6.
    surge_events = {
        "server_2": [
            (pd.Timestamp("2026-05-24 10:00:00", tz="UTC"), 8, 90),
            (pd.Timestamp("2026-07-16 08:00:00", tz="UTC"), 10, 87),
        ],
        "server_4": [
            (pd.Timestamp("2026-06-14 08:00:00", tz="UTC"), 7, 94),
        ],
        "server_6": [
            (pd.Timestamp("2026-07-15 12:00:00", tz="UTC"), 8, 91),
        ],
    }

    rows = []
    for instance_id, baseline in baselines.items():
        hours = timestamps.hour.to_numpy()
        weekdays = timestamps.dayofweek.to_numpy()

        # CPU rises during the 9am-6pm workday and falls back at night.
        daytime_shape = np.where(
            (hours >= 9) & (hours <= 18),
            np.sin(np.pi * (hours - 9) / 9),
            0,
        )

        # Weekend traffic is lower than weekday traffic.
        weekend_factor = np.where(weekdays >= 5, 0.55, 1.0)
        daily_effect = 10 * daytime_shape * weekend_factor
        weekend_adjustment = np.where(weekdays >= 5, -2, 0)

        cpu = (
            baseline
            + daily_effect
            + weekend_adjustment
            + rng.normal(0, 2.5, len(timestamps))
        )

        # Inject known, temporary traffic surges for selected servers.
        for surge_start, duration_hours, peak_cpu in surge_events.get(instance_id, []):
            surge_end = surge_start + pd.Timedelta(hours=duration_hours)
            surge_mask = (timestamps >= surge_start) & (timestamps < surge_end)
            surge_progress = np.linspace(0, 1, surge_mask.sum())
            surge_shape = np.sin(np.pi * surge_progress)
            cpu[surge_mask] = (
                cpu[surge_mask] * (1 - surge_shape)
                + peak_cpu * surge_shape
                + rng.normal(0, 1.5, surge_mask.sum())
            )

        cpu = np.clip(cpu, 1, 99)

        # Memory follows CPU loosely, with its own baseline and independent noise.
        memory_baseline = min(baseline + 20, 80)
        memory = (
            memory_baseline
            + 0.35 * (cpu - baseline)
            + rng.normal(0, 4, len(timestamps))
        )
        memory = np.clip(memory, 1, 99)

        rows.extend(
            {
                "instance_id": instance_id,
                "timestamp": timestamp,
                "cpu_utilization": round(float(cpu_value), 2),
                "memory_utilization": round(float(memory_value), 2),
            }
            for timestamp, cpu_value, memory_value in zip(timestamps, cpu, memory)
        )

    return pd.DataFrame(rows)


def main() -> None:
    data = generate_data()
    data.to_csv(OUTPUT_FILE, index=False)

    print(f"Generated {len(data):,} rows in {OUTPUT_FILE.name}")
    print("\nSummary:")
    surge_counts = {
        "server_1": 0,
        "server_2": 2,
        "server_3": 0,
        "server_4": 1,
        "server_5": 0,
        "server_6": 1,
    }

    for instance_id, server_data in data.groupby("instance_id", sort=True):
        average_cpu = server_data["cpu_utilization"].mean()
        print(
            f"{instance_id}: average CPU = {average_cpu:.2f}%, "
            f"surge events = {surge_counts[instance_id]}"
        )


if __name__ == "__main__":
    main()
