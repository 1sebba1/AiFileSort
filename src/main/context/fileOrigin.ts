import fsp from 'fs/promises';
import { FileMeta } from '@shared/types';

function webHost(url: string | undefined): string | undefined {
  if (!url) return undefined;
  try {
    const u = new URL(url);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return undefined;
    return u.hostname.toLowerCase().replace(/^www\./, '') || undefined;
  } catch {
    return undefined;
  }
}

/** Hostname a file was downloaded from, given the text of its Zone.Identifier stream */
export function parseZoneIdentifier(content: string): string | undefined {
  const fields = new Map<string, string>();
  for (const line of content.replace(/^\uFEFF/, '').split(/\r?\n/)) {
    const m = line.match(/^\s*(HostUrl|ReferrerUrl)\s*=\s*(.+?)\s*$/i);
    if (m) fields.set(m[1].toLowerCase(), m[2]);
  }
  return webHost(fields.get('hosturl')) ?? webHost(fields.get('referrerurl'));
}

/**
 * Browsers on Windows tag downloads with an NTFS alternate data stream (Mark of the Web)
 * that records the source URL. Other platforms, and files without the stream, have no origin.
 */
export async function readOriginHost(
  absolutePath: string,
  platform: NodeJS.Platform = process.platform,
): Promise<string | undefined> {
  if (platform !== 'win32') return undefined;
  try {
    return parseZoneIdentifier(await fsp.readFile(`${absolutePath}:Zone.Identifier`, 'utf8'));
  } catch {
    return undefined;
  }
}

/** Prompt line like `hsbc.co.uk (6), mail.google.com (2)`, or null when nothing has an origin */
export function summarizeOrigins(files: FileMeta[], max = 4): string | null {
  const counts = new Map<string, number>();
  for (const f of files) {
    if (f.originHost) counts.set(f.originHost, (counts.get(f.originHost) ?? 0) + 1);
  }
  if (counts.size === 0) return null;
  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, max)
    .map(([host, n]) => `${host} (${n})`)
    .join(', ');
}
