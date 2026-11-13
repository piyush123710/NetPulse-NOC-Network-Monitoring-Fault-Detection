# NetPulse NOC — Network Monitoring & Fault Detection System

A full-stack Network Operations Center (NOC) web application for tracking host availability, measuring TCP/ICMP/HTTP response times, detecting connectivity faults automatically, managing incident lifecycles, and running live TCP/IP diagnostics.

---

## Features

### 1. Network Overview & Availability Dashboard
- **Fleet KPIs**: Live network availability percentage, online/degraded/offline host counts, mean response time (RTT in `ms`), active incident counts, and total logged probe samples.
- **Response Time Telemetry**: Interactive SVG time-series chart tracking mean RTT, peak RTT, and interval timeout markers across polling windows.
- **Active Fault Alerting**: Surfaces unresolved critical/high/medium faults with direct links to triage and troubleshooting.

### 2. Device & IP Inventory (`Devices & IPs`)
- **Full CRUD Management**: Add, search, filter (`All`, `Online`, `Degraded`, `Offline`), and remove network hosts by IP address, hostname, subnet CIDR, device type, probe protocol (`TCP`, `ICMP`, `HTTP`), port, location, and latency warning threshold.
- **Per-Device Ping History**: Inspect the last 40 probe results for any device, including timestamps, RTT measurements, and socket/HTTP error details.
- **Fault Simulation Testing**: Switch any device between `Live Probe`, `Simulate Offline`, and `Inject High RTT` to test automated fault detection, incident creation, and recovery workflows on demand.

### 3. Alarm Detection & Incident Management (`Incident Log`)
- **Automated Incident Logging**: Background probes run every 20 seconds and automatically generate timestamped incidents when hosts become unreachable (`offline` → `critical`) or exceed latency thresholds (`degraded` → `medium`).
- **Lifecycle Workflow**: Track incidents from `Open` → `Investigating` → `Resolved` with `detected_at`, `acknowledged_at`, and `resolved_at` timestamps, plus editable Root Cause Analysis and Resolution Notes.
- **Integrated Troubleshooting Timeline**: Execute live Ping checks and TCP Port Scans directly from an active incident and log findings or operator notes to the incident record.

### 4. TCP/IP & IP Addressing Diagnostics (`TCP/IP Diagnostics`)
- **Ping & Response-Time Probe**: Runs a 4-packet ICMP/TCP probe reporting packet loss %, min/avg/max RTT, jitter, and per-packet sequence status.
- **TCP Port Connectivity Scanner**: Concurrently checks standard infrastructure ports (`22, 53, 80, 443, 3000, 3306, 5432, 8080`) or custom port lists, reporting `open`, `closed`, or `timeout` states and RTT.
- **DNS & Reverse PTR Lookup**: Resolves forward `A` (IPv4) and `AAAA` (IPv6) records as well as reverse PTR hostnames with lookup latency.
- **IPv4 Subnet & CIDR Calculator**: Calculates network address, broadcast address, usable host range, total/usable host counts, subnet mask, wildcard mask, binary mask, IP class, and RFC 1918 scope.

### 5. Relational SQL Audit & Schema (`SQL Telemetry`)
- **Probe Audit Log**: Browse the latest 100 persisted connectivity checks and export logs as CSV.
- **SQL Schema Viewer**: Displays live table row counts (`devices`, `ping_logs`, `incidents`, `troubleshooting_logs`) alongside a normalized MySQL-compatible DDL schema.

---

## Tech Stack

- **Frontend**: React 19, TypeScript, Vite 8, Tailwind CSS v4, Lucide React
- **Backend**: Node.js, Express 4, `tsx`
- **Database**: SQLite (`better-sqlite3` in WAL mode with foreign keys enabled)
- **Networking**: Node.js `net.Socket` (TCP handshake timing), `child_process.execFile` (`ping` with TCP fallback), `fetch` (HTTP/HTTPS checks), and `dns/promises`

---

## Project Structure

```text
├── server.ts                       # Express server, SQLite DB, probe engine & REST API
├── index.html                      # Entry HTML & Google Fonts (Plus Jakarta Sans, DM Sans, JetBrains Mono)
├── package.json                    # Scripts and dependencies
├── src/
│   ├── App.tsx                     # Workspace shell, navigation, polling & state handlers
│   ├── types.ts                    # Shared TypeScript interfaces
│   ├── index.css                   # Tailwind CSS v4 theme & tabular numeral styles
│   ├── utils/
│   │   └── network.ts              # IPv4 CIDR subnet math & timestamp formatters
│   └── components/
│       ├── OverviewView.tsx        # Fleet KPIs, alert banner, latency chart & node matrix
│       ├── LatencyChart.tsx        # Interactive SVG response-time chart
│       ├── DevicesView.tsx         # Device inventory, add modal, fault test & history drawer
│       ├── IncidentsView.tsx       # Incident queue, workflow controls & triage timeline
│       ├── DiagnosticsView.tsx     # Ping, TCP port scan, DNS lookup & CIDR calculator
│       ├── DatabaseView.tsx        # SQL audit table, CSV export & MySQL DDL viewer
│       └── StatusIndicators.tsx    # Semantic status and severity indicators
```

---

## Database Schema

Data is persisted locally in `netpulse.db` across four relational tables:

1. **`devices`** — Monitored hosts, IP addresses, hostnames, probe methods (`TCP`, `ICMP`, `HTTP`), ports, CIDR subnets, warning thresholds, current status, RTT, and rolling uptime percentage.
2. **`ping_logs`** — Time-series probe samples (`device_id` FK → `devices.id`), status, `response_time_ms`, `packet_loss_pct`, `probe_detail`, `error_message`, and `checked_at`.
3. **`incidents`** — Fault records (`device_id` FK → `devices.id`), severity (`critical`, `high`, `medium`, `low`), status (`open`, `investigating`, `resolved`), fault type, lifecycle timestamps, root cause, and resolution notes.
4. **`troubleshooting_logs`** — Diagnostic actions and operator triage notes tied to `incident_id` and `device_id`.

---

## API Endpoints

| Method | Endpoint | Description |
| :--- | :--- | :--- |
| `GET` | `/api/overview` | Aggregated KPIs, devices, active incidents, recent logs, and RTT time series |
| `GET` | `/api/devices` | List all monitored devices |
| `POST` | `/api/devices` | Create a new device and run its initial probe |
| `PATCH` | `/api/devices/:id` | Update device configuration |
| `DELETE` | `/api/devices/:id` | Delete a device and cascade its logs/incidents |
| `POST` | `/api/devices/:id/probe` | Probe a single device immediately |
| `POST` | `/api/devices/:id/simulate-fault` | Set fault simulation mode (`none`, `offline`, `latency`) |
| `GET` | `/api/devices/:id/logs` | Retrieve last 40 ping logs for a device |
| `POST` | `/api/probe-all` | Probe all enabled devices concurrently |
| `GET` | `/api/ping-logs` | Fetch recent global ping logs |
| `GET` | `/api/incidents` | List incidents (supports `status` and `severity` query filters) |
| `POST` | `/api/incidents` | Log a manual incident |
| `PATCH` | `/api/incidents/:id` | Update incident status, severity, root cause, or resolution notes |
| `GET` | `/api/incidents/:id/troubleshooting` | Get troubleshooting timeline for an incident |
| `POST` | `/api/incidents/:id/troubleshooting` | Append a diagnostic step or operator note to an incident |
| `POST` | `/api/diagnostics/ping` | Run a live multi-packet ping/TCP RTT test |
| `POST` | `/api/diagnostics/port-scan` | Scan TCP ports on a target host |
| `POST` | `/api/diagnostics/dns` | Perform forward A/AAAA and reverse PTR DNS lookup |
| `GET` | `/api/sql-schema` | Return table row counts and MySQL-compatible DDL |

---

## Getting Started

### Prerequisites
- Node.js 20+
- npm

### Installation & Development

```bash
# Install dependencies
npm install

# Start the full-stack server (Express API + Vite frontend) on port 3000
npm run dev
```

Open `http://localhost:3000` in your browser.

### Verification & Production Build

```bash
# Run TypeScript type checks
npm run lint

# Build the frontend bundle into dist/
npm run build
```

---

## Skills & Concepts Covered
- **Network Monitoring**: Periodic and on-demand availability polling, RTT latency tracking, and rolling uptime calculation.
- **TCP/IP & IP Addressing**: TCP three-way handshake probing, ICMP echo checks, DNS resolution, port scanning, and IPv4 CIDR subnetting.
- **Alarm & Event Detection**: Threshold-based degradation detection (`latency_warn_ms`) and link-down fault triggers.
- **Incident Management & Initial Troubleshooting**: Severity classification, lifecycle timestamps (`detected`, `acknowledged`, `resolved`), root-cause documentation, and integrated diagnostic logging.
