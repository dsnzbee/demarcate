import os
from datetime import datetime, timedelta, timezone
from pathlib import Path

import boto3
from dotenv import load_dotenv
from setup_database import insert_real_metrics


load_dotenv(Path(__file__).with_name(".env"))

session = boto3.Session(
    aws_access_key_id=os.getenv("AWS_ACCESS_KEY_ID"),
    aws_secret_access_key=os.getenv("AWS_SECRET_ACCESS_KEY"),
    region_name=os.getenv("AWS_DEFAULT_REGION"),
)

ec2 = session.client("ec2")
cloudwatch = session.client("cloudwatch")

# List all currently running EC2 instances.
paginator = ec2.get_paginator("describe_instances")
instance_ids = []

for page in paginator.paginate(
    Filters=[{"Name": "instance-state-name", "Values": ["running"]}]
):
    for reservation in page["Reservations"]:
        for instance in reservation["Instances"]:
            instance_ids.append(instance["InstanceId"])

print("Running EC2 instances:")
for instance_id in instance_ids:
    print(f"- {instance_id}")

# Fetch the average CPU utilization for the last 24 hours in one-hour periods.
end_time = datetime.now(timezone.utc)
start_time = end_time - timedelta(hours=24)
inserted_rows = 0

for instance_id in instance_ids:
    response = cloudwatch.get_metric_statistics(
        Namespace="AWS/EC2",
        MetricName="CPUUtilization",
        Dimensions=[{"Name": "InstanceId", "Value": instance_id}],
        StartTime=start_time,
        EndTime=end_time,
        Period=3600,
        Statistics=["Average"],
    )

    print(f"\nCPU utilization for {instance_id}:")
    for datapoint in sorted(response["Datapoints"], key=lambda point: point["Timestamp"]):
        timestamp = datapoint["Timestamp"].astimezone(timezone.utc)
        insert_real_metrics(
            instance_id,
            timestamp.isoformat(),
            datapoint["Average"],
        )
        inserted_rows += 1
        print(f"  {timestamp:%Y-%m-%d %H:%M:%S UTC} - {datapoint['Average']:.2f}%")

print(f"\nInserted {inserted_rows} real metric rows into demarcate.db.")
