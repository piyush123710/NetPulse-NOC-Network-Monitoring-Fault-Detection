export interface SubnetInfo {
  valid: boolean;
  error?: string;
  ip: string;
  prefix: number;
  networkAddress: string;
  broadcastAddress: string;
  firstUsable: string;
  lastUsable: string;
  subnetMask: string;
  wildcardMask: string;
  totalAddresses: number;
  usableHosts: number;
  ipClass: string;
  scope: string;
  binaryMask: string;
}

function ipToInt(ip: string): number {
  const parts = ip.split('.').map(Number);
  return (
    (((parts[0] << 24) >>> 0) +
      ((parts[1] << 16) >>> 0) +
      ((parts[2] << 8) >>> 0) +
      (parts[3] >>> 0)) >>>
    0
  );
}

function intToIp(num: number): string {
  return [
    (num >>> 24) & 255,
    (num >>> 16) & 255,
    (num >>> 8) & 255,
    num & 255,
  ].join('.');
}

function isValidIpv4(ip: string): boolean {
  const parts = ip.trim().split('.');
  if (parts.length !== 4) return false;
  return parts.every((part) => {
    if (!/^\d{1,3}$/.test(part)) return false;
    const n = Number(part);
    return n >= 0 && n <= 255;
  });
}

export function calculateIpv4Subnet(cidrInput: string): SubnetInfo {
  const cleaned = cidrInput.trim();
  const [ipPart, prefixPart] = cleaned.split('/');
  if (!ipPart || !isValidIpv4(ipPart)) {
    return {
      valid: false,
      error: 'Enter a valid IPv4 CIDR (e.g. 192.168.10.45/24)',
      ip: '',
      prefix: 24,
      networkAddress: '-',
      broadcastAddress: '-',
      firstUsable: '-',
      lastUsable: '-',
      subnetMask: '-',
      wildcardMask: '-',
      totalAddresses: 0,
      usableHosts: 0,
      ipClass: '-',
      scope: '-',
      binaryMask: '-',
    };
  }

  const prefix = prefixPart === undefined ? 24 : Number(prefixPart);
  if (!Number.isInteger(prefix) || prefix < 0 || prefix > 32) {
    return {
      valid: false,
      error: 'CIDR prefix must be between /0 and /32',
      ip: ipPart,
      prefix: 24,
      networkAddress: '-',
      broadcastAddress: '-',
      firstUsable: '-',
      lastUsable: '-',
      subnetMask: '-',
      wildcardMask: '-',
      totalAddresses: 0,
      usableHosts: 0,
      ipClass: '-',
      scope: '-',
      binaryMask: '-',
    };
  }

  const ipInt = ipToInt(ipPart);
  const maskInt = prefix === 0 ? 0 : (~0 << (32 - prefix)) >>> 0;
  const wildcardInt = (~maskInt) >>> 0;
  const networkInt = (ipInt & maskInt) >>> 0;
  const broadcastInt = (networkInt | wildcardInt) >>> 0;
  const totalAddresses = Math.pow(2, 32 - prefix);

  let usableHosts = totalAddresses - 2;
  let firstUsable = intToIp((networkInt + 1) >>> 0);
  let lastUsable = intToIp((broadcastInt - 1) >>> 0);

  if (prefix === 32) {
    usableHosts = 1;
    firstUsable = intToIp(networkInt);
    lastUsable = intToIp(networkInt);
  } else if (prefix === 31) {
    usableHosts = 2;
    firstUsable = intToIp(networkInt);
    lastUsable = intToIp(broadcastInt);
  } else if (usableHosts < 0) {
    usableHosts = 0;
  }

  const firstOctet = (ipInt >>> 24) & 255;
  const secondOctet = (ipInt >>> 16) & 255;

  let ipClass = 'Class E (Experimental)';
  if (firstOctet <= 127) ipClass = 'Class A';
  else if (firstOctet <= 191) ipClass = 'Class B';
  else if (firstOctet <= 223) ipClass = 'Class C';
  else if (firstOctet <= 239) ipClass = 'Class D (Multicast)';

  let scope = 'Public Routable';
  if (firstOctet === 10) scope = 'RFC 1918 Private (10.0.0.0/8)';
  else if (firstOctet === 172 && secondOctet >= 16 && secondOctet <= 31)
    scope = 'RFC 1918 Private (172.16.0.0/12)';
  else if (firstOctet === 192 && secondOctet === 168)
    scope = 'RFC 1918 Private (192.168.0.0/16)';
  else if (firstOctet === 127) scope = 'Loopback (127.0.0.0/8)';
  else if (firstOctet === 169 && secondOctet === 254) scope = 'APIPA Link-Local';

  const maskBytes = [
    (maskInt >>> 24) & 255,
    (maskInt >>> 16) & 255,
    (maskInt >>> 8) & 255,
    maskInt & 255,
  ];
  const binaryMask = maskBytes.map((b) => b.toString(2).padStart(8, '0')).join('.');

  return {
    valid: true,
    ip: ipPart,
    prefix,
    networkAddress: intToIp(networkInt),
    broadcastAddress: intToIp(broadcastInt),
    firstUsable,
    lastUsable,
    subnetMask: intToIp(maskInt),
    wildcardMask: intToIp(wildcardInt),
    totalAddresses,
    usableHosts,
    ipClass,
    scope,
    binaryMask,
  };
}

export function formatTimestamp(iso: string | null): string {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
}

export function formatDateTime(iso: string | null): string {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString([], {
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
}

export function formatRelativeTime(iso: string | null): string {
  if (!iso) return 'Never';
  const diffSec = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (diffSec < 5) return 'Just now';
  if (diffSec < 60) return `${diffSec}s ago`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  return `${Math.floor(diffHr / 24)}d ago`;
}
