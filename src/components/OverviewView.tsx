import { Activity, AlertTriangle, ArrowRight, Play, Wrench } from 'lucide-react';
import type { Incident, NetworkDevice, OverviewResponse } from '../types';
import { formatRelativeTime, formatTimestamp } from '../utils/network';
import { LatencyChart } from './LatencyChart';
import { DeviceStatusIndicator, IncidentStatusIndicator, SeverityIndicator } from './StatusIndicators';

interface OverviewViewProps {
  overview: OverviewResponse;
  probingDeviceId: number | null;
  onProbeDevice: (deviceId: number) => void;
  onOpenIncident: (incident: Incident) => void;
  onInspectDevice: (device: NetworkDevice) => void;
  onNavigateTab: (tab: 'devices' | 'incidents' | 'diagnostics') => void;
}

export function OverviewView({
  overview,
  probingDeviceId,
  onProbeDevice,
  onOpenIncident,
  onInspectDevice,
  onNavigateTab,
}: OverviewViewProps) {
  const { summary, devices, activeIncidents, latencySeries, recentLogs } = overview;

  return (
    <div className="space-y-6">
      {/* 4-column Summary KPI Strip (single elevation, hairline vertical dividers) */}
      <section className="bg-white border border-slate-200 rounded-lg grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 divide-y sm:divide-y-0 sm:divide-x divide-slate-200">
        <div className="p-5">
          <p className="text-xs font-medium text-slate-500">Network Availability</p>
          <p className="mt-1.5 text-2xl font-semibold tracking-tight text-slate-900 font-mono tabular-nums">
            {summary.availabilityPct.toFixed(1)}%
          </p>
          <p className="mt-1 text-xs text-slate-500 tabular-nums">
            {summary.onlineDevices} online · {summary.degradedDevices} degraded · {summary.offlineDevices} offline
          </p>
        </div>

        <div className="p-5">
          <p className="text-xs font-medium text-slate-500">Mean Response Time</p>
          <p className="mt-1.5 text-2xl font-semibold tracking-tight text-slate-900 font-mono tabular-nums">
            {summary.avgLatencyMs.toFixed(1)} ms
          </p>
          <p className="mt-1 text-xs text-slate-500">
            TCP / ICMP / HTTP live checks
          </p>
        </div>

        <div className="p-5">
          <p className="text-xs font-medium text-slate-500">Active Incidents</p>
          <p className="mt-1.5 text-2xl font-semibold tracking-tight text-slate-900 font-mono tabular-nums">
            {summary.openIncidents}
          </p>
          <p className="mt-1 text-xs text-slate-500 tabular-nums">
            {summary.criticalIncidents > 0 ? (
              <span className="text-red-700 font-medium">{summary.criticalIncidents} critical severity</span>
            ) : (
              'No critical faults active'
            )}
          </p>
        </div>

        <div className="p-5">
          <p className="text-xs font-medium text-slate-500">Probe Samples Stored</p>
          <p className="mt-1.5 text-2xl font-semibold tracking-tight text-slate-900 font-mono tabular-nums">
            {summary.totalChecksLogged}
          </p>
          <p className="mt-1 text-xs text-slate-500">
            Across {summary.totalDevices} monitored hosts
          </p>
        </div>
      </section>

      {/* Active Fault Alert Banner */}
      {activeIncidents.length > 0 && (
        <section className="bg-red-50/70 border border-red-200 rounded-lg px-5 py-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-start sm:items-center gap-3 min-w-0">
            <AlertTriangle className="h-4 w-4 text-red-700 shrink-0 mt-0.5 sm:mt-0" aria-hidden="true" />
            <div className="min-w-0">
              <p className="text-sm font-medium text-red-950 truncate">
                {activeIncidents[0].title}
              </p>
              <p className="text-xs text-red-800">
                Detected {formatRelativeTime(activeIncidents[0].detected_at)} · {activeIncidents.length}{' '}
                unresolved fault{activeIncidents.length > 1 ? 's' : ''} requiring triage
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => onOpenIncident(activeIncidents[0])}
              className="px-3.5 py-2 text-xs font-medium bg-red-700 text-white rounded-md hover:bg-red-800 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              Inspect & Troubleshoot
            </button>
          </div>
        </section>
      )}

      {/* Main 12-Column Grid */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
        {/* Left 8 Columns: Latency Chart + Device Matrix */}
        <div className="xl:col-span-8 space-y-6">
          <section className="bg-white border border-slate-200 rounded-lg p-5">
            <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
              <div>
                <h2 className="text-base font-semibold text-slate-900">Response Time Telemetry</h2>
                <p className="text-xs text-slate-500">
                  Aggregated round-trip time (RTT) and timeout markers across polling windows
                </p>
              </div>
              <button
                type="button"
                onClick={() => onNavigateTab('diagnostics')}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 border border-slate-200 rounded-md hover:bg-slate-50 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                <Wrench className="h-3.5 w-3.5" aria-hidden="true" />
                Open IP Diagnostics
              </button>
            </div>
            <LatencyChart data={latencySeries} />
          </section>

          <section className="bg-white border border-slate-200 rounded-lg overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-base font-semibold text-slate-900">Monitored Network Devices</h2>
                <p className="text-xs text-slate-500">
                  Live IP connectivity status, probe protocol, RTT latency, and availability
                </p>
              </div>
              <button
                type="button"
                onClick={() => onNavigateTab('devices')}
                className="inline-flex items-center gap-1 text-xs font-medium text-blue-700 hover:text-blue-800 whitespace-nowrap shrink-0 cursor-pointer"
              >
                Manage Inventory
                <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50/70 text-xs font-medium text-slate-500">
                    <th className="py-2.5 px-4">Device</th>
                    <th className="py-2.5 px-4">IP / Port</th>
                    <th className="py-2.5 px-4">Status</th>
                    <th className="py-2.5 px-4 text-right">Latency</th>
                    <th className="py-2.5 px-4 text-right">Uptime</th>
                    <th className="py-2.5 px-4 text-right">Checked</th>
                    <th className="py-2.5 px-4 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 text-sm">
                  {devices.map((device) => (
                    <tr
                      key={device.id}
                      className="hover:bg-slate-50/80 transition-colors"
                    >
                      <td className="py-3 px-4">
                        <button
                          type="button"
                          onClick={() => onInspectDevice(device)}
                          className="text-left group cursor-pointer"
                        >
                          <div className="font-medium text-slate-900 group-hover:text-blue-700 transition-colors">
                            {device.name}
                          </div>
                          <div className="text-xs text-slate-500">
                            {device.device_type} · {device.location}
                          </div>
                        </button>
                      </td>
                      <td className="py-3 px-4 font-mono text-xs tabular-nums text-slate-700">
                        <div>{device.ip_address}</div>
                        <div className="text-slate-500">
                          {device.probe_method}:{device.port}
                        </div>
                      </td>
                      <td className="py-3 px-4">
                        <DeviceStatusIndicator status={device.status} />
                      </td>
                      <td className="py-3 px-4 text-right font-mono text-xs tabular-nums text-slate-900">
                        {device.last_latency_ms !== null ? `${device.last_latency_ms.toFixed(1)} ms` : 'Timeout'}
                      </td>
                      <td className="py-3 px-4 text-right font-mono text-xs tabular-nums text-slate-700">
                        {device.uptime_pct.toFixed(1)}%
                      </td>
                      <td className="py-3 px-4 text-right text-xs text-slate-500 tabular-nums whitespace-nowrap">
                        {formatRelativeTime(device.last_checked_at)}
                      </td>
                      <td className="py-3 px-4 text-right">
                        <button
                          type="button"
                          disabled={probingDeviceId === device.id}
                          onClick={() => onProbeDevice(device.id)}
                          className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-slate-700 border border-slate-200 rounded hover:bg-slate-100 disabled:opacity-50 transition-colors whitespace-nowrap cursor-pointer"
                        >
                          <Play className="h-3 w-3" aria-hidden="true" />
                          {probingDeviceId === device.id ? 'Probing' : 'Ping'}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </div>

        {/* Right 4 Columns: Active Incidents & Recent Probe Events */}
        <div className="xl:col-span-4 space-y-6">
          <section className="bg-white border border-slate-200 rounded-lg overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between gap-2">
              <h2 className="text-base font-semibold text-slate-900">Active Fault Queue</h2>
              <button
                type="button"
                onClick={() => onNavigateTab('incidents')}
                className="text-xs font-medium text-blue-700 hover:text-blue-800 whitespace-nowrap cursor-pointer"
              >
                All Incidents
              </button>
            </div>

            {activeIncidents.length === 0 ? (
              <div className="p-6 text-center">
                <Activity className="h-6 w-6 text-emerald-700 mx-auto mb-2" aria-hidden="true" />
                <p className="text-sm font-medium text-slate-900">All monitored links nominal</p>
                <p className="text-xs text-slate-500 mt-1">
                  Zero open connectivity incidents detected across the inventory.
                </p>
              </div>
            ) : (
              <ul className="divide-y divide-slate-200">
                {activeIncidents.map((inc) => (
                  <li key={inc.id} className="p-4 hover:bg-slate-50/70 transition-colors">
                    <div className="flex items-center justify-between gap-2 mb-1.5">
                      <SeverityIndicator severity={inc.severity} />
                      <IncidentStatusIndicator status={inc.status} />
                    </div>
                    <p className="text-sm font-medium text-slate-900 leading-snug">{inc.title}</p>
                    <p className="text-xs text-slate-600 mt-1 line-clamp-2">{inc.description}</p>
                    <div className="mt-3 flex items-center justify-between gap-2 text-xs text-slate-500">
                      <span className="font-mono tabular-nums">{formatTimestamp(inc.detected_at)}</span>
                      <button
                        type="button"
                        onClick={() => onOpenIncident(inc)}
                        className="font-medium text-blue-700 hover:text-blue-800 whitespace-nowrap cursor-pointer"
                      >
                        Troubleshoot
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="bg-white border border-slate-200 rounded-lg overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-200">
              <h2 className="text-base font-semibold text-slate-900">Recent Probe Events</h2>
              <p className="text-xs text-slate-500">Latest ICMP/TCP response checks</p>
            </div>
            <ul className="divide-y divide-slate-200 max-h-80 overflow-y-auto">
              {recentLogs.slice(0, 10).map((log) => (
                <li key={log.id} className="px-4 py-2.5 flex items-center justify-between gap-3 text-xs">
                  <div className="min-w-0">
                    <div className="font-medium text-slate-900 truncate">{log.device_name}</div>
                    <div className="text-slate-500 font-mono tabular-nums truncate">
                      {log.ip_address} · {formatTimestamp(log.checked_at)}
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <div
                      className={`font-mono tabular-nums font-medium ${
                        log.status === 'offline'
                          ? 'text-red-700'
                          : log.status === 'degraded'
                          ? 'text-amber-700'
                          : 'text-emerald-700'
                      }`}
                    >
                      {log.response_time_ms !== null ? `${log.response_time_ms.toFixed(1)} ms` : 'Timeout'}
                    </div>
                    <div className="text-[11px] text-slate-500 capitalize">{log.status}</div>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        </div>
      </div>
    </div>
  );
}
