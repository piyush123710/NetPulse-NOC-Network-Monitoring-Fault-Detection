import { useEffect, useState } from 'react';
import { Check, Copy, Database, Download } from 'lucide-react';
import type { PingLog } from '../types';
import { formatDateTime } from '../utils/network';
import { DeviceStatusIndicator } from './StatusIndicators';

export function DatabaseView() {
  const [logs, setLogs] = useState<PingLog[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [mysqlDdl, setMysqlDdl] = useState('');
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let active = true;
    Promise.all([
      fetch('/api/ping-logs?limit=100').then((r) => r.json()),
      fetch('/api/sql-schema').then((r) => r.json()),
    ])
      .then(([logRows, schemaData]) => {
        if (!active) return;
        if (Array.isArray(logRows)) setLogs(logRows);
        if (schemaData?.counts) setCounts(schemaData.counts);
        if (schemaData?.mysqlDdl) setMysqlDdl(schemaData.mysqlDdl);
      })
      .catch(() => {})
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  function handleDownloadCsv() {
    const header = ['id', 'device_name', 'ip_address', 'status', 'response_time_ms', 'packet_loss_pct', 'error_message', 'checked_at'];
    const lines = [
      header.join(','),
      ...logs.map((row) =>
        [
          row.id,
          `"${(row.device_name || '').replace(/"/g, '""')}"`,
          row.ip_address || '',
          row.status,
          row.response_time_ms ?? '',
          row.packet_loss_pct,
          `"${(row.error_message || row.probe_detail || '').replace(/"/g, '""')}"`,
          row.checked_at,
        ].join(',')
      ),
    ];
    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `netpulse-ping-logs-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  function handleCopyDdl() {
    if (!mysqlDdl) return;
    navigator.clipboard.writeText(mysqlDdl).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    });
  }

  return (
    <div className="space-y-6">
      {/* Table Row Counts */}
      <section className="bg-white border border-slate-200 rounded-lg grid grid-cols-2 lg:grid-cols-4 divide-y sm:divide-y-0 sm:divide-x divide-slate-200">
        {[
          { label: 'devices', value: counts.devices ?? 0, desc: 'Monitored IP hosts' },
          { label: 'ping_logs', value: counts.ping_logs ?? 0, desc: 'Recorded RTT checks' },
          { label: 'incidents', value: counts.incidents ?? 0, desc: 'Fault & alert records' },
          { label: 'troubleshooting_logs', value: counts.troubleshooting_logs ?? 0, desc: 'Diagnostic actions' },
        ].map((item) => (
          <div key={item.label} className="p-5">
            <div className="text-xs font-mono text-slate-500">{item.label}</div>
            <div className="mt-1 text-2xl font-semibold font-mono tabular-nums text-slate-900">
              {item.value}
            </div>
            <div className="mt-1 text-xs text-slate-500">{item.desc}</div>
          </div>
        ))}
      </section>

      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
        {/* Ping Logs Audit Ledger */}
        <section className="xl:col-span-7 bg-white border border-slate-200 rounded-lg overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between gap-3">
            <div>
              <h2 className="text-base font-semibold text-slate-900">Relational Probe Audit Log</h2>
              <p className="text-xs text-slate-500">
                Latest 100 persisted connectivity and response-time records
              </p>
            </div>
            <button
              type="button"
              onClick={handleDownloadCsv}
              disabled={logs.length === 0}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 border border-slate-200 rounded-md hover:bg-slate-50 disabled:opacity-50 whitespace-nowrap cursor-pointer"
            >
              <Download className="h-3.5 w-3.5" aria-hidden="true" />
              Export CSV
            </button>
          </div>

          {loading ? (
            <div className="p-8 text-center text-xs text-slate-500">Loading database records...</div>
          ) : (
            <div className="overflow-x-auto max-h-[540px] overflow-y-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead className="sticky top-0 bg-slate-50 border-b border-slate-200 text-slate-500">
                  <tr>
                    <th className="py-2.5 px-4">Timestamp</th>
                    <th className="py-2.5 px-4">Host</th>
                    <th className="py-2.5 px-4">Status</th>
                    <th className="py-2.5 px-4 text-right">RTT</th>
                    <th className="py-2.5 px-4">Detail</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {logs.map((row) => (
                    <tr key={row.id} className="hover:bg-slate-50/70">
                      <td className="py-2.5 px-4 font-mono tabular-nums text-slate-600 whitespace-nowrap">
                        {formatDateTime(row.checked_at)}
                      </td>
                      <td className="py-2.5 px-4">
                        <div className="font-medium text-slate-900">{row.device_name}</div>
                        <div className="font-mono text-slate-500">{row.ip_address}</div>
                      </td>
                      <td className="py-2.5 px-4">
                        <DeviceStatusIndicator status={row.status} />
                      </td>
                      <td className="py-2.5 px-4 text-right font-mono tabular-nums text-slate-900">
                        {row.response_time_ms !== null ? `${row.response_time_ms.toFixed(1)} ms` : 'Timeout'}
                      </td>
                      <td className="py-2.5 px-4 font-mono text-slate-600 max-w-[220px] truncate">
                        {row.error_message || row.probe_detail || 'OK'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {/* MySQL-Compatible Relational DDL */}
        <section className="xl:col-span-5 bg-white border border-slate-200 rounded-lg overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <Database className="h-4 w-4 text-blue-600 shrink-0" aria-hidden="true" />
              <div>
                <h2 className="text-base font-semibold text-slate-900">MySQL / SQL Schema</h2>
                <p className="text-xs text-slate-500">Normalized relational schema for network telemetry</p>
              </div>
            </div>
            <button
              type="button"
              onClick={handleCopyDdl}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 border border-slate-200 rounded-md hover:bg-slate-50 whitespace-nowrap cursor-pointer"
            >
              {copied ? <Check className="h-3.5 w-3.5 text-emerald-700" /> : <Copy className="h-3.5 w-3.5" />}
              {copied ? 'Copied' : 'Copy SQL'}
            </button>
          </div>

          <pre className="p-4 text-[11px] leading-relaxed font-mono text-slate-800 bg-slate-50 overflow-x-auto max-h-[540px]">
            {mysqlDdl || 'Loading schema...'}
          </pre>
        </section>
      </div>
    </div>
  );
}
