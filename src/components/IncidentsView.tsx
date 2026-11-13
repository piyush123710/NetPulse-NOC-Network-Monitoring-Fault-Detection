import { useEffect, useState } from 'react';
import { CheckCircle2, Play, Plus, Terminal, X } from 'lucide-react';
import type {
  Incident,
  IncidentSeverity,
  IncidentStatus,
  NetworkDevice,
  PingDiagnosticResult,
  PortScanResult,
  TroubleshootingLog,
} from '../types';
import { formatDateTime } from '../utils/network';
import { IncidentStatusIndicator, SeverityIndicator } from './StatusIndicators';

interface IncidentsViewProps {
  incidents: Incident[];
  devices: NetworkDevice[];
  selectedIncidentId: number | null;
  onSelectIncident: (id: number | null) => void;
  onUpdateIncident: (
    id: number,
    updates: {
      status?: IncidentStatus;
      severity?: IncidentSeverity;
      root_cause?: string;
      resolution_notes?: string;
    }
  ) => Promise<void>;
  onCreateIncident: (payload: {
    device_id: number;
    title: string;
    description: string;
    severity: IncidentSeverity;
  }) => Promise<void>;
}

export function IncidentsView({
  incidents,
  devices,
  selectedIncidentId,
  onSelectIncident,
  onUpdateIncident,
  onCreateIncident,
}: IncidentsViewProps) {
  const [statusFilter, setStatusFilter] = useState<'all' | IncidentStatus>('all');
  const [severityFilter, setSeverityFilter] = useState<'all' | IncidentSeverity>('all');
  const [logs, setLogs] = useState<TroubleshootingLog[]>([]);
  const [rootCause, setRootCause] = useState('');
  const [resolutionNotes, setResolutionNotes] = useState('');
  const [manualStepNote, setManualStepNote] = useState('');
  const [runningDiag, setRunningDiag] = useState(false);
  const [savingNotes, setSavingNotes] = useState(false);

  // Manual Incident modal
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newDeviceId, setNewDeviceId] = useState<number>(devices[0]?.id || 1);
  const [newTitle, setNewTitle] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [newSeverity, setNewSeverity] = useState<IncidentSeverity>('high');

  const filtered = incidents.filter((inc) => {
    const matchStatus = statusFilter === 'all' || inc.status === statusFilter;
    const matchSeverity = severityFilter === 'all' || inc.severity === severityFilter;
    return matchStatus && matchSeverity;
  });

  const activeIncident =
    filtered.find((i) => i.id === selectedIncidentId) ||
    incidents.find((i) => i.id === selectedIncidentId) ||
    filtered[0] ||
    null;

  useEffect(() => {
    if (!activeIncident) {
      setLogs([]);
      return;
    }
    setRootCause(activeIncident.root_cause || '');
    setResolutionNotes(activeIncident.resolution_notes || '');

    let mounted = true;
    fetch(`/api/incidents/${activeIncident.id}/troubleshooting`)
      .then((r) => r.json())
      .then((data) => {
        if (mounted && Array.isArray(data)) setLogs(data);
      })
      .catch(() => {});
    return () => {
      mounted = false;
    };
  }, [activeIncident?.id, activeIncident?.root_cause, activeIncident?.resolution_notes]);

  async function appendTroubleshooting(actionType: string, commandSummary: string, output: string) {
    if (!activeIncident) return;
    const res = await fetch(`/api/incidents/${activeIncident.id}/troubleshooting`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action_type: actionType,
        command_summary: commandSummary,
        output,
      }),
    });
    if (res.ok) {
      const created: TroubleshootingLog = await res.json();
      setLogs((prev) => [created, ...prev]);
    }
  }

  async function handleRunQuickPing() {
    if (!activeIncident) return;
    setRunningDiag(true);
    try {
      const dev = devices.find((d) => d.id === activeIncident.device_id);
      const target = dev?.hostname || activeIncident.device_ip;
      const res = await fetch('/api/diagnostics/ping', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ target, port: dev?.port || 443, count: 4 }),
      });
      const data: PingDiagnosticResult = await res.json();
      const summary = `Ping ${data.target} (${data.resolvedIp || 'unresolved'}) via port ${data.port}`;
      const output = `Sent=${data.packetsSent}, Recv=${data.packetsReceived}, Loss=${data.packetLossPct}%, Avg=${
        data.avgMs !== null ? `${data.avgMs}ms` : 'Timeout'
      }, Max=${data.maxMs !== null ? `${data.maxMs}ms` : 'Timeout'}`;
      await appendTroubleshooting('ping_test', summary, output);
    } finally {
      setRunningDiag(false);
    }
  }

  async function handleRunQuickPortScan() {
    if (!activeIncident) return;
    setRunningDiag(true);
    try {
      const dev = devices.find((d) => d.id === activeIncident.device_id);
      const target = dev?.hostname || activeIncident.device_ip;
      const res = await fetch('/api/diagnostics/port-scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ target, ports: [22, 53, 80, 443, 3306, 8080] }),
      });
      const data: PortScanResult = await res.json();
      const output = data.results
        .map((r) => `${r.port}/${r.service}: ${r.state.toUpperCase()}${r.latencyMs ? ` (${r.latencyMs}ms)` : ''}`)
        .join(' | ');
      await appendTroubleshooting('tcp_port_scan', `TCP Port Scan ${target}`, output);
    } finally {
      setRunningDiag(false);
    }
  }

  async function handleAddManualStep(e: React.FormEvent) {
    e.preventDefault();
    if (!manualStepNote.trim() || !activeIncident) return;
    await appendTroubleshooting('note', 'Operator Triage Note', manualStepNote.trim());
    setManualStepNote('');
  }

  async function handleSaveNotes() {
    if (!activeIncident) return;
    setSavingNotes(true);
    try {
      await onUpdateIncident(activeIncident.id, {
        root_cause: rootCause,
        resolution_notes: resolutionNotes,
      });
    } finally {
      setSavingNotes(false);
    }
  }

  async function handleCreateSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!newTitle.trim() || !newDesc.trim()) return;
    await onCreateIncident({
      device_id: newDeviceId,
      title: newTitle.trim(),
      description: newDesc.trim(),
      severity: newSeverity,
    });
    setNewTitle('');
    setNewDesc('');
    setShowCreateModal(false);
  }

  return (
    <div className="space-y-6">
      {/* Filter Toolbar */}
      <div className="bg-white border border-slate-200 rounded-lg p-4 flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-md">
            {(['all', 'open', 'investigating', 'resolved'] as const).map((st) => (
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

          <select
            aria-label="Filter by incident severity"
            value={severityFilter}
            onChange={(e) => setSeverityFilter(e.target.value as 'all' | IncidentSeverity)}
            className="px-3 py-2 text-xs font-medium border border-slate-200 rounded-md bg-white text-slate-700 focus:outline-none focus:border-blue-600 cursor-pointer"
          >
            <option value="all">All Severities</option>
            <option value="critical">Critical</option>
            <option value="high">High</option>
            <option value="medium">Medium</option>
            <option value="low">Low</option>
          </select>
        </div>

        <button
          type="button"
          onClick={() => setShowCreateModal(true)}
          className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium bg-slate-900 text-white rounded-md hover:bg-slate-800 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
        >
          <Plus className="h-3.5 w-3.5" aria-hidden="true" />
          Log Incident
        </button>
      </div>

      {/* Split Workspace */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left List */}
        <section className="lg:col-span-5 bg-white border border-slate-200 rounded-lg overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-200">
            <h2 className="text-base font-semibold text-slate-900">Incident Log</h2>
            <p className="text-xs text-slate-500">
              {filtered.length} incident{filtered.length === 1 ? '' : 's'} matching filter
            </p>
          </div>

          {filtered.length === 0 ? (
            <div className="p-8 text-center">
              <CheckCircle2 className="h-6 w-6 text-emerald-700 mx-auto mb-2" aria-hidden="true" />
              <p className="text-sm font-medium text-slate-900">No incidents in this view</p>
              <p className="text-xs text-slate-500 mt-1">
                Connectivity faults detected by probes or logged manually will appear here.
              </p>
            </div>
          ) : (
            <ul className="divide-y divide-slate-200 max-h-[680px] overflow-y-auto">
              {filtered.map((inc) => {
                const isSelected = activeIncident?.id === inc.id;
                return (
                  <li key={inc.id}>
                    <button
                      type="button"
                      onClick={() => onSelectIncident(inc.id)}
                      className={`w-full text-left p-4 transition-colors cursor-pointer ${
                        isSelected ? 'bg-blue-50/50' : 'hover:bg-slate-50/80'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2 mb-1.5">
                        <SeverityIndicator severity={inc.severity} />
                        <IncidentStatusIndicator status={inc.status} />
                      </div>
                      <p className="text-sm font-medium text-slate-900 leading-snug">{inc.title}</p>
                      <div className="mt-2 flex items-center justify-between gap-2 text-xs text-slate-500 font-mono tabular-nums">
                        <span>{inc.device_ip}</span>
                        <span>{formatDateTime(inc.detected_at)}</span>
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        {/* Right Detail & Troubleshooting Workbench */}
        <section className="lg:col-span-7 bg-white border border-slate-200 rounded-lg overflow-hidden">
          {!activeIncident ? (
            <div className="p-12 text-center text-sm text-slate-500">
              Select an incident from the log to inspect timestamps, run diagnostics, and manage resolution.
            </div>
          ) : (
            <div className="divide-y divide-slate-200">
              <div className="p-5 space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-4">
                    <SeverityIndicator severity={activeIncident.severity} />
                    <span className="text-slate-300" aria-hidden="true">·</span>
                    <IncidentStatusIndicator status={activeIncident.status} />
                    <span className="text-slate-300" aria-hidden="true">·</span>
                    <span className="text-xs font-mono text-slate-500 tabular-nums">
                      INC-{String(activeIncident.id).padStart(4, '0')}
                    </span>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    {activeIncident.status === 'open' && (
                      <button
                        type="button"
                        onClick={() =>
                          onUpdateIncident(activeIncident.id, { status: 'investigating' })
                        }
                        className="px-3 py-1.5 text-xs font-medium bg-blue-600 text-white rounded-md hover:bg-blue-700 whitespace-nowrap cursor-pointer"
                      >
                        Acknowledge & Investigate
                      </button>
                    )}
                    {activeIncident.status !== 'resolved' ? (
                      <button
                        type="button"
                        onClick={() =>
                          onUpdateIncident(activeIncident.id, {
                            status: 'resolved',
                            root_cause: rootCause,
                            resolution_notes: resolutionNotes,
                          })
                        }
                        className="px-3 py-1.5 text-xs font-medium bg-emerald-700 text-white rounded-md hover:bg-emerald-800 whitespace-nowrap cursor-pointer"
                      >
                        Mark Resolved
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => onUpdateIncident(activeIncident.id, { status: 'open' })}
                        className="px-3 py-1.5 text-xs font-medium text-slate-700 border border-slate-200 rounded-md hover:bg-slate-50 whitespace-nowrap cursor-pointer"
                      >
                        Reopen Incident
                      </button>
                    )}
                  </div>
                </div>

                <div>
                  <h3 className="text-lg font-semibold text-slate-900">{activeIncident.title}</h3>
                  <p className="text-sm text-slate-600 mt-1">{activeIncident.description}</p>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 pt-2 text-xs">
                  <div>
                    <div className="text-slate-500">Target Host</div>
                    <div className="font-mono font-medium text-slate-900 tabular-nums mt-0.5">
                      {activeIncident.device_ip}
                    </div>
                  </div>
                  <div>
                    <div className="text-slate-500">Detected At</div>
                    <div className="font-mono text-slate-900 tabular-nums mt-0.5">
                      {formatDateTime(activeIncident.detected_at)}
                    </div>
                  </div>
                  <div>
                    <div className="text-slate-500">Acknowledged</div>
                    <div className="font-mono text-slate-900 tabular-nums mt-0.5">
                      {formatDateTime(activeIncident.acknowledged_at)}
                    </div>
                  </div>
                  <div>
                    <div className="text-slate-500">Resolved At</div>
                    <div className="font-mono text-slate-900 tabular-nums mt-0.5">
                      {formatDateTime(activeIncident.resolved_at)}
                    </div>
                  </div>
                </div>
              </div>

              {/* Root Cause & Resolution Notes */}
              <div className="p-5 space-y-3 bg-slate-50/40">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">
                      Root Cause Analysis
                    </label>
                    <textarea
                      rows={2}
                      value={rootCause}
                      onChange={(e) => setRootCause(e.target.value)}
                      placeholder="Identify link failure, port drop, or routing flap..."
                      className="w-full px-3 py-2 text-xs bg-white border border-slate-200 rounded-md focus:outline-none focus:border-blue-600"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">
                      Resolution Notes
                    </label>
                    <textarea
                      rows={2}
                      value={resolutionNotes}
                      onChange={(e) => setResolutionNotes(e.target.value)}
                      placeholder="Document corrective actions taken..."
                      className="w-full px-3 py-2 text-xs bg-white border border-slate-200 rounded-md focus:outline-none focus:border-blue-600"
                    />
                  </div>
                </div>
                <div className="flex justify-end">
                  <button
                    type="button"
                    disabled={savingNotes}
                    onClick={handleSaveNotes}
                    className="px-3.5 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-md hover:bg-slate-50 disabled:opacity-50 cursor-pointer"
                  >
                    {savingNotes ? 'Saving...' : 'Save Incident Notes'}
                  </button>
                </div>
              </div>

              {/* Initial Troubleshooting Timeline */}
              <div className="p-5 space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h4 className="text-sm font-semibold text-slate-900">
                      Initial Troubleshooting Timeline
                    </h4>
                    <p className="text-xs text-slate-500">
                      Run live diagnostic probes and append findings to this incident record
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      disabled={runningDiag}
                      onClick={handleRunQuickPing}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 border border-slate-200 rounded-md hover:bg-slate-50 disabled:opacity-50 whitespace-nowrap cursor-pointer"
                    >
                      <Play className="h-3 w-3" aria-hidden="true" />
                      Run Ping Check
                    </button>
                    <button
                      type="button"
                      disabled={runningDiag}
                      onClick={handleRunQuickPortScan}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 border border-slate-200 rounded-md hover:bg-slate-50 disabled:opacity-50 whitespace-nowrap cursor-pointer"
                    >
                      <Terminal className="h-3 w-3" aria-hidden="true" />
                      Scan TCP Ports
                    </button>
                  </div>
                </div>

                <form onSubmit={handleAddManualStep} className="flex gap-2">
                  <input
                    type="text"
                    value={manualStepNote}
                    onChange={(e) => setManualStepNote(e.target.value)}
                    placeholder="Log manual troubleshooting step (e.g., Verified VLAN trunk or restarted interface)..."
                    className="flex-1 px-3 py-2 text-xs bg-white border border-slate-200 rounded-md focus:outline-none focus:border-blue-600"
                  />
                  <button
                    type="submit"
                    className="px-3.5 py-2 text-xs font-medium bg-slate-900 text-white rounded-md hover:bg-slate-800 whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    Add Step
                  </button>
                </form>

                {logs.length === 0 ? (
                  <p className="text-xs text-slate-500 py-3">
                    No troubleshooting steps recorded yet. Use the diagnostic buttons above to verify connectivity.
                  </p>
                ) : (
                  <ul className="divide-y divide-slate-200 border border-slate-200 rounded-md">
                    {logs.map((entry) => (
                      <li key={entry.id} className="p-3 text-xs space-y-1">
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-medium text-slate-900">{entry.command_summary}</span>
                          <span className="font-mono text-slate-500 tabular-nums">
                            {formatDateTime(entry.performed_at)}
                          </span>
                        </div>
                        <p className="font-mono text-slate-700 bg-slate-50 px-2.5 py-1.5 rounded border border-slate-200/70 break-words">
                          {entry.output}
                        </p>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          )}
        </section>
      </div>

      {/* Create Manual Incident Modal */}
      {showCreateModal && (
        <div
          className="fixed inset-0 z-50 bg-slate-900/40 flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
        >
          <div className="bg-white border border-slate-200 rounded-lg w-full max-w-md overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
              <h2 className="text-base font-semibold text-slate-900">Log Manual Incident</h2>
              <button
                type="button"
                onClick={() => setShowCreateModal(false)}
                className="p-1 text-slate-400 hover:text-slate-700 cursor-pointer"
                aria-label="Close modal"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <form onSubmit={handleCreateSubmit} className="p-5 space-y-4">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Affected Device</label>
                <select
                  value={newDeviceId}
                  onChange={(e) => setNewDeviceId(Number(e.target.value))}
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-md bg-white focus:outline-none focus:border-blue-600"
                >
                  {devices.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name} ({d.ip_address})
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Severity Level</label>
                <select
                  value={newSeverity}
                  onChange={(e) => setNewSeverity(e.target.value as IncidentSeverity)}
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-md bg-white focus:outline-none focus:border-blue-600"
                >
                  <option value="critical">Critical</option>
                  <option value="high">High</option>
                  <option value="medium">Medium</option>
                  <option value="low">Low</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Incident Title</label>
                <input
                  type="text"
                  required
                  value={newTitle}
                  onChange={(e) => setNewTitle(e.target.value)}
                  placeholder="e.g. Packet Loss on Uplink Interface"
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-md focus:outline-none focus:border-blue-600"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Description</label>
                <textarea
                  rows={3}
                  required
                  value={newDesc}
                  onChange={(e) => setNewDesc(e.target.value)}
                  placeholder="Describe observed symptoms, affected subnet, or alarm details..."
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-md focus:outline-none focus:border-blue-600"
                />
              </div>
              <div className="pt-3 border-t border-slate-200 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  className="px-4 py-2 text-xs font-medium text-slate-700 border border-slate-200 rounded-md hover:bg-slate-50 cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 text-xs font-medium bg-slate-900 text-white rounded-md hover:bg-slate-800 cursor-pointer"
                >
                  Create Incident
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
