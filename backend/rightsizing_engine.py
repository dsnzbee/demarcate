"""Recommend simple EC2 rightsizing changes from stored CPU metrics."""

import json
import sqlite3
from pathlib import Path

import pandas as pd


DATABASE_PATH = Path(__file__).with_name("demarcate.db")
PRICING_PATH = Path(__file__).with_name("instance_pricing.json")

with PRICING_PATH.open() as pricing_file:
    INSTANCE_PRICING = json.load(pricing_file)


def analyze_instance(instance_id: str, current_instance_type: str) -> dict:
    """Analyze an instance's CPU p95 and return a rightsizing recommendation."""
    with sqlite3.connect(DATABASE_PATH) as connection:
        metrics = pd.read_sql_query(
            """
            SELECT cpu_utilization
            FROM metrics
            WHERE instance_id = ?
            """,
            connection,
            params=(instance_id,),
        )

    p95_cpu = metrics["cpu_utilization"].quantile(0.95)
    current_price = INSTANCE_PRICING[current_instance_type]
    smaller_type = current_price["one_size_down"]

    if p95_cpu < 20 and smaller_type is not None:
        recommended_type = smaller_type
        smaller_price = INSTANCE_PRICING[smaller_type]["hourly_price_usd"]
        monthly_savings = (current_price["hourly_price_usd"] - smaller_price) * 730
        recommendation = "downsize"
    else:
        recommended_type = current_instance_type
        monthly_savings = 0.0
        recommendation = "no_change"

    return {
        "instance_id": instance_id,
        "current_type": current_instance_type,
        "recommended_type": recommended_type,
        "p95_cpu_utilization": round(float(p95_cpu), 2),
        "estimated_monthly_savings": round(monthly_savings, 2),
        "recommendation": recommendation,
    }


def get_instance_sources() -> list[tuple[str, str]]:
    """Return each stored instance ID with its data source."""
    with sqlite3.connect(DATABASE_PATH) as connection:
        return connection.execute(
            """
            SELECT
                instance_id,
                CASE
                    WHEN MAX(CASE WHEN source = 'real' THEN 1 ELSE 0 END) = 1
                    THEN 'real'
                    ELSE 'synthetic'
                END AS source
            FROM metrics
            GROUP BY instance_id
            ORDER BY instance_id
            """
        ).fetchall()


def print_results(results: list[dict]) -> None:
    """Print recommendations in a compact table."""
    headers = [
        "Instance",
        "Current",
        "Recommended",
        "CPU p95",
        "Monthly savings",
        "Recommendation",
    ]
    print("\nRightsizing recommendations")
    print(
        f"{headers[0]:<24} {headers[1]:<12} {headers[2]:<14} "
        f"{headers[3]:>8} {headers[4]:>17}  {headers[5]}"
    )
    print("-" * 94)

    for result in results:
        print(
            f"{result['instance_id']:<24} "
            f"{result['current_type']:<12} "
            f"{result['recommended_type']:<14} "
            f"{result['p95_cpu_utilization']:>7.2f}% "
            f"${result['estimated_monthly_savings']:>15.2f}  "
            f"{result['recommendation']}"
        )


if __name__ == "__main__":
    # Real instances use the temporary t3.micro assumption requested for the demo.
    synthetic_types = {
        "server_1": "t3.medium",
        "server_2": "t3.medium",
        "server_3": "t3.large",
        "server_4": "t3.large",
        "server_5": "t3.small",
        "server_6": "t3.medium",
    }

    results = []
    for instance_id, source in get_instance_sources():
        current_type = "t3.micro" if source == "real" else synthetic_types[instance_id]
        results.append(analyze_instance(instance_id, current_type))

    print_results(results)
