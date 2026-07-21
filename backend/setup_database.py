"""Create and populate the DeMarcate SQLite metrics database."""

import sqlite3
from pathlib import Path

import pandas as pd


DATABASE_PATH = Path(__file__).with_name("demarcate.db")
CSV_PATH = Path(__file__).with_name("synthetic_metrics.csv")


def create_database() -> None:
    """Create application tables if they do not already exist."""
    with sqlite3.connect(DATABASE_PATH) as connection:
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS metrics (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                instance_id TEXT NOT NULL,
                timestamp DATETIME NOT NULL,
                cpu_utilization REAL NOT NULL,
                memory_utilization REAL,
                source TEXT NOT NULL CHECK (source IN ('real', 'synthetic'))
            )
            """
        )
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS applied_changes (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                instance_id TEXT NOT NULL,
                old_type TEXT NOT NULL,
                new_type TEXT NOT NULL,
                estimated_monthly_savings REAL NOT NULL,
                applied_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                status TEXT NOT NULL CHECK (status IN ('success', 'failed'))
            )
            """
        )


def load_synthetic_metrics() -> None:
    """Load synthetic CSV rows and tag them as synthetic metrics."""
    synthetic_data = pd.read_csv(CSV_PATH)
    synthetic_data["source"] = "synthetic"

    columns = [
        "instance_id",
        "timestamp",
        "cpu_utilization",
        "memory_utilization",
        "source",
    ]

    with sqlite3.connect(DATABASE_PATH) as connection:
        # Keep setup repeatable without touching any real AWS rows.
        connection.execute("DELETE FROM metrics WHERE source = 'synthetic'")
        synthetic_data[columns].to_sql(
            "metrics",
            connection,
            if_exists="append",
            index=False,
        )


def insert_real_metrics(
    instance_id: str,
    timestamp,
    cpu_utilization: float,
) -> None:
    """Insert one real CloudWatch metric with no memory value."""
    with sqlite3.connect(DATABASE_PATH) as connection:
        connection.execute(
            """
            INSERT INTO metrics (
                instance_id,
                timestamp,
                cpu_utilization,
                memory_utilization,
                source
            )
            VALUES (?, ?, ?, NULL, 'real')
            """,
            (instance_id, timestamp, cpu_utilization),
        )


def replace_real_metrics(instance_id: str, metrics: list[tuple]) -> None:
    """Replace the cached CloudWatch CPU metrics for one AWS instance."""
    with sqlite3.connect(DATABASE_PATH) as connection:
        connection.execute(
            "DELETE FROM metrics WHERE instance_id = ? AND source = 'real'",
            (instance_id,),
        )
        connection.executemany(
            """
            INSERT INTO metrics (
                instance_id,
                timestamp,
                cpu_utilization,
                memory_utilization,
                source
            )
            VALUES (?, ?, ?, NULL, 'real')
            """,
            [
                (instance_id, timestamp, cpu_utilization)
                for timestamp, cpu_utilization in metrics
            ],
        )


def get_metrics(instance_id: str) -> pd.DataFrame:
    """Return all metrics for an instance, sorted chronologically."""
    with sqlite3.connect(DATABASE_PATH) as connection:
        metrics = pd.read_sql_query(
            """
            SELECT
                id,
                instance_id,
                timestamp,
                cpu_utilization,
                memory_utilization,
                source
            FROM metrics
            WHERE instance_id = ?
            ORDER BY timestamp
            """,
            connection,
            params=(instance_id,),
            parse_dates=["timestamp"],
        )

    return metrics


def print_summary() -> None:
    """Print total rows and row counts grouped by data source."""
    with sqlite3.connect(DATABASE_PATH) as connection:
        total_rows = connection.execute("SELECT COUNT(*) FROM metrics").fetchone()[0]
        source_counts = connection.execute(
            """
            SELECT source, COUNT(*)
            FROM metrics
            GROUP BY source
            ORDER BY source
            """
        ).fetchall()

    print(f"Total rows: {total_rows:,}")
    print("Rows by source:")
    for source, count in source_counts:
        print(f"  {source}: {count:,}")


if __name__ == "__main__":
    create_database()
    load_synthetic_metrics()
    print_summary()
