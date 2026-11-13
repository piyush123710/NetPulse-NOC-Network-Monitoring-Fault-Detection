import express from 'express';
import Database from 'better-sqlite3';
import net from 'node:net';
import dns from 'node:dns/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const execFileAsync = promisify(execFile);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT) || 3000;
const DB_PATH = path.join(__dirname, 'netpulse.db');

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// Relational SQL schema (SQLite / MySQL compatible structure)
db.exec(`
  CREATE TABLE IF NOT EXISTS devices (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    ip_address TEXT NOT NULL,
    hostname TEXT,
    device_type TEXT NOT NULL DEFAULT 'Server',
    probe_method TEXT NOT NULL DEFAULT 'TCP',
    port INTEGER NOT NULL DEFAULT 443,
    subnet_cidr TEXT NOT NULL DEFAULT '10.0.0.0/24',
    location TEXT NOT NULL DEFAULT 'Primary DC',
    check_interval_sec INTEGER NOT NULL DEFAULT 20,
    latency_warn_ms INTEGER NOT NULL DEFAULT 180,
    status TEXT NOT NULL DEFAULT 'online',
    last_latency_ms REAL,
    packet_loss_pct REAL NOT NULL DEFAULT 0,
    uptime_pct REAL NOT NULL DEFAULT 100,
    last_error TEXT,
    last_checked_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    fault_simulated TEXT NOT NULL DEFAULT 'none',
    enabled INTEGER NOT NULL DEFAULT 1
  );

  CREATE TABLE IF NOT EXISTS ping_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    device_id INTEGER NOT NULL,
    status TEXT NOT NULL,
    response_time_ms REAL,
    packet_loss_pct REAL NOT NULL DEFAULT 0,
    probe_detail TEXT,
    error_message TEXT,
    checked_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (device_id) REFERENCES devices(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS incidents (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    device_id INTEGER NOT NULL,
    title TEXT NOT NULL,
    description TEXT NOT NULL,
    severity TEXT NOT NULL DEFAULT 'high',
    status TEXT NOT NULL DEFAULT 'open',
    fault_type TEXT NOT NULL DEFAULT 'timeout',
    detected_at TEXT NOT NULL DEFAULT (datetime('now')),
    acknowledged_at TEXT,
    resolved_at TEXT,
    root_cause TEXT,
    resolution_notes TEXT,
    FOREIGN KEY (device_id) REFERENCES devices(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS troubleshooting_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    incident_id INTEGER,
    device_id INTEGER,
    action_type TEXT NOT NULL,
    command_summary TEXT NOT NULL,
    output TEXT NOT NULL,
    performed_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (incident_id) REFERENCES incidents(id) ON DELETE CASCADE,
    FOREIGN KEY (device_id) REFERENCES devices(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_ping_logs_device_time ON ping_logs(device_id, checked_at DESC);
  CREATE INDEX IF NOT EXISTS idx_incidents_status ON incidents(status, detected_at DESC);
`);

interface DeviceRow {
  id: number;
  name: string;
  ip_address: string;
  hostname: string | null;
  device_type: string;
  probe_method: 'TCP' | 'ICMP' | 'HTTP';
  port: number;
  subnet_cidr: string;
  location: string;
  check_interval_sec: number;
  latency_warn_ms: number;
  status: 'online' | 'degraded' | 'offline';
  last_latency_ms: number | null;
  packet_loss_pct: number;
  uptime_pct: number;
  last_error: string | null;
  last_checked_at: string | null;
  created_at: string;
  fault_simulated: 'none' | 'offline' | 'latency';
  enabled: number;
}

const COMMON_PORTS: Record<number, string> = {
  21: 'FTP',
  22: 'SSH',
  25: 'SMTP',
  53: 'DNS',
  80: 'HTTP',
  110: 'POP3',
  143: 'IMAP',
  443: 'HTTPS',
  3000: 'App HTTP',
  3306: 'MySQL',
  5432: 'PostgreSQL',
  6379: 'Redis',
  8080: 'HTTP Alt',
};

function isValidHostOrIp(target: string): boolean {
  const trimmed = target.trim();
  if (!trimmed || trimmed.length > 253) return false;
  if (net.isIP(trimmed) !== 0) return true;
  return /^[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/.test(
    trimmed
  );
}

function nowIso(): string {
  return new Date().toISOString();
}

async function probeTcp(
  host: string,
  port: number,
  timeoutMs = 2500
): Promise<{ success: boolean; latencyMs: number | null; detail: string; error: string | null }> {
  return new Promise((resolve) => {
    const start = process.hrtime.bigint();
    const socket = new net.Socket();
    let settled = false;

    const finish = (
      success: boolean,
      latencyMs: number | null,
      detail: string,
      error: string | null
    ) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve({ success, latencyMs, detail, error });
    };

    socket.setTimeout(timeoutMs);

    socket.once('connect', () => {
      const elapsedMs = Number(process.hrtime.bigint() - start) / 1_000_000;
      finish(true, Math.round(elapsedMs * 100) / 100, `TCP SYN-ACK on port ${port}`, null);
    });

    socket.once('timeout', () => {
      finish(false, null, `TCP timeout after ${timeoutMs}ms on port ${port}`, `ETIMEDOUT (port ${port})`);
    });

    socket.once('error', (err: NodeJS.ErrnoException) => {
      const code = err.code || 'TCP_ERROR';
      finish(false, null, `TCP connect failed (${code})`, `${code}: ${err.message}`);
    });

    socket.connect(port, host);
  });
}

async function probeHttp(
  host: string,
  port: number,
  timeoutMs = 3000
): Promise<{ success: boolean; latencyMs: number | null; detail: string; error: string | null }> {
  const protocol = port === 443 ? 'https' : 'http';
  const portSuffix = (protocol === 'https' && port === 443) || (protocol === 'http' && port === 80) ? '' : `:${port}`;
  const url = `${protocol}://${host}${portSuffix}/`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const start = process.hrtime.bigint();

  try {
    const res = await fetch(url, {
      method: 'HEAD',
      signal: controller.signal,
      redirect: 'follow',
    });
    const elapsedMs = Number(process.hrtime.bigint() - start) / 1_000_000;
    clearTimeout(timer);
    if (res.status >= 500) {
      return {
        success: false,
        latencyMs: Math.round(elapsedMs * 100) / 100,
        detail: `HTTP ${res.status} from ${url}`,
        error: `HTTP_${res.status}`,
      };
    }
    return {
      success: true,
      latencyMs: Math.round(elapsedMs * 100) / 100,
      detail: `HTTP ${res.status} ${res.statusText || 'OK'}`,
      error: null,
    };
  } catch (err) {
    clearTimeout(timer);
    const message = err instanceof Error ? err.message : 'HTTP probe failed';
    return {
      success: false,
      latencyMs: null,
      detail: `HTTP probe failed (${url})`,
      error: message.includes('aborted') ? `ETIMEDOUT (${timeoutMs}ms)` : message,
    };
  }
}

async function probeIcmpWithFallback(
  host: string,
  fallbackPort: number,
  timeoutMs = 2500
): Promise<{
  success: boolean;
  latencyMs: number | null;
  detail: string;
  error: string | null;
  methodUsed: string;
}> {
  if (!isValidHostOrIp(host)) {
    return {
      success: false,
      latencyMs: null,
      detail: 'Invalid host/IP',
      error: 'INVALID_TARGET',
      methodUsed: 'ICMP',
    };
  }

  try {
    const start = process.hrtime.bigint();
    const { stdout } = await execFileAsync('ping', ['-c', '1', '-W', '2', host], {
      timeout: timeoutMs + 500,
    });
    const elapsedMs = Number(process.hrtime.bigint() - start) / 1_000_000;
    const match = stdout.match(/time=([\d.]+)\s*ms/i);
    const rtt = match ? parseFloat(match[1]) : Math.round(elapsedMs * 100) / 100;
    return {
      success: true,
      latencyMs: rtt,
      detail: `ICMP Echo Reply ttl=${stdout.match(/ttl=(\d+)/i)?.[1] ?? '?'}`,
      error: null,
      methodUsed: 'ICMP',
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : '';
    // If ping binary is blocked by container capabilities/permissions, fall back to TCP handshake probe
    const isPermissionOrMissing =
      msg.includes('ENOENT') ||
      msg.includes('Operation not permitted') ||
      msg.includes('socket') ||
      msg.includes('cap_net_raw');

    if (isPermissionOrMissing) {
      const tcpRes = await probeTcp(host, fallbackPort || 443, timeoutMs);
      return {
        ...tcpRes,
        detail: `${tcpRes.detail} (TCP fallback)`,
        methodUsed: 'TCP Fallback',
      };
    }

    // Ping ran and host did not reply; double-check via TCP if port specified
    const tcpFallback = await probeTcp(host, fallbackPort || 80, 1500);
    if (tcpFallback.success) {
      return {
        ...tcpFallback,
        detail: `ICMP blocked, ${tcpFallback.detail}`,
        methodUsed: 'TCP Fallback',
      };
    }
    return {
      success: false,
      latencyMs: null,
      detail: 'ICMP Echo Timeout (100% packet loss)',
      error: 'PING_TIMEOUT',
      methodUsed: 'ICMP',
    };
  }
}

async function runDeviceProbe(device: DeviceRow) {
  const checkedAt = nowIso();
  const target = device.hostname && device.hostname.trim() ? device.hostname.trim() : device.ip_address.trim();

  let success = false;
  let latencyMs: number | null = null;
  let packetLoss = 0;
  let detail = '';
  let errorMsg: string | null = null;

  if (device.fault_simulated === 'offline') {
    success = false;
    latencyMs = null;
    packetLoss = 100;
    detail = 'Simulated link failure active';
    errorMsg = 'SIMULATED_LINK_DOWN: Interface unreachable (100% packet loss)';
  } else if (device.fault_simulated === 'latency') {
    const jitter = Math.round((Math.random() * 140 + 260) * 100) / 100;
    success = true;
    latencyMs = Math.max(device.latency_warn_ms + 95, jitter);
    packetLoss = 25;
    detail = `Simulated congestion on ${device.probe_method}:${device.port}`;
    errorMsg = `High RTT (${latencyMs}ms > ${device.latency_warn_ms}ms threshold)`;
  } else if (device.probe_method === 'HTTP') {
    const res = await probeHttp(target, device.port || 80);
    success = res.success;
    latencyMs = res.latencyMs;
    packetLoss = res.success ? 0 : 100;
    detail = res.detail;
    errorMsg = res.error;
  } else if (device.probe_method === 'ICMP') {
    const res = await probeIcmpWithFallback(target, device.port || 443);
    success = res.success;
    latencyMs = res.latencyMs;
    packetLoss = res.success ? 0 : 100;
    detail = res.detail;
    errorMsg = res.error;
  } else {
    const res = await probeTcp(target, device.port || 443);
    success = res.success;
    latencyMs = res.latencyMs;
    packetLoss = res.success ? 0 : 100;
    detail = res.detail;
    errorMsg = res.error;
  }

  let newStatus: 'online' | 'degraded' | 'offline' = 'online';
  if (!success) {
    newStatus = 'offline';
  } else if (
    (latencyMs !== null && latencyMs > device.latency_warn_ms) ||
    packetLoss > 0
  ) {
    newStatus = 'degraded';
  }

  // Insert ping log
  const insertLog = db.prepare(`
    INSERT INTO ping_logs (device_id, status, response_time_ms, packet_loss_pct, probe_detail, error_message, checked_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  insertLog.run(device.id, newStatus, latencyMs, packetLoss, detail, errorMsg, checkedAt);

  // Recalculate rolling uptime from last 100 checks
  const stats = db
    .prepare(
      `SELECT
        COUNT(*) as total,
        SUM(CASE WHEN status != 'offline' THEN 1 ELSE 0 END) as up_count
      FROM (
        SELECT status FROM ping_logs WHERE device_id = ? ORDER BY id DESC LIMIT 100
      )`
    )
    .get(device.id) as { total: number; up_count: number };

  const uptimePct =
    stats.total > 0 ? Math.round((stats.up_count / stats.total) * 1000) / 10 : 100;

  db.prepare(`
    UPDATE devices
    SET status = ?, last_latency_ms = ?, packet_loss_pct = ?, uptime_pct = ?, last_error = ?, last_checked_at = ?
    WHERE id = ?
  `).run(newStatus, latencyMs, packetLoss, uptimePct, errorMsg, checkedAt, device.id);

  // Fault detection & automatic incident logging
  let createdIncidentId: number | null = null;
  const activeIncident = db
    .prepare(
      `SELECT id, severity, status FROM incidents WHERE device_id = ? AND status != 'resolved' ORDER BY id DESC LIMIT 1`
    )
    .get(device.id) as { id: number; severity: string; status: string } | undefined;

  if (newStatus === 'offline' && !activeIncident) {
    const res = db
      .prepare(
        `INSERT INTO incidents (device_id, title, description, severity, status, fault_type, detected_at)
         VALUES (?, ?, ?, 'critical', 'open', ?, ?)`
      )
      .run(
        device.id,
        `Connectivity Lost: ${device.name} (${device.ip_address})`,
        `Automated ${device.probe_method} probe on port ${device.port} failed. Error: ${errorMsg || 'Host unreachable'}`,
        errorMsg?.includes('REFUSED') ? 'connection_refused' : 'timeout',
        checkedAt
      );
    createdIncidentId = Number(res.lastInsertRowid);
  } else if (newStatus === 'degraded' && !activeIncident) {
    const res = db
      .prepare(
        `INSERT INTO incidents (device_id, title, description, severity, status, fault_type, detected_at)
         VALUES (?, ?, ?, 'medium', 'open', 'high_latency', ?)`
      )
      .run(
        device.id,
        `High Response Latency: ${device.name} (${device.ip_address})`,
        `Measured RTT ${latencyMs}ms exceeded warning threshold of ${device.latency_warn_ms}ms (${detail}).`,
        checkedAt
      );
    createdIncidentId = Number(res.lastInsertRowid);
  }

  // Prune old ping logs beyond 1500 total rows to keep DB fast
  db.prepare(
    `DELETE FROM ping_logs WHERE id NOT IN (SELECT id FROM ping_logs ORDER BY id DESC LIMIT 1500)`
  ).run();

  const updatedDevice = db.prepare(`SELECT * FROM devices WHERE id = ?`).get(device.id) as DeviceRow;
  return {
    device: updatedDevice,
    createdIncidentId,
    sample: {
      device_id: device.id,
      status: newStatus,
      response_time_ms: latencyMs,
      packet_loss_pct: packetLoss,
      probe_detail: detail,
      error_message: errorMsg,
      checked_at: checkedAt,
    },
  };
}

function seedInitialData() {
  const count = (db.prepare(`SELECT COUNT(*) as c FROM devices`).get() as { c: number }).c;
  if (count > 0) return;

  const insertDevice = db.prepare(`
    INSERT INTO devices (
      name, ip_address, hostname, device_type, probe_method, port, subnet_cidr, location,
      check_interval_sec, latency_warn_ms, status, last_latency_ms, packet_loss_pct, uptime_pct,
      last_error, last_checked_at, fault_simulated, enabled
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
  `);

  const now = Date.now();
  const seededDevices = [
    {
      name: 'Local Loopback Gateway',
      ip: '127.0.0.1',
      host: 'localhost',
      type: 'Gateway',
      method: 'TCP',
      port: PORT,
      cidr: '127.0.0.0/8',
      location: 'Host Loopback',
      warn: 50,
      status: 'online',
      lat: 1.2,
      uptime: 100,
      err: null,
    },
    {
      name: 'Google Public DNS',
      ip: '8.8.8.8',
      host: '8.8.8.8',
      type: 'DNS Resolver',
      method: 'TCP',
      port: 53,
      cidr: '8.8.8.0/24',
      location: 'External WAN',
      warn: 120,
      status: 'online',
      lat: 14.8,
      uptime: 100,
      err: null,
    },
    {
      name: 'Cloudflare Anycast Edge',
      ip: '1.1.1.1',
      host: '1.1.1.1',
      type: 'Edge DNS',
      method: 'TCP',
      port: 443,
      cidr: '1.1.1.0/24',
      location: 'External Anycast',
      warn: 120,
      status: 'online',
      lat: 11.4,
      uptime: 100,
      err: null,
    },
    {
      name: 'Quad9 Security Resolver',
      ip: '9.9.9.9',
      host: '9.9.9.9',
      type: 'Firewall DNS',
      method: 'TCP',
      port: 53,
      cidr: '9.9.9.0/24',
      location: 'Perimeter Transit',
      warn: 150,
      status: 'online',
      lat: 21.6,
      uptime: 99.4,
      err: null,
    },
    {
      name: 'GitHub Upstream Relay',
      ip: '140.82.121.4',
      host: 'github.com',
      type: 'Cloud Relay',
      method: 'HTTP',
      port: 443,
      cidr: '140.82.112.0/20',
      location: 'US-East Upstream',
      warn: 250,
      status: 'online',
      lat: 42.5,
      uptime: 100,
      err: null,
    },
    {
      name: 'DMZ Web Portal Node',
      ip: '93.184.216.34',
      host: 'example.com',
      type: 'Web Server',
      method: 'HTTP',
      port: 80,
      cidr: '93.184.216.0/24',
      location: 'DMZ Segment B',
      warn: 250,
      status: 'online',
      lat: 38.2,
      uptime: 99.8,
      err: null,
    },
    {
      name: 'Core Switch SW-01 (Branch)',
      ip: '10.20.1.254',
      host: null,
      type: 'Core Switch',
      method: 'TCP',
      port: 22,
      cidr: '10.20.1.0/24',
      location: 'MDF Closet 1',
      warn: 80,
      status: 'offline',
      lat: null,
      uptime: 83.3,
      err: 'ETIMEDOUT (port 22)',
    },
  ];

  const insertPing = db.prepare(`
    INSERT INTO ping_logs (device_id, status, response_time_ms, packet_loss_pct, probe_detail, error_message, checked_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  const deviceIds: number[] = [];
  for (const d of seededDevices) {
    const info = insertDevice.run(
      d.name,
      d.ip,
      d.host,
      d.type,
      d.method,
      d.port,
      d.cidr,
      d.location,
      20,
      d.warn,
      d.status,
      d.lat,
      d.status === 'offline' ? 100 : 0,
      d.uptime,
      d.err,
      new Date(now - 15_000).toISOString(),
      'none'
    );
    const devId = Number(info.lastInsertRowid);
    deviceIds.push(devId);

    // Seed 12 historical samples per device (12 mins -> now)
    for (let i = 11; i >= 0; i--) {
      const ts = new Date(now - i * 60_000).toISOString();
      const isFail = d.status === 'offline' && i < 3;
      const base = d.lat ?? 18;
      const sampleLat = isFail ? null : Math.round((base + (Math.random() - 0.5) * Math.min(base * 0.25, 8)) * 100) / 100;
      insertPing.run(
        devId,
        isFail ? 'offline' : 'online',
        sampleLat,
        isFail ? 100 : 0,
        isFail ? `TCP timeout after 2500ms on port ${d.port}` : `${d.method} check OK`,
        isFail ? `ETIMEDOUT (port ${d.port})` : null,
        ts
      );
    }
  }

  // Seed 1 active incident for Core Switch SW-01 and 1 resolved historical incident for Quad9
  const swId = deviceIds[6];
  const quad9Id = deviceIds[3];

  const inc1 = db
    .prepare(
      `INSERT INTO incidents (device_id, title, description, severity, status, fault_type, detected_at)
       VALUES (?, ?, ?, 'critical', 'open', 'timeout', ?)`
    )
    .run(
      swId,
      'Connectivity Lost: Core Switch SW-01 (Branch) (10.20.1.254)',
      'Automated TCP probe on port 22 timed out across 3 consecutive intervals. Branch VLAN 20 unreachable from monitoring gateway.',
      new Date(now - 180_000).toISOString()
    );

  db.prepare(
    `INSERT INTO troubleshooting_logs (incident_id, device_id, action_type, command_summary, output, performed_at)
     VALUES (?, ?, 'tcp_port_scan', 'TCP Probe 10.20.1.254:22,80,443', 'Port 22: TIMEOUT (2500ms) | Port 80: TIMEOUT | Port 443: TIMEOUT', ?)`
  ).run(Number(inc1.lastInsertRowid), swId, new Date(now - 120_000).toISOString());

  db.prepare(
    `INSERT INTO incidents (device_id, title, description, severity, status, fault_type, detected_at, acknowledged_at, resolved_at, root_cause, resolution_notes)
     VALUES (?, ?, ?, 'medium', 'resolved', 'high_latency', ?, ?, ?, ?, ?)`
  ).run(
    quad9Id,
    'High Response Latency: Quad9 Security Resolver (9.9.9.9)',
    'Measured RTT 214.6ms exceeded warning threshold of 150ms during upstream BGP convergence.',
    new Date(now - 3_600_000).toISOString(),
    new Date(now - 3_480_000).toISOString(),
    new Date(now - 3_120_000).toISOString(),
    'Upstream transit route flap caused temporary suboptimal routing.',
    'Path reconverged automatically; verified RTT stabilized at 21ms.'
  );
}

seedInitialData();

let isProbingAll = false;
async function probeAllEnabledDevices() {
  if (isProbingAll) return [];
  isProbingAll = true;
  try {
    const devices = db.prepare(`SELECT * FROM devices WHERE enabled = 1`).all() as DeviceRow[];
    const results = await Promise.all(devices.map((d) => runDeviceProbe(d)));
    return results;
  } finally {
    isProbingAll = false;
  }
}

async function startServer() {
  const app = express();
  app.use(express.json());

  // Overview endpoint
  app.get('/api/overview', (_req, res) => {
    const devices = db.prepare(`SELECT * FROM devices ORDER BY id ASC`).all() as DeviceRow[];
    const totalDevices = devices.length;
    const onlineDevices = devices.filter((d) => d.status === 'online').length;
    const degradedDevices = devices.filter((d) => d.status === 'degraded').length;
    const offlineDevices = devices.filter((d) => d.status === 'offline').length;

    const availabilityPct =
      totalDevices > 0
        ? Math.round((devices.reduce((acc, d) => acc + d.uptime_pct, 0) / totalDevices) * 10) / 10
        : 100;

    const responsiveDevices = devices.filter((d) => d.last_latency_ms !== null);
    const avgLatencyMs =
      responsiveDevices.length > 0
        ? Math.round(
            (responsiveDevices.reduce((acc, d) => acc + (d.last_latency_ms || 0), 0) /
              responsiveDevices.length) *
              10
          ) / 10
        : 0;

    const openIncidentsRow = db
      .prepare(
        `SELECT
          COUNT(*) as open_count,
          SUM(CASE WHEN severity = 'critical' THEN 1 ELSE 0 END) as critical_count
         FROM incidents WHERE status != 'resolved'`
      )
      .get() as { open_count: number; critical_count: number | null };

    const totalChecksRow = db.prepare(`SELECT COUNT(*) as c FROM ping_logs`).get() as { c: number };

    const recentLogs = db
      .prepare(
        `SELECT p.*, d.name as device_name, d.ip_address
         FROM ping_logs p
         JOIN devices d ON d.id = p.device_id
         ORDER BY p.id DESC LIMIT 25`
      )
      .all();

    const activeIncidents = db
      .prepare(
        `SELECT i.*, d.name as device_name, d.ip_address as device_ip, d.device_type
         FROM incidents i
         JOIN devices d ON d.id = i.device_id
         WHERE i.status != 'resolved'
         ORDER BY
           CASE i.severity WHEN 'critical' THEN 1 WHEN 'high' THEN 2 WHEN 'medium' THEN 3 ELSE 4 END,
           i.id DESC`
      )
      .all();

    // Aggregate time-series for latency chart across last 20 time buckets
    const latencySeries = db
      .prepare(
        `SELECT
          substr(checked_at, 1, 16) as checked_at,
          ROUND(AVG(CASE WHEN response_time_ms IS NOT NULL THEN response_time_ms END), 2) as avg_ms,
          ROUND(MAX(CASE WHEN response_time_ms IS NOT NULL THEN response_time_ms ELSE 0 END), 2) as max_ms,
          SUM(CASE WHEN status = 'offline' THEN 1 ELSE 0 END) as failures
         FROM ping_logs
         GROUP BY substr(checked_at, 1, 16)
         ORDER BY checked_at DESC
         LIMIT 20`
      )
      .all()
      .reverse();

    res.json({
      summary: {
        totalDevices,
        onlineDevices,
        degradedDevices,
        offlineDevices,
        availabilityPct,
        avgLatencyMs,
        openIncidents: openIncidentsRow.open_count,
        criticalIncidents: openIncidentsRow.critical_count || 0,
        totalChecksLogged: totalChecksRow.c,
      },
      devices,
      recentLogs,
      activeIncidents,
      latencySeries,
    });
  });

  // Devices CRUD
  app.get('/api/devices', (_req, res) => {
    const devices = db.prepare(`SELECT * FROM devices ORDER BY id ASC`).all();
    res.json(devices);
  });

  app.post('/api/devices', async (req, res) => {
    const {
      name,
      ip_address,
      hostname,
      device_type = 'Server',
      probe_method = 'TCP',
      port = 443,
      subnet_cidr = '10.0.0.0/24',
      location = 'Core Network',
      latency_warn_ms = 180,
    } = req.body || {};

    if (!name || !ip_address) {
      return res.status(400).json({ error: 'Device name and IP address are required.' });
    }
    if (!isValidHostOrIp(ip_address)) {
      return res.status(400).json({ error: 'Invalid IP address or hostname format.' });
    }
    if (hostname && !isValidHostOrIp(hostname)) {
      return res.status(400).json({ error: 'Invalid hostname format.' });
    }

    const validMethod = ['TCP', 'ICMP', 'HTTP'].includes(probe_method) ? probe_method : 'TCP';
    const parsedPort = Math.min(65535, Math.max(1, Number(port) || 443));
    const parsedWarn = Math.max(10, Number(latency_warn_ms) || 180);

    const info = db
      .prepare(
        `INSERT INTO devices (
          name, ip_address, hostname, device_type, probe_method, port, subnet_cidr, location,
          latency_warn_ms, status, uptime_pct
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'online', 100)`
      )
      .run(
        String(name).trim(),
        String(ip_address).trim(),
        hostname ? String(hostname).trim() : null,
        String(device_type),
        validMethod,
        parsedPort,
        String(subnet_cidr).trim(),
        String(location).trim(),
        parsedWarn
      );

    const device = db
      .prepare(`SELECT * FROM devices WHERE id = ?`)
      .get(Number(info.lastInsertRowid)) as DeviceRow;

    const probeResult = await runDeviceProbe(device);
    res.status(201).json(probeResult.device);
  });

  app.patch('/api/devices/:id', (req, res) => {
    const id = Number(req.params.id);
    const existing = db.prepare(`SELECT * FROM devices WHERE id = ?`).get(id) as DeviceRow | undefined;
    if (!existing) return res.status(404).json({ error: 'Device not found' });

    const {
      name = existing.name,
      ip_address = existing.ip_address,
      hostname = existing.hostname,
      device_type = existing.device_type,
      probe_method = existing.probe_method,
      port = existing.port,
      subnet_cidr = existing.subnet_cidr,
      location = existing.location,
      latency_warn_ms = existing.latency_warn_ms,
      enabled = existing.enabled,
    } = req.body || {};

    if (!isValidHostOrIp(ip_address)) {
      return res.status(400).json({ error: 'Invalid IP address or hostname.' });
    }

    db.prepare(
      `UPDATE devices
       SET name = ?, ip_address = ?, hostname = ?, device_type = ?, probe_method = ?,
           port = ?, subnet_cidr = ?, location = ?, latency_warn_ms = ?, enabled = ?
       WHERE id = ?`
    ).run(
      String(name).trim(),
      String(ip_address).trim(),
      hostname ? String(hostname).trim() : null,
      String(device_type),
      ['TCP', 'ICMP', 'HTTP'].includes(probe_method) ? probe_method : existing.probe_method,
      Math.min(65535, Math.max(1, Number(port) || existing.port)),
      String(subnet_cidr).trim(),
      String(location).trim(),
      Math.max(10, Number(latency_warn_ms) || existing.latency_warn_ms),
      enabled ? 1 : 0,
      id
    );

    res.json(db.prepare(`SELECT * FROM devices WHERE id = ?`).get(id));
  });

  app.delete('/api/devices/:id', (req, res) => {
    const id = Number(req.params.id);
    const info = db.prepare(`DELETE FROM devices WHERE id = ?`).run(id);
    if (info.changes === 0) return res.status(404).json({ error: 'Device not found' });
    res.json({ deleted: true, id });
  });

  app.post('/api/devices/:id/probe', async (req, res) => {
    const id = Number(req.params.id);
    const device = db.prepare(`SELECT * FROM devices WHERE id = ?`).get(id) as DeviceRow | undefined;
    if (!device) return res.status(404).json({ error: 'Device not found' });
    const result = await runDeviceProbe(device);
    res.json(result);
  });

  app.post('/api/devices/:id/simulate-fault', async (req, res) => {
    const id = Number(req.params.id);
    const device = db.prepare(`SELECT * FROM devices WHERE id = ?`).get(id) as DeviceRow | undefined;
    if (!device) return res.status(404).json({ error: 'Device not found' });

    const mode = req.body?.mode;
    if (!['none', 'offline', 'latency'].includes(mode)) {
      return res.status(400).json({ error: 'Invalid simulation mode' });
    }

    db.prepare(`UPDATE devices SET fault_simulated = ? WHERE id = ?`).run(mode, id);
    const updated = db.prepare(`SELECT * FROM devices WHERE id = ?`).get(id) as DeviceRow;
    const probeResult = await runDeviceProbe(updated);
    res.json(probeResult);
  });

  app.get('/api/devices/:id/logs', (req, res) => {
    const id = Number(req.params.id);
    const logs = db
      .prepare(`SELECT * FROM ping_logs WHERE device_id = ? ORDER BY id DESC LIMIT 40`)
      .all(id);
    res.json(logs);
  });

  app.post('/api/probe-all', async (_req, res) => {
    const results = await probeAllEnabledDevices();
    res.json({ probed: results.length, results });
  });

  app.get('/api/ping-logs', (req, res) => {
    const limit = Math.min(200, Math.max(10, Number(req.query.limit) || 60));
    const logs = db
      .prepare(
        `SELECT p.*, d.name as device_name, d.ip_address
         FROM ping_logs p
         JOIN devices d ON d.id = p.device_id
         ORDER BY p.id DESC
         LIMIT ?`
      )
      .all(limit);
    res.json(logs);
  });

  // Incidents & Troubleshooting
  app.get('/api/incidents', (req, res) => {
    const status = typeof req.query.status === 'string' ? req.query.status : '';
    const severity = typeof req.query.severity === 'string' ? req.query.severity : '';

    let query = `
      SELECT i.*, d.name as device_name, d.ip_address as device_ip, d.device_type
      FROM incidents i
      JOIN devices d ON d.id = i.device_id
      WHERE 1=1
    `;
    const params: string[] = [];

    if (status && status !== 'all') {
      query += ` AND i.status = ?`;
      params.push(status);
    }
    if (severity && severity !== 'all') {
      query += ` AND i.severity = ?`;
      params.push(severity);
    }
    query += ` ORDER BY i.id DESC`;

    const rows = db.prepare(query).all(...params);
    res.json(rows);
  });

  app.post('/api/incidents', (req, res) => {
    const { device_id, title, description, severity = 'high', fault_type = 'manual_report' } = req.body || {};
    if (!device_id || !title || !description) {
      return res.status(400).json({ error: 'device_id, title, and description are required.' });
    }
    const validSev = ['critical', 'high', 'medium', 'low'].includes(severity) ? severity : 'high';
    const info = db
      .prepare(
        `INSERT INTO incidents (device_id, title, description, severity, status, fault_type, detected_at)
         VALUES (?, ?, ?, ?, 'open', ?, ?)`
      )
      .run(Number(device_id), String(title).trim(), String(description).trim(), validSev, String(fault_type), nowIso());

    const row = db
      .prepare(
        `SELECT i.*, d.name as device_name, d.ip_address as device_ip, d.device_type
         FROM incidents i JOIN devices d ON d.id = i.device_id WHERE i.id = ?`
      )
      .get(Number(info.lastInsertRowid));
    res.status(201).json(row);
  });

  app.patch('/api/incidents/:id', (req, res) => {
    const id = Number(req.params.id);
    const existing = db.prepare(`SELECT * FROM incidents WHERE id = ?`).get(id) as
      | {
          id: number;
          status: string;
          severity: string;
          acknowledged_at: string | null;
          resolved_at: string | null;
          root_cause: string | null;
          resolution_notes: string | null;
        }
      | undefined;
    if (!existing) return res.status(404).json({ error: 'Incident not found' });

    const {
      status = existing.status,
      severity = existing.severity,
      root_cause = existing.root_cause,
      resolution_notes = existing.resolution_notes,
    } = req.body || {};

    const validStatus = ['open', 'investigating', 'resolved'].includes(status) ? status : existing.status;
    const validSeverity = ['critical', 'high', 'medium', 'low'].includes(severity)
      ? severity
      : existing.severity;

    const now = nowIso();
    let ackAt = existing.acknowledged_at;
    let resAt = existing.resolved_at;

    if (validStatus === 'investigating' && !ackAt) ackAt = now;
    if (validStatus === 'resolved') {
      if (!ackAt) ackAt = now;
      if (!resAt) resAt = now;
    } else if (validStatus !== 'resolved') {
      resAt = null;
    }

    db.prepare(
      `UPDATE incidents
       SET status = ?, severity = ?, acknowledged_at = ?, resolved_at = ?, root_cause = ?, resolution_notes = ?
       WHERE id = ?`
    ).run(validStatus, validSeverity, ackAt, resAt, root_cause ?? null, resolution_notes ?? null, id);

    const updated = db
      .prepare(
        `SELECT i.*, d.name as device_name, d.ip_address as device_ip, d.device_type
         FROM incidents i JOIN devices d ON d.id = i.device_id WHERE i.id = ?`
      )
      .get(id);
    res.json(updated);
  });

  app.get('/api/incidents/:id/troubleshooting', (req, res) => {
    const id = Number(req.params.id);
    const logs = db
      .prepare(`SELECT * FROM troubleshooting_logs WHERE incident_id = ? ORDER BY id DESC`)
      .all(id);
    res.json(logs);
  });

  app.post('/api/incidents/:id/troubleshooting', (req, res) => {
    const id = Number(req.params.id);
    const incident = db.prepare(`SELECT * FROM incidents WHERE id = ?`).get(id) as
      | { id: number; device_id: number }
      | undefined;
    if (!incident) return res.status(404).json({ error: 'Incident not found' });

    const { action_type = 'note', command_summary, output } = req.body || {};
    if (!command_summary || !output) {
      return res.status(400).json({ error: 'command_summary and output are required.' });
    }

    const info = db
      .prepare(
        `INSERT INTO troubleshooting_logs (incident_id, device_id, action_type, command_summary, output, performed_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(id, incident.device_id, String(action_type), String(command_summary), String(output), nowIso());

    const row = db
      .prepare(`SELECT * FROM troubleshooting_logs WHERE id = ?`)
      .get(Number(info.lastInsertRowid));
    res.status(201).json(row);
  });

  // Live TCP/IP Diagnostics Workbench
  app.post('/api/diagnostics/ping', async (req, res) => {
    const { target, port = 443, count = 4 } = req.body || {};
    if (!target || !isValidHostOrIp(String(target))) {
      return res.status(400).json({ error: 'Valid IPv4/IPv6 address or hostname is required.' });
    }
    const cleanTarget = String(target).trim();
    const parsedPort = Math.min(65535, Math.max(1, Number(port) || 443));
    const packetsCount = Math.min(8, Math.max(1, Number(count) || 4));

    let resolvedIp: string | null = net.isIP(cleanTarget) ? cleanTarget : null;
    if (!resolvedIp) {
      try {
        const lookup = await dns.lookup(cleanTarget);
        resolvedIp = lookup.address;
      } catch {
        resolvedIp = null;
      }
    }

    const packets = [];
    for (let seq = 1; seq <= packetsCount; seq++) {
      const r = await probeIcmpWithFallback(cleanTarget, parsedPort, 2000);
      packets.push({
        seq,
        success: r.success,
        latencyMs: r.latencyMs,
        method: r.methodUsed,
        detail: r.success ? r.detail : r.error || 'Timeout',
      });
    }

    const latencies = packets.filter((p) => p.success && p.latencyMs !== null).map((p) => p.latencyMs as number);
    const packetsReceived = latencies.length;
    const packetLossPct = Math.round(((packetsCount - packetsReceived) / packetsCount) * 100);
    const minMs = latencies.length ? Math.min(...latencies) : null;
    const maxMs = latencies.length ? Math.max(...latencies) : null;
    const avgMs = latencies.length
      ? Math.round((latencies.reduce((a, b) => a + b, 0) / latencies.length) * 100) / 100
      : null;
    const jitterMs =
      latencies.length > 1 && minMs !== null && maxMs !== null
        ? Math.round((maxMs - minMs) * 100) / 100
        : 0;

    res.json({
      target: cleanTarget,
      resolvedIp,
      port: parsedPort,
      packetsSent: packetsCount,
      packetsReceived,
      packetLossPct,
      minMs,
      avgMs,
      maxMs,
      jitterMs,
      packets,
    });
  });

  app.post('/api/diagnostics/port-scan', async (req, res) => {
    const { target, ports } = req.body || {};
    if (!target || !isValidHostOrIp(String(target))) {
      return res.status(400).json({ error: 'Valid IP address or hostname is required.' });
    }
    const cleanTarget = String(target).trim();
    const portList: number[] = Array.isArray(ports) && ports.length > 0
      ? ports.slice(0, 16).map((p: unknown) => Math.min(65535, Math.max(1, Number(p) || 80)))
      : [22, 53, 80, 443, 3000, 3306, 5432, 8080];

    let resolvedIp: string | null = net.isIP(cleanTarget) ? cleanTarget : null;
    if (!resolvedIp) {
      try {
        const lookup = await dns.lookup(cleanTarget);
        resolvedIp = lookup.address;
      } catch {
        resolvedIp = null;
      }
    }

    const results = await Promise.all(
      portList.map(async (p) => {
        const probe = await probeTcp(cleanTarget, p, 1800);
        const state: 'open' | 'closed' | 'timeout' = probe.success
          ? 'open'
          : probe.error?.includes('ECONNREFUSED')
          ? 'closed'
          : 'timeout';
        return {
          port: p,
          service: COMMON_PORTS[p] || `TCP/${p}`,
          state,
          latencyMs: probe.latencyMs,
          detail: probe.success ? probe.detail : probe.error || 'Unreachable',
        };
      })
    );

    res.json({ target: cleanTarget, resolvedIp, results });
  });

  app.post('/api/diagnostics/dns', async (req, res) => {
    const { query } = req.body || {};
    if (!query || !isValidHostOrIp(String(query))) {
      return res.status(400).json({ error: 'Valid hostname or IP is required.' });
    }
    const cleanQuery = String(query).trim();
    const start = process.hrtime.bigint();
    let ipv4: string[] = [];
    let ipv6: string[] = [];
    let reverseHostnames: string[] = [];
    let error: string | null = null;

    try {
      if (net.isIP(cleanQuery) !== 0) {
        try {
          reverseHostnames = await dns.reverse(cleanQuery);
        } catch {
          reverseHostnames = [];
        }
        if (net.isIPv4(cleanQuery)) ipv4 = [cleanQuery];
        if (net.isIPv6(cleanQuery)) ipv6 = [cleanQuery];
      } else {
        const [v4, v6] = await Promise.allSettled([
          dns.resolve4(cleanQuery),
          dns.resolve6(cleanQuery),
        ]);
        if (v4.status === 'fulfilled') ipv4 = v4.value;
        if (v6.status === 'fulfilled') ipv6 = v6.value;
        if (ipv4.length > 0) {
          try {
            reverseHostnames = await dns.reverse(ipv4[0]);
          } catch {
            reverseHostnames = [];
          }
        }
        if (ipv4.length === 0 && ipv6.length === 0) {
          error = 'NXDOMAIN or DNS resolution failed';
        }
      }
    } catch (err) {
      error = err instanceof Error ? err.message : 'DNS lookup error';
    }

    const lookupMs = Math.round((Number(process.hrtime.bigint() - start) / 1_000_000) * 100) / 100;
    res.json({ query: cleanQuery, ipv4, ipv6, reverseHostnames, lookupMs, error });
  });

  app.get('/api/sql-schema', (_req, res) => {
    const counts = {
      devices: (db.prepare(`SELECT COUNT(*) as c FROM devices`).get() as { c: number }).c,
      ping_logs: (db.prepare(`SELECT COUNT(*) as c FROM ping_logs`).get() as { c: number }).c,
      incidents: (db.prepare(`SELECT COUNT(*) as c FROM incidents`).get() as { c: number }).c,
      troubleshooting_logs: (
        db.prepare(`SELECT COUNT(*) as c FROM troubleshooting_logs`).get() as { c: number }
      ).c,
    };

    const mysqlDdl = `CREATE TABLE devices (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(120) NOT NULL,
  ip_address VARCHAR(45) NOT NULL,
  hostname VARCHAR(253),
  device_type VARCHAR(60) NOT NULL,
  probe_method ENUM('TCP', 'ICMP', 'HTTP') DEFAULT 'TCP',
  port SMALLINT UNSIGNED DEFAULT 443,
  subnet_cidr VARCHAR(45) NOT NULL,
  location VARCHAR(120) NOT NULL,
  latency_warn_ms INT DEFAULT 180,
  status ENUM('online', 'degraded', 'offline') DEFAULT 'online',
  last_latency_ms DECIMAL(8,2),
  uptime_pct DECIMAL(5,2) DEFAULT 100.00,
  last_checked_at DATETIME,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE ping_logs (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  device_id INT NOT NULL,
  status ENUM('online', 'degraded', 'offline') NOT NULL,
  response_time_ms DECIMAL(8,2),
  packet_loss_pct DECIMAL(5,2) DEFAULT 0.00,
  error_message VARCHAR(255),
  checked_at DATETIME NOT NULL,
  FOREIGN KEY (device_id) REFERENCES devices(id) ON DELETE CASCADE
);

CREATE TABLE incidents (
  id INT AUTO_INCREMENT PRIMARY KEY,
  device_id INT NOT NULL,
  title VARCHAR(180) NOT NULL,
  description TEXT NOT NULL,
  severity ENUM('critical', 'high', 'medium', 'low') NOT NULL,
  status ENUM('open', 'investigating', 'resolved') DEFAULT 'open',
  fault_type VARCHAR(60) NOT NULL,
  detected_at DATETIME NOT NULL,
  acknowledged_at DATETIME,
  resolved_at DATETIME,
  root_cause TEXT,
  resolution_notes TEXT,
  FOREIGN KEY (device_id) REFERENCES devices(id) ON DELETE CASCADE
);`;

    res.json({ counts, mysqlDdl });
  });

  // Periodic background probe loop (every 20s)
  setInterval(() => {
    probeAllEnabledDevices().catch((err) => {
      console.error('Background probe error:', err);
    });
  }, 20_000);

  // Run one live probe sweep shortly after startup so real RTTs populate immediately
  setTimeout(() => {
    probeAllEnabledDevices().catch(() => {});
  }, 1200);

  // Vite integration in development, static serve in production
  const distDir = path.join(__dirname, 'dist');
  const isProd = process.env.NODE_ENV === 'production' && fs.existsSync(distDir);

  if (isProd) {
    app.use(express.static(distDir));
    app.get('/{*splat}', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  } else {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`NetPulse NOC server running on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
