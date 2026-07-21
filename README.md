# DeMarcate

DeMarcate is a surge-aware AWS EC2 rightsizing dashboard. It answers a more useful question than “which instances are cheap enough to resize?”:

> Which instances have spare capacity, how much would resizing save, and is it safe to make that decision right now?

The project combines EC2 inventory, CloudWatch CPU metrics, historical baselines, a rightsizing engine, and a surge guardrail. The frontend turns those results into an instance table, charts, savings readout, and clear verdicts.

## What the product does

For every monitored instance, DeMarcate attempts to produce:

1. The current EC2 instance type.
2. The most recent CPU utilization.
3. The p95 CPU utilization across the stored history.
4. A one-size-smaller instance recommendation when sustained usage is low.
5. An estimated monthly saving using the pricing catalog.
6. A surge-risk result based on the instance’s own historical pattern.
7. One final verdict: `safe_to_downsize`, `hold_off`, or `no_change`.

The important design choice is that savings are never shown without the workload context. A resize that looks good on CPU alone can be held back when recent behavior suggests a surge.

## Architecture

```text
                           HTTPS
 GitHub Pages frontend  ───────────────►  Render FastAPI backend
 React + Vite                              Uvicorn
 Recharts                                  boto3
      │                                     │
      │ /instances                          ├── EC2 DescribeInstances
      │ /recommendations                    ├── CloudWatch CPUUtilization
      │ /metrics                            └── SQLite metrics cache
      │
      └──► tables, charts, verdicts, savings, connection status
```

The frontend and backend are deployed independently:

- GitHub Pages hosts the built React application.
- Render hosts the Python/FastAPI API.
- The frontend receives the Render URL through the GitHub Actions variable `VITE_API_URL`.
- The backend stores the local metrics cache in SQLite. On a free Render instance this storage is ephemeral, so a restart can rebuild synthetic data and requires reconnecting AWS.

## Repository map

```text
backend/
  main.py                 FastAPI routes, AWS connection, orchestration
  rightsizing_engine.py   p95 CPU analysis and price calculation
  surge_predictor.py      historical baseline and surge detection
  setup_database.py       SQLite schema and metric persistence
  generate_synthetic_data.py
  synthetic_metrics.csv   bundled demo telemetry
  instance_pricing.json   hourly prices and one-size-down mappings
  requirements.txt        Python dependencies

frontend/src/
  App.jsx                 dashboard state, API loading, tables, charts, actions
  ConnectAWS.jsx          AWS form and background-sync results page
  LearnAWS.jsx            in-product implementation walkthrough
  index.css               visual system and responsive layout
  main.jsx                React entry point

.github/workflows/
  deploy-frontend.yml     Vite build and GitHub Pages deployment

render.yaml               Render backend service definition
```

## The data pipeline

### 1. Demo data is available immediately

`backend/setup_database.py` creates two SQLite tables:

- `metrics`: timestamped CPU and optional memory values.
- `applied_changes`: history for real resize attempts made through the backend endpoint.

On startup, the backend checks whether synthetic rows exist. If they do not, it loads `synthetic_metrics.csv` and marks those rows with `source = 'synthetic'`.

The bundled CSV contains six synthetic workloads with hourly telemetry. This makes the public dashboard useful before an AWS account is connected and gives the chart enough history to demonstrate the surge logic.

### 2. AWS credentials are validated

The connection form sends the following JSON to `POST /connect-aws`:

```json
{
  "aws_access_key_id": "AKIA...",
  "aws_secret_access_key": "...",
  "aws_region": "ap-south-1"
}
```

The backend creates a boto3 session and calls `describe_instances` with bounded network timeouts. A valid response proves that the credentials and region can reach EC2.

The credentials are held in process memory for this session. They are not saved to the database or a file. This is acceptable for a controlled demo, but it is not a production-grade multi-user credential architecture. A production version should use IAM roles, OAuth-style authorization, or short-lived role credentials.

### 3. Inventory and metrics sync in the background

After validation succeeds, `/connect-aws` returns immediately with a `syncing` status. The backend schedules `sync_aws_instances` as a FastAPI background task.

The sync task:

1. Lists running EC2 instances.
2. Records each instance ID and actual instance type.
3. Queries CloudWatch `AWS/EC2` → `CPUUtilization`.
4. Requests the most recent 72 hours with one-hour periods.
5. Replaces the cached real metrics for each instance.
6. Updates `/sync-status` with `syncing`, `ready`, or `error`.

The connection page polls `/sync-status` every two seconds. This prevents the original “loading forever” behavior: credential validation and metric synchronization are now separate operations.

### 4. Memory and traffic limitations

Synthetic rows contain CPU and memory values so the interface can demonstrate both lines. Standard EC2 CloudWatch metrics provide CPU, but not memory. Real memory data requires the CloudWatch agent or another memory telemetry source.

The current surge signal uses CPU as the observed workload signal. It does not directly ingest HTTP request count, network bytes, or load-balancer traffic. Those can be added later as additional metrics in the same pipeline.

## Rightsizing engine

The implementation is in `backend/rightsizing_engine.py`.

### p95 instead of the latest value

The engine reads all stored CPU values for an instance and calculates the 95th percentile:

```text
p95_cpu = 95th percentile of stored CPU utilization
```

Using p95 avoids making a decision from one unusually quiet or noisy sample. It asks whether the workload stays below a high-water mark for most of its history.

### Recommendation threshold

The current rule is:

```text
if p95_cpu < 20% and a smaller type exists:
    recommend one size down
else:
    keep the current type
```

The instance catalog in `backend/instance_pricing.json` defines the one-size-down mapping:

```text
t3.large  → t3.medium
t3.medium → t3.small
t3.small  → t3.micro
t3.micro  → t3.nano
t3.nano   → no smaller mapped type
```

### Savings calculation

For a downsize candidate:

```text
monthly savings =
    (current hourly price - recommended hourly price) × 730
```

Examples from the pricing file:

```text
t3.medium → t3.small
($0.0416 - $0.0208) × 730 = $15.18/month

t3.micro → t3.nano
($0.0104 - $0.0052) × 730 = $3.80/month
```

This is an estimate based on the included price catalog. It does not include taxes, Savings Plans, Reserved Instances, burst-credit behavior, EBS, data transfer, or other AWS charges.

## Surge predictor

The implementation is in `backend/surge_predictor.py`.

The predictor is intentionally instance-specific. It does not compare one server with another; it compares each server with its own historical behavior.

### History windows

The predictor requires at least 21 days of hourly history. It then divides the data into:

- Recent window: the latest 72 observations, representing three days.
- Baseline window: the previous 28 days before the recent window.

For each baseline point, it records the weekday and hour. For example, Monday at 14:00 is compared with previous Monday-at-14:00 observations rather than with the average of every hour.

### Surge qualification

A recent point qualifies as a surge point only when both conditions are true:

```text
actual CPU is more than 40% above expected CPU
AND
actual CPU is at least 15 percentage points above expected CPU
```

This prevents a tiny baseline from turning a small absolute change into an exaggerated surge signal.

The largest relative deviation is mapped to a score from 0 to 1:

- 40% above expected maps to approximately 0.5.
- 100% above expected maps to 1.0.
- The result is clipped to the range 0–1.

If there is not enough history, the result is marked `insufficient_data` and the frontend labels the instance `Data gap`.

## Final verdict logic

`backend/main.py` combines the rightsizing result and surge result in `build_recommendation`:

```text
if rightsizing says no_change:
    final_verdict = no_change
elif rightsizing says downsize and surge risk is active:
    final_verdict = hold_off
else:
    final_verdict = safe_to_downsize
```

### `no_change`

The CPU history does not support going smaller, the instance is already at the bottom of the catalog, or there is no usable metric history.

### `hold_off`

The instance looks oversized from a rightsizing perspective, but the recent-vs-baseline comparison finds a surge signal. The potential saving is still shown as “before guardrail,” while the protected saving remains unavailable.

### `safe_to_downsize`

The p95 threshold supports one size down and no active surge signal was found. This is a recommendation, not an unconditional command to change production infrastructure.

## What the dashboard does with the results

`frontend/src/App.jsx` loads `/instances`, `/recommendations`, and `/capabilities` together.

The dashboard then:

- Joins the latest CPU value from `/instances` onto each recommendation.
- Sorts and filters rows by savings, utilization, and risk.
- Displays the current type, proposed type, CPU, savings, risk badge, and action state.
- Loads selected-instance metrics from `/instances/{instance_id}/metrics`.
- Builds a rolling CPU baseline for the chart from prior points.
- Shows a shaded `SURGE WATCH` area when a surge window is present.
- Separates total potential savings from savings currently allowed by the guardrail.

Synthetic charts are intentionally limited to the latest 72 points so the demo remains visually readable. Real AWS charts use the cached metric history returned by the backend.

## Apply behavior

The project currently uses a demo-safe Apply interaction. In `frontend/src/App.jsx`:

```js
const APPLY_UI_ONLY = true
```

Therefore the Apply button:

1. Appears for AWS-style resize rows.
2. Opens the confirmation popover.
3. Shows the progress state.
4. Displays a success toast saying that no AWS changes were made.
5. Sends no AWS mutation request.

The backend still contains a guarded `/apply-recommendation` endpoint for future live integration. If enabled, a real resize would require stopping the instance, changing its type, starting it again, and waiting for the state transitions. That operation causes downtime and should not be enabled for an untrusted public deployment.

## API reference

| Method | Route | Purpose |
|---|---|---|
| `GET` | `/` | Health check. |
| `GET` | `/capabilities` | Reports whether live mutation support is enabled on the backend. |
| `POST` | `/connect-aws` | Validates credentials and starts a background AWS sync. |
| `GET` | `/sync-status` | Reports connection-sync progress without exposing credentials. |
| `GET` | `/instances` | Returns the monitored instance inventory and latest CPU. |
| `GET` | `/instances/{instance_id}/metrics` | Returns chart-ready CPU and memory points. |
| `GET` | `/recommendations` | Returns rightsizing, surge, savings, and final verdict fields. |
| `GET` | `/history` | Returns stored live resize attempts. |
| `POST` | `/apply-recommendation` | Guarded backend endpoint for a future real resize flow. |

## Local development

### Backend

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```

The API is then available at `http://localhost:8000`.

### Frontend

In a second terminal:

```bash
cd frontend
npm install
npm run dev
```

The Vite development frontend defaults to `http://localhost:8000` for the API. For another backend URL, create `frontend/.env`:

```env
VITE_API_URL=https://your-backend.example.com
```

Useful checks:

```bash
npm run lint
npm run build
```

## Deployment

### Backend on Render

`render.yaml` defines a free Python web service:

- Root directory: `backend`
- Build command: `pip install -r requirements.txt`
- Start command: `uvicorn main:app --host 0.0.0.0 --port $PORT`
- Health check: `/`

After deployment, the backend URL should return this from `/`:

```json
{"status":"DeMarcate API running"}
```

### Frontend on GitHub Pages

`.github/workflows/deploy-frontend.yml` runs on pushes to `main`:

1. Checks out the repository.
2. Installs frontend dependencies.
3. Builds Vite with the `/demarcate/` base path.
4. Uploads `frontend/dist` as a Pages artifact.
5. Deploys the artifact to GitHub Pages.

Set the GitHub Actions repository variable `VITE_API_URL` to the public Render URL when live AWS data is needed. If it is missing, the application deliberately stays in demo mode and displays a warning instead of silently trying to call localhost.

## AWS permissions

For connection and read-only analysis, the credentials need permission to:

- `ec2:DescribeInstances`
- `cloudwatch:GetMetricStatistics`

The current frontend Apply flow is UI-only. If live mutation is ever implemented and enabled, the role would additionally need:

- `ec2:StopInstances`
- `ec2:ModifyInstanceAttribute`
- `ec2:StartInstances`

Use a dedicated least-privilege role, never commit access keys, and avoid sending long-lived keys to a public multi-user application.

## Debugging checklist

### The dashboard shows synthetic rows

Open the site with `?debug=1`. Check:

- `API state` should be `live`, not `demo`.
- `API base` should be the Render URL, not `not configured`.
- The Render service should respond at `/`.
- The GitHub Pages build must have the `VITE_API_URL` Actions variable.

### AWS rows say `Data gap`

The instance was discovered, but no usable metric history was cached. Check the selected region, CloudWatch permissions, Render logs, and whether the requested EC2 instances have been running long enough to produce data.

### The connection page does not finish

The current flow validates first, then polls `/sync-status`. If it reaches `Sync failed`, inspect the backend logs for the region, IAM permissions, or CloudWatch connectivity. The credential validation itself should not wait for every metric query.

### The surge area is missing

The predictor needs at least 21 days of hourly history and matching weekday/hour baseline points. A short dataset is a data limitation, not proof that the workload has no surge risk.

## Known limitations and next improvements

- Credentials are held in one process-global variable; this is not multi-user safe.
- The free Render filesystem and in-memory credential/session state are not durable across restarts.
- Real memory metrics are not collected unless a CloudWatch agent or another source is added.
- Surge detection currently uses CPU as a proxy for traffic; load-balancer request count would improve it.
- The public Apply control is intentionally a no-op demo interaction.
- Pricing is a small static catalog, not a live AWS Pricing API integration.
- A production system should add authentication, per-user sessions, IAM role assumption, audit logging, CSRF protection, and a queue for long-running AWS operations.

## The core idea

DeMarcate is not just a calculator for idle capacity. It is a decision pipeline:

```text
observe usage
    ↓
measure sustained headroom
    ↓
estimate the smaller type and savings
    ↓
compare recent usage with the workload’s own baseline
    ↓
protect against a near-term surge
    ↓
show a verdict with the evidence attached
```

That is how the project turns raw cloud telemetry into a recommendation someone can understand and safely review.
