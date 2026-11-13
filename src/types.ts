export type DeviceStatus = 'online' | 'degraded' | 'offline';
export type ProbeMethod = 'TCP' | 'ICMP' | 'HTTP';
export type FaultSimulationMode = 'none' | 'offline' | 'latency';
export type IncidentSeverity = 'critical' | 'high' | 'medium' | 'low';
export type IncidentStatus = 'open' | 'investigating' | 'resolved';

export interface NetworkDevice {
  id: number;
  name: string;
  ip_address: string;
  hostname: string | null;
  device_type: string;
  probe_method: ProbeMethod;
  port: number;
  subnet_cidr: string;
  location: string;
  check_interval_sec: number;
  latency_warn_ms: number;
  status: DeviceStatus;
  last_latency_ms: number | null;
  packet_loss_pct: number;
  uptime_pct: number;
  last_error: string | null;
  last_checked_at: string | null;
  created_at: string;
  fault_simulated: FaultSimulationMode;
  enabled: number;
}

export interface PingLog {
  id: number;
  device_id: number;
  device_name?: string;
  ip_address?: string;
  status: DeviceStatus;
  response_time_ms: number | null;
  packet_loss_pct: number;
  probe_detail: string | null;
  error_message: string | null;
  checked_at: string;
}

export interface Incident {
  id: number;
  device_id: number;
  device_name: string;
  device_ip: string;
  device_type: string;
  title: string;
  description: string;
  severity: IncidentSeverity;
  status: IncidentStatus;
  fault_type: string;
  detected_at: string;
  acknowledged_at: string | null;
  resolved_at: string | null;
  root_cause: string | null;
  resolution_notes: string | null;
}

export interface TroubleshootingLog {
  id: number;
  incident_id: number | null;
  device_id: number | null;
  action_type: string;
  command_summary: string;
  output: string;
  performed_at: string;
}

export interface OverviewResponse {
  summary: {
    totalDevices: number;
    onlineDevices: number;
    degradedDevices: number;
    offlineDevices: number;
    availabilityPct: number;
    avgLatencyMs: number;
    openIncidents: number;
    criticalIncidents: number;
    totalChecksLogged: number;
  };
  devices: NetworkDevice[];
  recentLogs: PingLog[];
  activeIncidents: Incident[];
  latencySeries: Array<{
    checked_at: string;
    avg_ms: number;
    max_ms: number;
    failures: number;
  }>;
}

export interface PingDiagnosticPacket {
  seq: number;
  success: boolean;
  latencyMs: number | null;
  method: string;
  detail: string;
}

export interface PingDiagnosticResult {
  target: string;
  resolvedIp: string | null;
  port: number;
  packetsSent: number;
  packetsReceived: number;
  packetLossPct: number;
  minMs: number | null;
  avgMs: number | null;
  maxMs: number | null;
  jitterMs: number | null;
  packets: PingDiagnosticPacket[];
}

export interface PortScanResult {
  target: string;
  resolvedIp: string | null;
  results: Array<{
    port: number;
    service: string;
    state: 'open' | 'closed' | 'timeout';
    latencyMs: number | null;
    detail: string;
  }>;
}

export interface DnsDiagnosticResult {
  query: string;
  ipv4: string[];
  ipv6: string[];
  reverseHostnames: string[];
  lookupMs: number;
  error: string | null;
}
