import { useMemo, useState } from 'react';
import { Globe, Network, Play, Terminal } from 'lucide-react';
import type {
  DnsDiagnosticResult,
  NetworkDevice,
  PingDiagnosticResult,
  PortScanResult,
} from '../types';
import { calculateIpv4Subnet } from '../utils/network';

interface DiagnosticsViewProps {
  devices: NetworkDevice[];
}

export function DiagnosticsView({ devices }: DiagnosticsViewProps) {
  // Ping diagnostic state
  const [pingTarget, setPingTarget] = useState('8.8.8.8');
  const [pingPort, setPingPort] = useState('53');
  const [pingLoading, setPingLoading] = useState(false);
  const [pingError, setPingError] = useState<string | null>(null);
  const [pingResult, setPingResult] = useState<PingDiagnosticResult | null>(null);

  // Port scanner state
  const [scanTarget, setScanTarget] = useState('127.0.0.1');
  const [scanPortsInput, setScanPortsInput] = useState('22, 53, 80, 443, 3000, 3306, 5432, 8080');
  const [scanLoading, setScanLoading] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);
  const [scanResult, setScanResult] = useState<PortScanResult | null>(null);

  // DNS lookup state
  const [dnsQuery, setDnsQuery] = useState('github.com');
  const [dnsLoading, setDnsLoading] = useState(false);
  const [dnsError, setDnsError] = useState<string | null>(null);
  const [dnsResult, setDnsResult] = useState<DnsDiagnosticResult | null>(null);

  // IPv4 Subnet Calculator
  const [cidrInput, setCidrInput] = useState('192.168.10.45/26');
  const subnet = useMemo(() => calculateIpv4Subnet(cidrInput), [cidrInput]);

  async function runPing(e: React.FormEvent) {
    e.preventDefault();
    setPingLoading(true);
    setPingError(null);
    try {
      const res = await fetch('/api/diagnostics/ping', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          target: pingTarget.trim(),
          port: Number(pingPort) || 443,
          count: 4,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Ping failed');
      setPingResult(data);
    } catch (err) {
      setPingError(err instanceof Error ? err.message : 'Ping request failed');
    } finally {
      setPingLoading(false);
    }
  }

  async function runPortScan(e: React.FormEvent) {
    e.preventDefault();
    setScanLoading(true);
    setScanError(null);
    try {
      const ports = scanPortsInput
        .split(',')
        .map((s) => Number(s.trim()))
        .filter((n) => Number.isInteger(n) && n >= 1 && n <= 65535);
      const res = await fetch('/api/diagnostics/port-scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ target: scanTarget.trim(), ports }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Port scan failed');
      setScanResult(data);
    } catch (err) {
      setScanError(err instanceof Error ? err.message : 'Port scan failed');
    } finally {
      setScanLoading(false);
    }
  }

  async function runDnsLookup(e: React.FormEvent) {
    e.preventDefault();
    setDnsLoading(true);
    setDnsError(null);
    try {
      const res = await fetch('/api/diagnostics/dns', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: dnsQuery.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'DNS lookup failed');
      setDnsResult(data);
    } catch (err) {
      setDnsError(err instanceof Error ? err.message : 'DNS lookup failed');
    } finally {
      setDnsLoading(false);
    }
  }

  function applyQuickTarget(d: NetworkDevice) {
    const target = d.hostname || d.ip_address;
    setPingTarget(target);
    setPingPort(String(d.port));
    setScanTarget(target);
    setDnsQuery(target);
    if (d.subnet_cidr) setCidrInput(d.subnet_cidr);
  }

  return (
    <div className="space-y-6">
      {/* Quick Device Target Selector */}
      <section className="bg-white border border-slate-200 rounded-lg p-4 flex flex-wrap items-center gap-2">
        <span className="text-xs font-medium text-slate-500 mr-2">Load host target:</span>
        {devices.map((d) => (
          <button
            key={d.id}
            type="button"
            onClick={() => applyQuickTarget(d)}
            className="px-2.5 py-1.5 text-xs font-medium text-slate-700 bg-slate-50 border border-slate-200 rounded-md hover:bg-slate-100 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            {d.name} <span className="font-mono text-slate-500">({d.ip_address})</span>
          </button>
        ))}
      </section>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6 items-start">
        {/* 1. Live Ping & RTT Analyzer */}
        <section className="bg-white border border-slate-200 rounded-lg overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-200 flex items-center gap-2.5">
            <Play className="h-4 w-4 text-blue-600 shrink-0" aria-hidden="true" />
            <div>
              <h2 className="text-base font-semibold text-slate-900">Ping & Response-Time Probe</h2>
              <p className="text-xs text-slate-500">
                4-packet ICMP/TCP round-trip latency, jitter, and packet loss diagnostics
              </p>
            </div>
          </div>

          <form onSubmit={runPing} className="p-5 space-y-4">
            <div className="flex flex-wrap gap-3">
              <input
                type="text"
                value={pingTarget}
                onChange={(e) => setPingTarget(e.target.value)}
                placeholder="IP address or hostname"
                className="flex-1 min-w-[180px] px-3 py-2 text-sm font-mono border border-slate-200 rounded-md focus:outline-none focus:border-blue-600"
              />
              <input
                type="number"
                min={1}
                max={65535}
                value={pingPort}
                onChange={(e) => setPingPort(e.target.value)}
                placeholder="Port"
                className="w-24 px-3 py-2 text-sm font-mono border border-slate-200 rounded-md focus:outline-none focus:border-blue-600"
              />
              <button
                type="submit"
                disabled={pingLoading}
                className="px-4 py-2 text-xs font-medium bg-slate-900 text-white rounded-md hover:bg-slate-800 disabled:opacity-50 whitespace-nowrap shrink-0 cursor-pointer"
              >
                {pingLoading ? 'Probing...' : 'Run Ping Test'}
              </button>
            </div>

            {pingError && (
              <div className="p-3 text-xs text-red-800 bg-red-50 border border-red-200 rounded-md">
                {pingError}
              </div>
            )}

            {pingResult && (
              <div className="space-y-3 pt-2 border-t border-slate-200">
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                  <div>
                    <div className="text-slate-500">Packet Loss</div>
                    <div
                      className={`font-mono font-semibold tabular-nums mt-0.5 ${
                        pingResult.packetLossPct > 0 ? 'text-red-700' : 'text-emerald-700'
                      }`}
                    >
                      {pingResult.packetLossPct}% ({pingResult.packetsReceived}/{pingResult.packetsSent})
                    </div>
                  </div>
                  <div>
                    <div className="text-slate-500">Min / Avg RTT</div>
                    <div className="font-mono font-semibold text-slate-900 tabular-nums mt-0.5">
                      {pingResult.minMs !== null ? `${pingResult.minMs} / ${pingResult.avgMs} ms` : 'Timeout'}
                    </div>
                  </div>
                  <div>
                    <div className="text-slate-500">Max / Jitter</div>
                    <div className="font-mono font-semibold text-slate-900 tabular-nums mt-0.5">
                      {pingResult.maxMs !== null ? `${pingResult.maxMs} / ${pingResult.jitterMs} ms` : '—'}
                    </div>
                  </div>
                  <div>
                    <div className="text-slate-500">Resolved IP</div>
                    <div className="font-mono text-slate-900 tabular-nums mt-0.5 truncate">
                      {pingResult.resolvedIp || 'Unresolved'}
                    </div>
                  </div>
                </div>

                <div className="border border-slate-200 rounded-md divide-y divide-slate-200 text-xs font-mono">
                  {pingResult.packets.map((pkt) => (
                    <div
                      key={pkt.seq}
                      className="px-3 py-2 flex items-center justify-between gap-2 tabular-nums"
                    >
                      <span className="text-slate-700">
                        seq={pkt.seq} · {pkt.method} · {pkt.detail}
                      </span>
                      <span
                        className={`font-medium shrink-0 ${
                          pkt.success ? 'text-emerald-700' : 'text-red-700'
                        }`}
                      >
                        {pkt.latencyMs !== null ? `${pkt.latencyMs.toFixed(2)} ms` : 'TIMEOUT'}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </form>
        </section>

        {/* 2. TCP Port Connectivity Scanner */}
        <section className="bg-white border border-slate-200 rounded-lg overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-200 flex items-center gap-2.5">
            <Terminal className="h-4 w-4 text-blue-600 shrink-0" aria-hidden="true" />
            <div>
              <h2 className="text-base font-semibold text-slate-900">TCP Port Connectivity Scanner</h2>
              <p className="text-xs text-slate-500">
                Verify open, refused, or filtered TCP services across infrastructure ports
              </p>
            </div>
          </div>

          <form onSubmit={runPortScan} className="p-5 space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-12 gap-3">
              <input
                type="text"
                value={scanTarget}
                onChange={(e) => setScanTarget(e.target.value)}
                placeholder="Host or IP"
                className="sm:col-span-5 px-3 py-2 text-sm font-mono border border-slate-200 rounded-md focus:outline-none focus:border-blue-600"
              />
              <input
                type="text"
                value={scanPortsInput}
                onChange={(e) => setScanPortsInput(e.target.value)}
                placeholder="22, 53, 80, 443, 3306"
                className="sm:col-span-4 px-3 py-2 text-sm font-mono border border-slate-200 rounded-md focus:outline-none focus:border-blue-600"
              />
              <button
                type="submit"
                disabled={scanLoading}
                className="sm:col-span-3 px-4 py-2 text-xs font-medium bg-slate-900 text-white rounded-md hover:bg-slate-800 disabled:opacity-50 whitespace-nowrap cursor-pointer"
              >
                {scanLoading ? 'Scanning...' : 'Scan Ports'}
              </button>
            </div>

            {scanError && (
              <div className="p-3 text-xs text-red-800 bg-red-50 border border-red-200 rounded-md">
                {scanError}
              </div>
            )}

            {scanResult && (
              <div className="border border-slate-200 rounded-md overflow-hidden">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50/70 text-slate-500">
                      <th className="py-2 px-3">Port</th>
                      <th className="py-2 px-3">Service</th>
                      <th className="py-2 px-3">State</th>
                      <th className="py-2 px-3 text-right">RTT</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 font-mono tabular-nums">
                    {scanResult.results.map((r) => (
                      <tr key={r.port}>
                        <td className="py-2 px-3 text-slate-900 font-medium">TCP/{r.port}</td>
                        <td className="py-2 px-3 text-slate-600 font-sans">{r.service}</td>
                        <td
                          className={`py-2 px-3 font-medium uppercase ${
                            r.state === 'open'
                              ? 'text-emerald-700'
                              : r.state === 'closed'
                              ? 'text-amber-700'
                              : 'text-red-700'
                          }`}
                        >
                          {r.state}
                        </td>
                        <td className="py-2 px-3 text-right text-slate-700">
                          {r.latencyMs !== null ? `${r.latencyMs.toFixed(1)} ms` : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </form>
        </section>

        {/* 3. IPv4 Subnet & CIDR Calculator */}
        <section className="bg-white border border-slate-200 rounded-lg overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-200 flex items-center gap-2.5">
            <Network className="h-4 w-4 text-blue-600 shrink-0" aria-hidden="true" />
            <div>
              <h2 className="text-base font-semibold text-slate-900">
                IPv4 Subnet & CIDR Calculator
              </h2>
              <p className="text-xs text-slate-500">
                Compute network boundaries, broadcast IP, usable host range, and RFC 1918 scope
              </p>
            </div>
          </div>

          <div className="p-5 space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <input
                type="text"
                value={cidrInput}
                onChange={(e) => setCidrInput(e.target.value)}
                placeholder="e.g. 192.168.10.45/26"
                className="flex-1 min-w-[200px] px-3 py-2 text-sm font-mono border border-slate-200 rounded-md focus:outline-none focus:border-blue-600"
              />
              {['10.20.1.0/24', '192.168.10.45/26', '172.16.0.1/22'].map((preset) => (
                <button
                  key={preset}
                  type="button"
                  onClick={() => setCidrInput(preset)}
                  className="px-2.5 py-2 text-xs font-mono text-slate-600 border border-slate-200 rounded-md hover:bg-slate-50 whitespace-nowrap cursor-pointer"
                >
                  {preset}
                </button>
              ))}
            </div>

            {!subnet.valid ? (
              <div className="p-3 text-xs text-red-800 bg-red-50 border border-red-200 rounded-md">
                {subnet.error}
              </div>
            ) : (
              <div className="border border-slate-200 rounded-md divide-y divide-slate-200 text-xs">
                <div className="grid grid-cols-2 divide-x divide-slate-200">
                  <div className="p-3">
                    <div className="text-slate-500">Network Address</div>
                    <div className="font-mono font-semibold text-slate-900 tabular-nums mt-0.5">
                      {subnet.networkAddress}/{subnet.prefix}
                    </div>
                  </div>
                  <div className="p-3">
                    <div className="text-slate-500">Broadcast Address</div>
                    <div className="font-mono font-semibold text-slate-900 tabular-nums mt-0.5">
                      {subnet.broadcastAddress}
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-2 divide-x divide-slate-200">
                  <div className="p-3">
                    <div className="text-slate-500">Usable Host Range</div>
                    <div className="font-mono text-slate-900 tabular-nums mt-0.5">
                      {subnet.firstUsable} – {subnet.lastUsable}
                    </div>
                  </div>
                  <div className="p-3">
                    <div className="text-slate-500">Usable Hosts / Total</div>
                    <div className="font-mono font-semibold text-slate-900 tabular-nums mt-0.5">
                      {subnet.usableHosts.toLocaleString()} / {subnet.totalAddresses.toLocaleString()}
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-2 divide-x divide-slate-200">
                  <div className="p-3">
                    <div className="text-slate-500">Subnet Mask</div>
                    <div className="font-mono text-slate-900 tabular-nums mt-0.5">
                      {subnet.subnetMask}
                    </div>
                  </div>
                  <div className="p-3">
                    <div className="text-slate-500">Wildcard Mask</div>
                    <div className="font-mono text-slate-900 tabular-nums mt-0.5">
                      {subnet.wildcardMask}
                    </div>
                  </div>
                </div>

                <div className="p-3 flex flex-wrap items-center justify-between gap-2 bg-slate-50/60">
                  <span className="text-slate-600">
                    {subnet.ipClass} · {subnet.scope}
                  </span>
                  <span className="font-mono text-[11px] text-slate-500">{subnet.binaryMask}</span>
                </div>
              </div>
            )}
          </div>
        </section>

        {/* 4. DNS & Reverse PTR Resolution */}
        <section className="bg-white border border-slate-200 rounded-lg overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-200 flex items-center gap-2.5">
            <Globe className="h-4 w-4 text-blue-600 shrink-0" aria-hidden="true" />
            <div>
              <h2 className="text-base font-semibold text-slate-900">DNS & Reverse PTR Lookup</h2>
              <p className="text-xs text-slate-500">
                Verify forward A/AAAA records and reverse hostname mapping
              </p>
            </div>
          </div>

          <form onSubmit={runDnsLookup} className="p-5 space-y-4">
            <div className="flex gap-3">
              <input
                type="text"
                value={dnsQuery}
                onChange={(e) => setDnsQuery(e.target.value)}
                placeholder="Domain or IP address (e.g. github.com or 8.8.8.8)"
                className="flex-1 px-3 py-2 text-sm font-mono border border-slate-200 rounded-md focus:outline-none focus:border-blue-600"
              />
              <button
                type="submit"
                disabled={dnsLoading}
                className="px-4 py-2 text-xs font-medium bg-slate-900 text-white rounded-md hover:bg-slate-800 disabled:opacity-50 whitespace-nowrap shrink-0 cursor-pointer"
              >
                {dnsLoading ? 'Resolving...' : 'Resolve DNS'}
              </button>
            </div>

            {dnsError && (
              <div className="p-3 text-xs text-red-800 bg-red-50 border border-red-200 rounded-md">
                {dnsError}
              </div>
            )}

            {dnsResult && (
              <div className="border border-slate-200 rounded-md divide-y divide-slate-200 text-xs">
                <div className="p-3 flex items-center justify-between">
                  <span className="text-slate-500">Query Time</span>
                  <span className="font-mono font-medium text-slate-900 tabular-nums">
                    {dnsResult.lookupMs.toFixed(2)} ms
                  </span>
                </div>
                <div className="p-3">
                  <div className="text-slate-500 mb-1">IPv4 (A Records)</div>
                  <div className="font-mono text-slate-900">
                    {dnsResult.ipv4.length > 0 ? dnsResult.ipv4.join(', ') : 'None found'}
                  </div>
                </div>
                <div className="p-3">
                  <div className="text-slate-500 mb-1">IPv6 (AAAA Records)</div>
                  <div className="font-mono text-slate-900 break-all">
                    {dnsResult.ipv6.length > 0 ? dnsResult.ipv6.join(', ') : 'None found'}
                  </div>
                </div>
                <div className="p-3">
                  <div className="text-slate-500 mb-1">Reverse PTR Hostnames</div>
                  <div className="font-mono text-slate-900">
                    {dnsResult.reverseHostnames.length > 0
                      ? dnsResult.reverseHostnames.join(', ')
                      : 'No PTR record'}
                  </div>
                </div>
                {dnsResult.error && (
                  <div className="p-3 text-red-700 font-medium">{dnsResult.error}</div>
                )}
              </div>
            )}
          </form>
        </section>
      </div>
    </div>
  );
}
