import { useCallback, useEffect, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  Database,
  Menu,
  Plus,
  RefreshCw,
  Server,
  Wrench,
  X,
} from 'lucide-react';
import { DatabaseView } from './components/DatabaseView';
import { DevicesView } from './components/DevicesView';
import { DiagnosticsView } from './components/DiagnosticsView';
import { IncidentsView } from './components/IncidentsView';
import { OverviewView } from './components/OverviewView';
import type {
  FaultSimulationMode,
  Incident,
  IncidentSeverity,
  IncidentStatus,
  NetworkDevice,
  OverviewResponse,
  ProbeMethod,
} from './types';

type NavTab = 'overview' | 'devices' | 'incidents' | 'diagnostics' | 'database';

const TAB_LABELS: Record<NavTab, string> = {
  overview: 'Overview',
  devices: 'Devices & IPs',
  incidents: 'Incident Log',
  diagnostics: 'TCP/IP Diagnostics',
  database: 'SQL Telemetry',
};

export default function App() {
  const [activeTab, setActiveTab] = useState<NavTab>('overview');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const [overview, setOverview] = useState<OverviewResponse | null>(null);
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [autoPoll, setAutoPoll] = useState(true);
  const [probingAll, setProbingAll] = useState(false);
  const [probingDeviceId, setProbingDeviceId] = useState<number | null>(null);

  const [selectedDeviceId, setSelectedDeviceId] = useState<number | null>(null);
  const [selectedIncidentId, setSelectedIncidentId] = useState<number | null>(null);
  const [showAddDeviceModal, setShowAddDeviceModal] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    try {
      const [ovRes, incRes] = await Promise.all([
        fetch('/api/overview'),
        fetch('/api/incidents'),
      ]);
      if (!ovRes.ok || !incRes.ok) {
        throw new Error('Failed to load network monitoring data.');
      }
      const [ovData, incData] = await Promise.all([ovRes.json(), incRes.json()]);
      setOverview(ovData);
      setIncidents(incData);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to reach monitoring server.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  useEffect(() => {
    if (!autoPoll) return;
    const timer = setInterval(() => {
      fetchData();
    }, 15_000);
    return () => clearInterval(timer);
  }, [autoPoll, fetchData]);

  function showTransientNotice(msg: string) {
    setNotice(msg);
    setTimeout(() => {
      setNotice((prev) => (prev === msg ? null : prev));
    }, 4500);
  }

  async function handleProbeAll() {
    setProbingAll(true);
    try {
      const res = await fetch('/api/probe-all', { method: 'POST' });
      if (!res.ok) throw new Error('Probe sweep failed');
      const data = await res.json();
      await fetchData();
      showTransientNotice(`Completed live probe sweep across ${data.probed} devices.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Probe sweep failed');
    } finally {
      setProbingAll(false);
    }
  }

  async function handleProbeDevice(deviceId: number) {
    setProbingDeviceId(deviceId);
    try {
      const res = await fetch(`/api/devices/${deviceId}/probe`, { method: 'POST' });
      const data = await res.json();
      await fetchData();
      if (data?.createdIncidentId) {
        showTransientNotice(`Fault detected on ${data.device?.name}. New incident logged.`);
      } else if (data?.device) {
        showTransientNotice(
          `${data.device.name}: ${data.device.status.toUpperCase()}${
            data.device.last_latency_ms !== null ? ` (${data.device.last_latency_ms.toFixed(1)} ms)` : ''
          }`
        );
      }
    } finally {
      setProbingDeviceId(null);
    }
  }

  async function handleSimulateFault(deviceId: number, mode: FaultSimulationMode) {
    setProbingDeviceId(deviceId);
    try {
      const res = await fetch(`/api/devices/${deviceId}/simulate-fault`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode }),
      });
      const data = await res.json();
      await fetchData();
      if (mode === 'none') {
        showTransientNotice(`Restored live probing for ${data.device?.name || 'device'}.`);
      } else if (data?.createdIncidentId) {
        showTransientNotice(
          `Fault injected on ${data.device?.name}. Automated alert and incident created.`
        );
      }
    } finally {
      setProbingDeviceId(null);
    }
  }

  async function handleAddDevice(payload: {
    name: string;
    ip_address: string;
    hostname: string;
    device_type: string;
    probe_method: ProbeMethod;
    port: number;
    subnet_cidr: string;
    location: string;
    latency_warn_ms: number;
  }) {
    const res = await fetch('/api/devices', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to create device');
    await fetchData();
    showTransientNotice(`Added ${data.name} (${data.ip_address}) and ran initial probe.`);
  }

  async function handleDeleteDevice(deviceId: number) {
    const res = await fetch(`/api/devices/${deviceId}`, { method: 'DELETE' });
    if (res.ok) {
      if (selectedDeviceId === deviceId) setSelectedDeviceId(null);
      await fetchData();
      showTransientNotice('Device removed from monitoring inventory.');
    }
  }

  async function handleUpdateIncident(
    id: number,
    updates: {
      status?: IncidentStatus;
      severity?: IncidentSeverity;
      root_cause?: string;
      resolution_notes?: string;
    }
  ) {
    const res = await fetch(`/api/incidents/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updates),
    });
    if (res.ok) {
      await fetchData();
      showTransientNotice(`Updated incident INC-${String(id).padStart(4, '0')}.`);
    }
  }

  async function handleCreateIncident(payload: {
    device_id: number;
    title: string;
    description: string;
    severity: IncidentSeverity;
  }) {
    const res = await fetch('/api/incidents', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (res.ok) {
      const created: Incident = await res.json();
      await fetchData();
      setSelectedIncidentId(created.id);
      showTransientNotice(`Logged incident INC-${String(created.id).padStart(4, '0')}.`);
    }
  }

  const openIncidentCount = overview?.summary.openIncidents ?? 0;

  const navItems: Array<{
    id: NavTab;
    label: string;
    icon: typeof Activity;
    count?: number;
  }> = [
    { id: 'overview', label: 'Overview', icon: Activity },
    { id: 'devices', label: 'Devices & IPs', icon: Server, count: overview?.summary.totalDevices },
    { id: 'incidents', label: 'Incident Log', icon: AlertTriangle, count: openIncidentCount },
    { id: 'diagnostics', label: 'TCP/IP Diagnostics', icon: Wrench },
    { id: 'database', label: 'SQL Telemetry', icon: Database },
  ];

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 flex">
      {/* Mobile Sidebar Backdrop */}
      {mobileMenuOpen && (
        <div
          className="fixed inset-0 z-30 bg-slate-900/40 lg:hidden"
          onClick={() => setMobileMenuOpen(false)}
          aria-hidden="true"
        />
      )}

      {/* Left Workspace Sidebar */}
      <aside
        className={`fixed inset-y-0 left-0 z-40 w-64 bg-white border-r border-slate-200 flex flex-col transition-transform duration-200 lg:static lg:translate-x-0 ${
          mobileMenuOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="h-14 px-5 border-b border-slate-200 flex items-center justify-between shrink-0">
          <button
            type="button"
            onClick={() => {
              setActiveTab('overview');
              setMobileMenuOpen(false);
            }}
            className="text-base font-bold tracking-tight text-slate-900 whitespace-nowrap shrink-0 cursor-pointer"
          >
            NetPulse NOC
          </button>
          <button
            type="button"
            onClick={() => setMobileMenuOpen(false)}
            className="p-1 text-slate-500 hover:text-slate-800 lg:hidden cursor-pointer"
            aria-label="Close navigation menu"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <nav className="flex-1 p-3 space-y-1 overflow-y-auto" aria-label="Primary navigation">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = activeTab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => {
                  setActiveTab(item.id);
                  setMobileMenuOpen(false);
                }}
                className={`w-full flex items-center justify-between gap-3 px-3 py-2 text-sm font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  isActive
                    ? 'bg-slate-900 text-white'
                    : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                }`}
              >
                <span className="inline-flex items-center gap-2.5 truncate">
                  <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
                  <span>{item.label}</span>
                </span>
                {typeof item.count === 'number' && (
                  <span
                    className={`font-mono text-xs tabular-nums ${
                      isActive
                        ? 'text-slate-300'
                        : item.id === 'incidents' && item.count > 0
                        ? 'text-red-700 font-semibold'
                        : 'text-slate-400'
                    }`}
                  >
                    {item.count}
                  </span>
                )}
              </button>
            );
          })}
        </nav>

        <div className="p-4 border-t border-slate-200 space-y-2 text-xs">
          <div className="flex items-center justify-between">
            <span className="text-slate-600 font-medium">Auto-refresh</span>
            <button
              type="button"
              onClick={() => setAutoPoll((v) => !v)}
              className={`px-2.5 py-1 rounded border text-xs font-medium transition-colors whitespace-nowrap cursor-pointer ${
                autoPoll
                  ? 'border-blue-200 bg-blue-50 text-blue-700'
                  : 'border-slate-200 bg-white text-slate-600'
              }`}
            >
              {autoPoll ? 'Every 15s' : 'Paused'}
            </button>
          </div>
          <p className="text-[11px] text-slate-500">
            Backend prober checks TCP/ICMP endpoints every 20s and logs to SQLite.
          </p>
        </div>
      </aside>

      {/* Main Viewport */}
      <div className="flex-1 min-w-0 flex flex-col">
        {/* Top Bar Contract: Breadcrumb on left, 2 single-line primary actions on right */}
        <header className="h-14 bg-white border-b border-slate-200 px-4 sm:px-6 flex items-center justify-between gap-4 sticky top-0 z-20 shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => setMobileMenuOpen(true)}
              className="p-1.5 text-slate-600 border border-slate-200 rounded-md hover:bg-slate-50 lg:hidden cursor-pointer"
              aria-label="Open navigation menu"
            >
              <Menu className="h-4 w-4" />
            </button>
            <div className="flex items-center gap-2 text-sm min-w-0 truncate">
              <span className="text-slate-500 hidden sm:inline">NetPulse</span>
              <span className="text-slate-300 hidden sm:inline" aria-hidden="true">
                /
              </span>
              <h1 className="font-semibold text-slate-900 truncate">{TAB_LABELS[activeTab]}</h1>
            </div>
          </div>

          <div className="flex items-center gap-2.5 shrink-0">
            <button
              type="button"
              onClick={handleProbeAll}
              disabled={probingAll}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-md hover:bg-slate-50 disabled:opacity-50 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <RefreshCw
                className={`h-3.5 w-3.5 ${probingAll ? 'animate-spin' : ''}`}
                aria-hidden="true"
              />
              {probingAll ? 'Probing...' : 'Run All Probes'}
            </button>
            <button
              type="button"
              onClick={() => {
                setActiveTab('devices');
                setShowAddDeviceModal(true);
              }}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Plus className="h-3.5 w-3.5" aria-hidden="true" />
              Add Device
            </button>
          </div>
        </header>

        {/* Main Content */}
        <main className="flex-1 p-4 sm:p-6 max-w-[1440px] w-full mx-auto space-y-5">
          {notice && (
            <div className="bg-slate-900 text-white text-xs px-4 py-2.5 rounded-md flex items-center justify-between gap-4">
              <span>{notice}</span>
              <button
                type="button"
                onClick={() => setNotice(null)}
                className="text-slate-300 hover:text-white cursor-pointer"
                aria-label="Dismiss notification"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          )}

          {error && (
            <div className="bg-red-50 border border-red-200 text-red-900 text-xs px-4 py-3 rounded-md flex items-center justify-between gap-4">
              <span>{error}</span>
              <button
                type="button"
                onClick={fetchData}
                className="px-2.5 py-1 bg-white border border-red-200 rounded text-red-800 hover:bg-red-100 cursor-pointer"
              >
                Retry
              </button>
            </div>
          )}

          {loading && !overview ? (
            <div className="space-y-6">
              <div className="h-24 bg-white border border-slate-200 rounded-lg animate-pulse" />
              <div className="grid grid-cols-1 xl:grid-cols-12 gap-6">
                <div className="xl:col-span-8 h-80 bg-white border border-slate-200 rounded-lg animate-pulse" />
                <div className="xl:col-span-4 h-80 bg-white border border-slate-200 rounded-lg animate-pulse" />
              </div>
            </div>
          ) : overview ? (
            <>
              {activeTab === 'overview' && (
                <OverviewView
                  overview={overview}
                  probingDeviceId={probingDeviceId}
                  onProbeDevice={handleProbeDevice}
                  onOpenIncident={(inc) => {
                    setSelectedIncidentId(inc.id);
                    setActiveTab('incidents');
                  }}
                  onInspectDevice={(dev) => {
                    setSelectedDeviceId(dev.id);
                    setActiveTab('devices');
                  }}
                  onNavigateTab={(tab) => setActiveTab(tab)}
                />
              )}

              {activeTab === 'devices' && (
                <DevicesView
                  devices={overview.devices}
                  selectedDeviceId={selectedDeviceId}
                  probingDeviceId={probingDeviceId}
                  onSelectDevice={(dev) => setSelectedDeviceId(dev ? dev.id : null)}
                  onProbeDevice={handleProbeDevice}
                  onSimulateFault={handleSimulateFault}
                  onDeleteDevice={handleDeleteDevice}
                  onAddDevice={handleAddDevice}
                  showAddModal={showAddDeviceModal}
                  onCloseAddModal={() => setShowAddDeviceModal(false)}
                  onOpenAddModal={() => setShowAddDeviceModal(true)}
                />
              )}

              {activeTab === 'incidents' && (
                <IncidentsView
                  incidents={incidents}
                  devices={overview.devices}
                  selectedIncidentId={selectedIncidentId}
                  onSelectIncident={setSelectedIncidentId}
                  onUpdateIncident={handleUpdateIncident}
                  onCreateIncident={handleCreateIncident}
                />
              )}

              {activeTab === 'diagnostics' && <DiagnosticsView devices={overview.devices} />}

              {activeTab === 'database' && <DatabaseView />}
            </>
          ) : null}
        </main>
      </div>
    </div>
  );
}
