from __future__ import annotations

import logging
import os
import sqlite3
from datetime import datetime, timedelta, timezone
from pathlib import Path

import boto3
import pandas as pd
from botocore.config import Config
from botocore.exceptions import (
    ClientError,
    EndpointConnectionError,
    InvalidRegionError,
    NoCredentialsError,
    NoRegionError,
    PartialCredentialsError,
)
from dotenv import load_dotenv
from fastapi import BackgroundTasks, FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from rightsizing_engine import analyze_instance
from setup_database import (
    DATABASE_PATH,
    create_database,
    get_metrics,
    load_synthetic_metrics,
    replace_real_metrics,
)
from surge_predictor import detect_surge_risk


load_dotenv(Path(__file__).with_name(".env"))
create_database()

# Railway instances can start with a fresh filesystem. Seed the bundled demo
# data when no synthetic rows exist so the public dashboard remains usable.
with sqlite3.connect(DATABASE_PATH) as connection:
    has_synthetic_metrics = connection.execute(
        "SELECT 1 FROM metrics WHERE source = 'synthetic' LIMIT 1"
    ).fetchone()
if not has_synthetic_metrics:
    load_synthetic_metrics()


app = FastAPI(title="DeMarcate API")
logger = logging.getLogger("demarcate")

# Allow the React frontend to call this API from another local port.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


SYNTHETIC_INSTANCE_TYPES = {
    "server_1": "t3.medium",
    "server_2": "t3.medium",
    "server_3": "t3.large",
    "server_4": "t3.large",
    "server_5": "t3.small",
    "server_6": "t3.medium",
}

# Synthetic workloads are always available for the public demo. Real AWS
# instances are added here only after the user connects an AWS account.
INSTANCE_TYPES = dict(SYNTHETIC_INSTANCE_TYPES)
ACTIVE_AWS_INSTANCE_IDS: set[str] = set()
AWS_METRIC_LOOKBACK_HOURS = 72


class AWSCredentials(BaseModel):
    """Credentials submitted by the frontend for a temporary AWS connection."""

    aws_access_key_id: str
    aws_secret_access_key: str
    aws_region: str


class ApplyRecommendationRequest(BaseModel):
    """Request body for applying a fresh, safety-checked resize recommendation."""

    instance_id: str


ENV_AWS_CREDENTIALS = {
    "aws_access_key_id": os.getenv("AWS_ACCESS_KEY_ID"),
    "aws_secret_access_key": os.getenv("AWS_SECRET_ACCESS_KEY"),
    "aws_region": os.getenv("AWS_DEFAULT_REGION"),
}

AWS_MUTATIONS_ENABLED = os.getenv("ENABLE_AWS_MUTATIONS", "false").lower() in {
    "1",
    "true",
    "yes",
    "on",
}

# Hackathon-only shortcut: credentials live in this server process memory and
# are never written to the database or disk. A real product should use an
# OAuth-style flow with IAM role assumption instead of storing raw keys.
ACTIVE_AWS_CREDENTIALS: dict[str, str] | None = None
AWS_SYNC_STATUS = {
    "status": "idle",
    "instance_count": 0,
    "metrics_count": 0,
    "error": None,
}


def get_aws_session() -> boto3.Session:
    """Return a session using connected credentials, or the .env fallback."""
    credentials = ACTIVE_AWS_CREDENTIALS or ENV_AWS_CREDENTIALS
    return boto3.Session(
        aws_access_key_id=credentials["aws_access_key_id"],
        aws_secret_access_key=credentials["aws_secret_access_key"],
        region_name=credentials["aws_region"],
    )


def sync_aws_instances(session: boto3.Session) -> int:
    """Cache running EC2 inventory and the latest 72 hours of CPU metrics."""
    global ACTIVE_AWS_INSTANCE_IDS, AWS_SYNC_STATUS

    AWS_SYNC_STATUS = {
        "status": "syncing",
        "instance_count": 0,
        "metrics_count": 0,
        "error": None,
    }

    try:
        aws_config = Config(
            connect_timeout=10,
            read_timeout=10,
            retries={"max_attempts": 2, "mode": "standard"},
        )
        ec2 = session.client("ec2", config=aws_config)
        cloudwatch = session.client("cloudwatch", config=aws_config)
        discovered_instances = []

        paginator = ec2.get_paginator("describe_instances")
        for page in paginator.paginate(
            Filters=[{"Name": "instance-state-name", "Values": ["running"]}]
        ):
            for reservation in page.get("Reservations", []):
                for instance in reservation.get("Instances", []):
                    discovered_instances.append(
                        {
                            "instance_id": instance["InstanceId"],
                            "instance_type": instance.get("InstanceType", "t3.micro"),
                        }
                    )
                    if len(discovered_instances) >= 50:
                        break
                if len(discovered_instances) >= 50:
                    break
            if len(discovered_instances) >= 50:
                break

        discovered_ids = {instance["instance_id"] for instance in discovered_instances}
        for old_instance_id in ACTIVE_AWS_INSTANCE_IDS - discovered_ids:
            INSTANCE_TYPES.pop(old_instance_id, None)

        end_time = datetime.now(timezone.utc)
        start_time = end_time - timedelta(hours=AWS_METRIC_LOOKBACK_HOURS)
        metrics_count = 0

        for instance in discovered_instances:
            instance_id = instance["instance_id"]
            INSTANCE_TYPES[instance_id] = instance["instance_type"]
            metric_rows = []

            try:
                response = cloudwatch.get_metric_statistics(
                    Namespace="AWS/EC2",
                    MetricName="CPUUtilization",
                    Dimensions=[{"Name": "InstanceId", "Value": instance_id}],
                    StartTime=start_time,
                    EndTime=end_time,
                    Period=3600,
                    Statistics=["Average"],
                )
                metric_rows = [
                    (
                        datapoint["Timestamp"].astimezone(timezone.utc).isoformat(),
                        float(datapoint["Average"]),
                    )
                    for datapoint in response.get("Datapoints", [])
                    if "Timestamp" in datapoint and "Average" in datapoint
                ]
            except (ClientError, EndpointConnectionError) as error:
                # Inventory can still be shown if CloudWatch permission or
                # connectivity is unavailable; those rows remain data-gapped.
                print(
                    f"[connect-aws] Could not load CPU metrics for {instance_id}: {error}",
                    flush=True,
                )

            replace_real_metrics(instance_id, metric_rows)
            metrics_count += len(metric_rows)

        ACTIVE_AWS_INSTANCE_IDS = discovered_ids
        AWS_SYNC_STATUS = {
            "status": "ready",
            "instance_count": len(discovered_instances),
            "metrics_count": metrics_count,
            "error": None,
        }
        return len(discovered_instances)
    except Exception as error:
        AWS_SYNC_STATUS = {
            "status": "error",
            "instance_count": 0,
            "metrics_count": 0,
            "error": "AWS inventory sync failed. Check the credentials, region, IAM permissions, and Render logs.",
        }
        logger.exception("AWS inventory sync failed: %s", error)
        raise


def serialize_metrics(metrics):
    """Convert DataFrame rows into JSON-friendly time-series objects."""
    return [
        {
            "timestamp": row["timestamp"].isoformat(),
            "cpu_utilization": float(row["cpu_utilization"]),
            "memory_utilization": (
                None
                if pd.isna(row["memory_utilization"])
                else float(row["memory_utilization"])
            ),
        }
        for _, row in metrics.iterrows()
    ]


def build_recommendation(instance_id: str, current_type: str) -> dict:
    """Run the same rightsizing and surge analysis used by /recommendations."""
    rightsizing = analyze_instance(instance_id, current_type)
    surge = detect_surge_risk(instance_id)
    result = {**rightsizing, **surge}

    if rightsizing["recommendation"] == "no_change":
        result["final_verdict"] = "no_change"
    elif rightsizing["recommendation"] == "downsize" and surge["surge_risk"]:
        result["final_verdict"] = "hold_off"
        result[
            "warning_message"
        ] = "Surge risk detected in the near term — downsizing is not recommended right now."
    else:
        # Insufficient surge history is treated as no detected surge risk.
        result["final_verdict"] = "safe_to_downsize"

    return result


def record_applied_change(
    instance_id: str,
    old_type: str,
    new_type: str,
    estimated_monthly_savings: float,
    status: str,
) -> None:
    """Persist the result of an attempted instance resize."""
    with sqlite3.connect(DATABASE_PATH) as connection:
        connection.execute(
            """
            INSERT INTO applied_changes (
                instance_id,
                old_type,
                new_type,
                estimated_monthly_savings,
                status
            )
            VALUES (?, ?, ?, ?, ?)
            """,
            (
                instance_id,
                old_type,
                new_type,
                estimated_monthly_savings,
                status,
            ),
        )


@app.get("/")
def root():
    """Return a simple health-check response."""
    return {"status": "DeMarcate API running"}


@app.get("/capabilities")
def capabilities():
    """Expose safe, non-secret runtime capabilities to the frontend."""
    return {"aws_mutations_enabled": AWS_MUTATIONS_ENABLED}


@app.get("/sync-status")
def sync_status():
    """Return the current non-secret AWS inventory sync state."""
    return AWS_SYNC_STATUS


@app.post("/connect-aws")
def connect_aws(credentials: AWSCredentials, background_tasks: BackgroundTasks):
    """Validate and temporarily activate a user's AWS credentials."""
    print(
        f"[connect-aws] Received request for region={credentials.aws_region}",
        flush=True,
    )

    try:
        print("[connect-aws] Creating boto3 session", flush=True)
        session = boto3.Session(
            aws_access_key_id=credentials.aws_access_key_id,
            aws_secret_access_key=credentials.aws_secret_access_key,
            region_name=credentials.aws_region,
        )

        # Keep credential validation bounded. Without explicit timeouts, a
        # stalled network route can make this endpoint appear to hang.
        aws_config = Config(
            connect_timeout=10,
            read_timeout=10,
            retries={"max_attempts": 2, "mode": "standard"},
        )
        ec2 = session.client("ec2", config=aws_config)

        print("[connect-aws] Calling ec2.describe_instances", flush=True)
        response = ec2.describe_instances(MaxResults=5)
        print("[connect-aws] AWS credential validation succeeded", flush=True)
    except ClientError as error:
        error_code = error.response.get("Error", {}).get("Code", "ClientError")
        print(
            f"[connect-aws] AWS rejected the request: {error_code} - {error}",
            flush=True,
        )
        raise HTTPException(
            status_code=401,
            detail=(
                "AWS rejected these credentials or the requested action "
                f"({error_code}). Please check the access key, secret, and permissions."
            ),
        ) from error
    except EndpointConnectionError as error:
        print(f"[connect-aws] AWS endpoint connection failed: {error}", flush=True)
        raise HTTPException(
            status_code=400,
            detail=(
                f"Could not reach the AWS endpoint for region "
                f"'{credentials.aws_region}'. Check the region and network connection."
            ),
        ) from error
    except (InvalidRegionError, NoRegionError, ValueError) as error:
        print(f"[connect-aws] Invalid AWS region: {error}", flush=True)
        raise HTTPException(
            status_code=400,
            detail=(
                f"Invalid AWS region '{credentials.aws_region}'. "
                "Please provide a valid AWS region such as ap-south-1."
            ),
        ) from error
    except (NoCredentialsError, PartialCredentialsError) as error:
        print(f"[connect-aws] Credentials were missing or incomplete: {error}", flush=True)
        raise HTTPException(
            status_code=401,
            detail=(
                "AWS credentials are missing or incomplete. Please provide both "
                "an access key ID and a secret access key."
            ),
        ) from error
    except Exception as error:
        print(f"[connect-aws] Unexpected validation failure: {error}", flush=True)
        raise HTTPException(
            status_code=500,
            detail=f"Unexpected error while validating AWS credentials: {error}",
        ) from error

    global ACTIVE_AWS_CREDENTIALS
    ACTIVE_AWS_CREDENTIALS = credentials.model_dump()

    instance_count = sum(
        len(reservation.get("Instances", []))
        for reservation in response.get("Reservations", [])
    )
    global AWS_SYNC_STATUS
    AWS_SYNC_STATUS = {
        "status": "syncing",
        "instance_count": instance_count,
        "metrics_count": 0,
        "error": None,
    }
    background_tasks.add_task(sync_aws_instances, session)

    return {
        "status": "connected",
        "instance_count": instance_count,
        "sync_status": "syncing",
    }


@app.get("/instances")
def list_instances():
    """Return each instance's type and most recent CPU utilization."""
    # Resolve the active AWS session here so any AWS-backed reads added to this
    # route use /connect-aws credentials, falling back to the .env session.
    get_aws_session()
    instances = []

    for instance_id, current_type in INSTANCE_TYPES.items():
        metrics = get_metrics(instance_id)
        latest_cpu = None if metrics.empty else float(metrics.iloc[-1]["cpu_utilization"])
        instances.append(
            {
                "instance_id": instance_id,
                "current_type": current_type,
                "cpu_utilization": latest_cpu,
            }
        )

    return instances


@app.get("/instances/{instance_id}/metrics")
def instance_metrics(instance_id: str):
    """Return sorted CPU and memory time-series data for one instance."""
    get_aws_session()
    metrics = get_metrics(instance_id)
    return serialize_metrics(metrics)


@app.get("/recommendations")
def recommendations():
    """Return rightsizing and surge-aware recommendations for every instance."""
    get_aws_session()
    return [
        build_recommendation(instance_id, current_type)
        for instance_id, current_type in INSTANCE_TYPES.items()
    ]


@app.get("/history")
def applied_changes_history():
    """Return resize attempts, newest first."""
    with sqlite3.connect(DATABASE_PATH) as connection:
        connection.row_factory = sqlite3.Row
        rows = connection.execute(
            """
            SELECT id, instance_id, old_type, new_type,
                   estimated_monthly_savings, applied_at, status
            FROM applied_changes
            ORDER BY applied_at DESC
            """
        ).fetchall()
    return [dict(row) for row in rows]


@app.post("/apply-recommendation")
def apply_recommendation(request: ApplyRecommendationRequest):
    """Apply a fresh safe resize recommendation to a real EC2 instance.

    EC2 instance type changes require a stop -> modify -> start sequence, so
    this endpoint causes brief, real downtime for the selected instance.
    """
    if not AWS_MUTATIONS_ENABLED:
        raise HTTPException(
            status_code=403,
            detail="AWS resize actions are disabled for this public deployment.",
        )

    instance_id = request.instance_id
    current_type = INSTANCE_TYPES.get(instance_id)

    if current_type is None:
        raise HTTPException(
            status_code=404,
            detail=f"Instance {instance_id} is not in the configured instance mapping.",
        )

    if not instance_id.startswith("i-"):
        raise HTTPException(
            status_code=400,
            detail="Synthetic demo instances cannot be resized through AWS.",
        )

    # Recompute the recommendation immediately before any AWS action. This
    # deliberately ignores any result previously cached by the frontend.
    recommendation = build_recommendation(instance_id, current_type)
    final_verdict = recommendation["final_verdict"]

    if final_verdict != "safe_to_downsize":
        if final_verdict == "hold_off":
            detail = (
                "This instance is flagged as hold_off due to surge risk — "
                "cannot apply."
            )
        else:
            detail = "This instance already has no_change recommended — cannot apply."
        raise HTTPException(status_code=400, detail=detail)

    recommended_type = recommendation["recommended_type"]
    estimated_monthly_savings = recommendation["estimated_monthly_savings"]
    print(
        f"APPLYING RESIZE: {instance_id} from {current_type} to {recommended_type}",
        flush=True,
    )
    logger.info(
        "APPLYING RESIZE: %s from %s to %s",
        instance_id,
        current_type,
        recommended_type,
    )

    completed_steps = []
    waiter_config = {"Delay": 10, "MaxAttempts": 30}

    try:
        ec2 = get_aws_session().client("ec2")

        logger.info("Stopping instance %s", instance_id)
        ec2.stop_instances(InstanceIds=[instance_id])
        completed_steps.append("stop_instances")
        logger.info("Stop request accepted for %s", instance_id)

        logger.info("Waiting for %s to reach stopped state", instance_id)
        ec2.get_waiter("instance_stopped").wait(
            InstanceIds=[instance_id],
            WaiterConfig=waiter_config,
        )
        completed_steps.append("instance_stopped")
        logger.info("Instance %s is stopped", instance_id)

        logger.info(
            "Changing instance %s type from %s to %s",
            instance_id,
            current_type,
            recommended_type,
        )
        ec2.modify_instance_attribute(
            InstanceId=instance_id,
            InstanceType={"Value": recommended_type},
        )
        completed_steps.append("modify_instance_attribute")
        logger.info("Instance %s type changed to %s", instance_id, recommended_type)

        logger.info("Starting instance %s", instance_id)
        ec2.start_instances(InstanceIds=[instance_id])
        completed_steps.append("start_instances")
        logger.info("Start request accepted for %s", instance_id)

        logger.info("Waiting for %s to reach running state", instance_id)
        ec2.get_waiter("instance_running").wait(
            InstanceIds=[instance_id],
            WaiterConfig=waiter_config,
        )
        completed_steps.append("instance_running")
        logger.info("Instance %s is running again", instance_id)
    except Exception as error:
        logger.exception(
            "Resize failed for %s after completed steps: %s",
            instance_id,
            ", ".join(completed_steps) or "none",
        )
        completed = ", ".join(completed_steps) or "none"
        record_applied_change(
            instance_id,
            current_type,
            recommended_type,
            estimated_monthly_savings,
            "failed",
        )
        raise HTTPException(
            status_code=500,
            detail=(
                f"Resize failed for {instance_id} after steps [{completed}]: "
                f"{error}"
            ),
        ) from error

    record_applied_change(
        instance_id,
        current_type,
        recommended_type,
        estimated_monthly_savings,
        "success",
    )

    return {
        "status": "success",
        "instance_id": instance_id,
        "old_type": current_type,
        "new_type": recommended_type,
        "message": "Instance resized successfully",
    }
