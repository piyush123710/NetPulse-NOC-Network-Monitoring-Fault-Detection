import { AlertTriangle, CheckCircle2, Clock, ShieldAlert, XCircle } from 'lucide-react';
import type { DeviceStatus, IncidentSeverity, IncidentStatus } from '../types';

export function DeviceStatusIndicator({ status }: { status: DeviceStatus }) {
  if (status === 'online') {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-700 whitespace-nowrap">
        <CheckCircle2 className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        Online
      </span>
    );
  }
  if (status === 'degraded') {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-amber-700 whitespace-nowrap">
        <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        Degraded
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 text-xs font-medium text-red-700 whitespace-nowrap">
      <XCircle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      Offline
    </span>
  );
}

export function SeverityIndicator({ severity }: { severity: IncidentSeverity }) {
  switch (severity) {
    case 'critical':
      return (
        <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-red-700 whitespace-nowrap">
          <ShieldAlert className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          Critical
        </span>
      );
    case 'high':
      return (
        <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-orange-700 whitespace-nowrap">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          High
        </span>
      );
    case 'medium':
      return (
        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-amber-700 whitespace-nowrap">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          Medium
        </span>
      );
    default:
      return (
        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-600 whitespace-nowrap">
          <Clock className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          Low
        </span>
      );
  }
}

export function IncidentStatusIndicator({ status }: { status: IncidentStatus }) {
  if (status === 'open') {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-red-700 whitespace-nowrap">
        <XCircle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        Open
      </span>
    );
  }
  if (status === 'investigating') {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-blue-700 whitespace-nowrap">
        <Clock className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        Investigating
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-700 whitespace-nowrap">
      <CheckCircle2 className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      Resolved
    </span>
  );
}
