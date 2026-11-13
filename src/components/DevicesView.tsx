import { useEffect, useState } from 'react';
import { History, Play, Plus, Search, Trash2, X } from 'lucide-react';
import type { FaultSimulationMode, NetworkDevice, PingLog, ProbeMethod } from '../types';
import { formatDateTime, formatRelativeTime } from '../utils/network';
import { DeviceStatusIndicator } from './StatusIndicators';

interface DevicesViewProps {
  devices: NetworkDevice[];
  selectedDeviceId: number | null;
  probingDeviceId: number | null;
  onSelectDevice: (device: NetworkDevice | null) => void;
  onProbeDevice: (deviceId: number) => void;
  onSimulateFault: (deviceId: number, mode: FaultSimulationMode) => void;
  onDeleteDevice: (deviceId: number) => void;
  onAddDevice: (payload: {
    name: string;
    ip_address: string;
    hostname: string;
    device_type: string;
    probe_method: ProbeMethod;
    port: number;
    subnet_cidr: string;
    location: string;
    latency_warn_ms: number;
  }) => Promise<void>;
  showAddModal: boolean;
  onCloseAddModal: () => void;
  onOpenAddModal: () => void;
}

export function DevicesView({
  devices,
  selectedDeviceId,
  probingDeviceId,
  onSelectDevice,
  onProbeDevice,
  onSimulateFault,
  onDeleteDevice,
  onAddDevice,
  showAddModal,
  onCloseAddModal,
  onOpenAddModal,
}: DevicesViewProps) {
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'online' | 'degraded' | 'offline'>('all');
  const [deviceLogs, setDeviceLogs] = useState<PingLog[]>([]);
  const [loadingLogs, setLoadingLogs] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);

  // Add Device form state
  const [name, setName] = useState('');
  const [ipAddress, setIpAddress] = useState('');
  const [hostname, setHostname] = useState('');
  const [deviceType, setDeviceType] = useState('Server');
  const [probeMethod, setProbeMethod] = useState<ProbeMethod>('TCP');
  const [port, setPort] = useState('443');
  const [subnetCidr, setSubnetCidr] = useState('192.168.1.0/24');
  const [location, setLocation] = useState('Core Rack A');
  const [latencyWarn, setLatencyWarn] = useState('180');
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const selectedDevice = devices.find((d) => d.id === selectedDeviceId) || null;

  useEffect(() => {
    if (!selectedDeviceId) {
      setDeviceLogs([]);
      return;
    }
    let active = true;
    setLoadingLogs(true);
    fetch(`/api/devices/${selectedDeviceId}/logs`)
      .then((r) => r.json())
      .then((data) => {
        if (active && Array.isArray(data)) setDeviceLogs(data);
      })
      .catch(() => {})
      .finally(() => {
        if (active) setLoadingLogs(false);
      });
    return () => {
      active = false;
    };
  }, [selectedDeviceId, devices]);

  const filtered = devices.filter((d) => {
    const matchesStatus = statusFilter === 'all' || d.status === statusFilter;
    const q = search.trim().toLowerCase();
    const matchesSearch =
      !q ||
      d.name.toLowerCase().includes(q) ||
      d.ip_address.toLowerCase().includes(q) ||
      (d.hostname || '').toLowerCase().includes(q) ||
      d.subnet_cidr.toLowerCase().includes(q) ||
      d.location.toLowerCase().includes(q);
    return matchesStatus && matchesSearch;
  });

  async function handleCreateSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    if (!name.trim() || !ipAddress.trim()) {
      setFormError('Device name and IP address are required.');
      return;
    }
    setSubmitting(true);
    try {
      await onAddDevice({
        name: name.trim(),
        ip_address: ipAddress.trim(),
        hostname: hostname.trim(),
        device_type: deviceType,
        probe_method: probeMethod,
        port: Number(port) || 443,
        subnet_cidr: subnetCidr.trim() || '10.0.0.0/24',
        location: location.trim() || 'Primary DC',
        latency_warn_ms: Number(latencyWarn) || 180,
      });
      setName('');
      setIpAddress('');
      setHostname('');
      onCloseAddModal();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Failed to add device.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-6">
      {/* Toolbar */}
      <div className="bg-white border border-slate-200 rounded-lg p-4 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-3 flex-1">
          <div className="relative flex-1 min-w-[220px] max-w-sm">
            <Search
              className="h-4 w-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
              aria-hidden="true"
            />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Filter by hostname, IP, subnet, or rack..."
              className="w-full pl-9 pr-3 py-2 text-sm bg-white border border-slate-200 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-600/20 focus:border-blue-600"
            />
          </div>

          <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-md">
            {(['all', 'online', 'degraded', 'offline'] as const).map((st) => (
              <button
                key={st}
                type="button"
                onClick={() => setStatusFilter(st)}
                className={`px-3 py-1.5 text-xs font-medium rounded transition-colors capitalize whitespace-nowrap shrink-0 cursor-pointer ${
                  statusFilter === st
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {st}
              </button>
            ))}
          </div>
        </div>

        <button
          type="button"
          onClick={onOpenAddModal}
          className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium bg-slate-900 text-white rounded-md hover:bg-slate-800 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
        >
          <Plus className="h-3.5 w-3.5" aria-hidden="true" />
          Add Network Device
        </button>
      </div>

      {/* Main Content Split */}
      <div className={`grid grid-cols-1 ${selectedDevice ? 'xl:grid-cols-12' : ''} gap-6 items-start`}>
        <section
          className={`bg-white border border-slate-200 rounded-lg overflow-hidden ${
            selectedDevice ? 'xl:col-span-8' : ''
          }`}
        >
          <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between gap-2">
            <div>
              <h2 className="text-base font-semibold text-slate-900">Device & IP Inventory</h2>
              <p className="text-xs text-slate-500">
                Showing {filtered.length} of {devices.length} configured network endpoints
              </p>
            </div>
          </div>

          {filtered.length === 0 ? (
            <div className="p-10 text-center">
              <p className="text-sm font-medium text-slate-900">No devices match your current filter</p>
              <p className="text-xs text-slate-500 mt-1">
                Adjust your search criteria or add a new network device to begin monitoring.
              </p>
              <button
                type="button"
                onClick={() => {
                  setSearch('');
                  setStatusFilter('all');
                }}
                className="mt-4 px-3.5 py-2 text-xs font-medium text-slate-700 border border-slate-200 rounded-md hover:bg-slate-50 cursor-pointer"
              >
                Reset Filters
              </button>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50/70 text-xs font-medium text-slate-500">
                    <th className="py-2.5 px-4">Host & Location</th>
                    <th className="py-2.5 px-4">IP / Subnet CIDR</th>
                    <th className="py-2.5 px-4">Probe</th>
                    <th className="py-2.5 px-4">Status</th>
                    <th className="py-2.5 px-4 text-right">RTT</th>
                    <th className="py-2.5 px-4 text-right">Uptime</th>
                    <th className="py-2.5 px-4">Fault Test</th>
                    <th className="py-2.5 px-4 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 text-sm">
                  {filtered.map((d) => (
                    <tr
                      key={d.id}
                      className={`hover:bg-slate-50/80 transition-colors ${
                        selectedDeviceId === d.id ? 'bg-blue-50/40' : ''
                      }`}
                    >
                      <td className="py-3 px-4">
                        <div className="font-medium text-slate-900">{d.name}</div>
                        <div className="text-xs text-slate-500">
                          {d.device_type} · {d.location}
                        </div>
                      </td>
                      <td className="py-3 px-4 font-mono text-xs tabular-nums">
                        <div className="text-slate-900">{d.ip_address}</div>
                        <div className="text-slate-500">{d.subnet_cidr}</div>
                      </td>
                      <td className="py-3 px-4 font-mono text-xs tabular-nums text-slate-700">
                        {d.probe_method}:{d.port}
                      </td>
                      <td className="py-3 px-4">
                        <DeviceStatusIndicator status={d.status} />
                        {d.last_error && (
                          <div className="text-[11px] text-red-700 font-mono truncate max-w-[160px] mt-0.5">
                            {d.last_error}
                          </div>
                        )}
                      </td>
                      <td className="py-3 px-4 text-right font-mono text-xs tabular-nums text-slate-900">
                        {d.last_latency_ms !== null ? `${d.last_latency_ms.toFixed(1)} ms` : 'Timeout'}
                      </td>
                      <td className="py-3 px-4 text-right font-mono text-xs tabular-nums text-slate-700">
                        {d.uptime_pct.toFixed(1)}%
                      </td>
                      <td className="py-3 px-4">
                        <select
                          aria-label={`Fault simulation mode for ${d.name}`}
                          value={d.fault_simulated}
                          onChange={(e) =>
                            onSimulateFault(d.id, e.target.value as FaultSimulationMode)
                          }
                          className="text-xs border border-slate-200 rounded px-2 py-1 bg-white text-slate-700 focus:outline-none focus:border-blue-600 cursor-pointer"
                        >
                          <option value="none">Live Probe</option>
                          <option value="offline">Simulate Offline</option>
                          <option value="latency">Inject High RTT</option>
                        </select>
                      </td>
                      <td className="py-3 px-4 text-right">
                        <div className="inline-flex items-center gap-1.5">
                          <button
                            type="button"
                            disabled={probingDeviceId === d.id}
                            onClick={() => onProbeDevice(d.id)}
                            title="Run immediate probe"
                            className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-slate-700 border border-slate-200 rounded hover:bg-slate-100 disabled:opacity-50 whitespace-nowrap cursor-pointer"
                          >
                            <Play className="h-3 w-3" aria-hidden="true" />
                            {probingDeviceId === d.id ? '...' : 'Ping'}
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              onSelectDevice(selectedDeviceId === d.id ? null : d)
                            }
                            title="View ping history"
                            className="p-1.5 text-slate-600 border border-slate-200 rounded hover:bg-slate-100 cursor-pointer"
                          >
                            <History className="h-3.5 w-3.5" aria-hidden="true" />
                          </button>
                          {confirmDeleteId === d.id ? (
                            <button
                              type="button"
                              onClick={() => {
                                onDeleteDevice(d.id);
                                setConfirmDeleteId(null);
                              }}
                              className="px-2 py-1 text-xs font-medium bg-red-700 text-white rounded hover:bg-red-800 whitespace-nowrap cursor-pointer"
                            >
                              Confirm
                            </button>
                          ) : (
                            <button
                              type="button"
                              onClick={() => setConfirmDeleteId(d.id)}
                              title="Remove device"
                              className="p-1.5 text-slate-500 border border-slate-200 rounded hover:text-red-700 hover:border-red-200 cursor-pointer"
                            >
                              <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {/* Device Ping History Inspector */}
        {selectedDevice && (
          <aside className="xl:col-span-4 bg-white border border-slate-200 rounded-lg overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-200 flex items-start justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold text-slate-900">{selectedDevice.name}</h3>
                <p className="text-xs font-mono text-slate-500 tabular-nums mt-0.5">
                  {selectedDevice.ip_address} · {selectedDevice.probe_method}:{selectedDevice.port}
                </p>
              </div>
              <button
                type="button"
                onClick={() => onSelectDevice(null)}
                className="p-1 text-slate-400 hover:text-slate-700 cursor-pointer"
                aria-label="Close device history"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="px-5 py-3 border-b border-slate-200 grid grid-cols-3 gap-2 text-xs bg-slate-50/60">
              <div>
                <div className="text-slate-500">Availability</div>
                <div className="font-mono font-semibold text-slate-900 tabular-nums mt-0.5">
                  {selectedDevice.uptime_pct.toFixed(1)}%
                </div>
              </div>
              <div>
                <div className="text-slate-500">Warn RTT</div>
                <div className="font-mono font-semibold text-slate-900 tabular-nums mt-0.5">
                  {selectedDevice.latency_warn_ms} ms
                </div>
              </div>
              <div>
                <div className="text-slate-500">Last Check</div>
                <div className="font-medium text-slate-900 mt-0.5">
                  {formatRelativeTime(selectedDevice.last_checked_at)}
                </div>
              </div>
            </div>

            <div className="max-h-[440px] overflow-y-auto divide-y divide-slate-200">
              {loadingLogs ? (
                <div className="p-6 text-xs text-slate-500 text-center">Loading probe history...</div>
              ) : deviceLogs.length === 0 ? (
                <div className="p-6 text-xs text-slate-500 text-center">No probe logs recorded yet.</div>
              ) : (
                deviceLogs.map((log) => (
                  <div key={log.id} className="px-4 py-2.5 text-xs flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="font-mono text-slate-600 tabular-nums">
                        {formatDateTime(log.checked_at)}
                      </div>
                      <div className="text-slate-500 truncate mt-0.5">
                        {log.error_message || log.probe_detail || 'OK'}
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <div
                        className={`font-mono font-medium tabular-nums ${
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
                  </div>
                ))
              )}
            </div>
          </aside>
        )}
      </div>

      {/* Add Device Modal */}
      {showAddModal && (
        <div
          className="fixed inset-0 z-50 bg-slate-900/40 flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="add-device-title"
        >
          <div className="bg-white border border-slate-200 rounded-lg w-full max-w-lg overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
              <h2 id="add-device-title" className="text-base font-semibold text-slate-900">
                Add Network Device
              </h2>
              <button
                type="button"
                onClick={onCloseAddModal}
                className="p-1 text-slate-400 hover:text-slate-700 cursor-pointer"
                aria-label="Close modal"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <form onSubmit={handleCreateSubmit} className="p-5 space-y-4">
              {formError && (
                <div className="p-3 text-xs text-red-800 bg-red-50 border border-red-200 rounded-md">
                  {formError}
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Device Name</label>
                  <input
                    type="text"
                    required
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="e.g. Core Router R1"
                    className="w-full px-3 py-2 text-sm border border-slate-200 rounded-md focus:outline-none focus:border-blue-600"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    IP Address or Host
                  </label>
                  <input
                    type="text"
                    required
                    value={ipAddress}
                    onChange={(e) => setIpAddress(e.target.value)}
                    placeholder="e.g. 8.8.4.4 or 10.0.1.1"
                    className="w-full px-3 py-2 text-sm font-mono border border-slate-200 rounded-md focus:outline-none focus:border-blue-600"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Device Type</label>
                  <select
                    value={deviceType}
                    onChange={(e) => setDeviceType(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-slate-200 rounded-md bg-white focus:outline-none focus:border-blue-600"
                  >
                    <option value="Gateway">Gateway</option>
                    <option value="Core Switch">Core Switch</option>
                    <option value="Router">Router</option>
                    <option value="DNS Resolver">DNS Resolver</option>
                    <option value="Web Server">Web Server</option>
                    <option value="Database">Database</option>
                    <option value="Firewall">Firewall</option>
                    <option value="Server">Server</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Probe Method</label>
                  <select
                    value={probeMethod}
                    onChange={(e) => setProbeMethod(e.target.value as ProbeMethod)}
                    className="w-full px-3 py-2 text-sm border border-slate-200 rounded-md bg-white focus:outline-none focus:border-blue-600"
                  >
                    <option value="TCP">TCP Handshake</option>
                    <option value="HTTP">HTTP / HTTPS</option>
                    <option value="ICMP">ICMP Ping</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Target Port</label>
                  <input
                    type="number"
                    min={1}
                    max={65535}
                    value={port}
                    onChange={(e) => setPort(e.target.value)}
                    className="w-full px-3 py-2 text-sm font-mono border border-slate-200 rounded-md focus:outline-none focus:border-blue-600"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Subnet CIDR</label>
                  <input
                    type="text"
                    value={subnetCidr}
                    onChange={(e) => setSubnetCidr(e.target.value)}
                    placeholder="192.168.1.0/24"
                    className="w-full px-3 py-2 text-sm font-mono border border-slate-200 rounded-md focus:outline-none focus:border-blue-600"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Location</label>
                  <input
                    type="text"
                    value={location}
                    onChange={(e) => setLocation(e.target.value)}
                    placeholder="Data Center 1"
                    className="w-full px-3 py-2 text-sm border border-slate-200 rounded-md focus:outline-none focus:border-blue-600"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Warn RTT (ms)
                  </label>
                  <input
                    type="number"
                    min={10}
                    value={latencyWarn}
                    onChange={(e) => setLatencyWarn(e.target.value)}
                    className="w-full px-3 py-2 text-sm font-mono border border-slate-200 rounded-md focus:outline-none focus:border-blue-600"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  DNS Hostname (optional)
                </label>
                <input
                  type="text"
                  value={hostname}
                  onChange={(e) => setHostname(e.target.value)}
                  placeholder="Optional FQDN used for HTTP/DNS checks"
                  className="w-full px-3 py-2 text-sm font-mono border border-slate-200 rounded-md focus:outline-none focus:border-blue-600"
                />
              </div>

              <div className="pt-3 border-t border-slate-200 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={onCloseAddModal}
                  className="px-4 py-2 text-xs font-medium text-slate-700 border border-slate-200 rounded-md hover:bg-slate-50 cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="px-4 py-2 text-xs font-medium bg-slate-900 text-white rounded-md hover:bg-slate-800 disabled:opacity-50 cursor-pointer"
                >
                  {submitting ? 'Probing & Saving...' : 'Save & Run Initial Probe'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
