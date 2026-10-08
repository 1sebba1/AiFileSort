import fsp from 'fs/promises';
import { FileMeta } from '@shared/types';
import { parseZoneIdentifier, readOriginHost, summarizeOrigins } from './fileOrigin';

jest.mock('fs/promises');
const mockFsp = fsp as jest.Mocked<typeof fsp>;

describe('parseZoneIdentifier', () => {
  it('returns the HostUrl hostname without www', () => {
    expect(parseZoneIdentifier('[ZoneTransfer]\nZoneId=3\nHostUrl=https://www.GitHub.com/x/y.zip\n')).toBe('github.com');
  });

  it('handles CRLF line endings and a BOM', () => {
    const content = '\uFEFF[ZoneTransfer]\r\nZoneId=3\r\nReferrerUrl=https://discord.com/channels/1\r\nHostUrl=https://cdn.discordapp.com/a.png\r\n';
    expect(parseZoneIdentifier(content)).toBe('cdn.discordapp.com');
  });

  it('falls back to ReferrerUrl when HostUrl is not a web URL', () => {
    const content = '[ZoneTransfer]\nZoneId=3\nReferrerUrl=https://mail.google.com/mail/u/0\nHostUrl=blob:https://mail.google.com/abc\n';
    expect(parseZoneIdentifier(content)).toBe('mail.google.com');
  });

  it.each([
    '[ZoneTransfer]\nZoneId=3\nHostUrl=about:internet\n',
    '[ZoneTransfer]\nZoneId=3\n',
    'garbage',
    '',
  ])('returns undefined for %p', (content) => {
    expect(parseZoneIdentifier(content)).toBeUndefined();
  });
});

describe('readOriginHost', () => {
  it('reads the Zone.Identifier stream on Windows', async () => {
    mockFsp.readFile = jest.fn().mockResolvedValue('[ZoneTransfer]\nHostUrl=https://example.org/f.pdf\n');
    expect(await readOriginHost('C:\\d\\f.pdf', 'win32')).toBe('example.org');
    expect(mockFsp.readFile).toHaveBeenCalledWith('C:\\d\\f.pdf:Zone.Identifier', 'utf8');
  });

  it('returns undefined when the stream is missing', async () => {
    mockFsp.readFile = jest.fn().mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }));
    expect(await readOriginHost('C:\\d\\f.pdf', 'win32')).toBeUndefined();
  });

  it('does nothing on other platforms', async () => {
    mockFsp.readFile = jest.fn();
    expect(await readOriginHost('/d/f.pdf', 'linux')).toBeUndefined();
    expect(mockFsp.readFile).not.toHaveBeenCalled();
  });
});

describe('summarizeOrigins', () => {
  const f = (originHost?: string) => ({ originHost } as FileMeta);
  it('counts hosts, most frequent first', () => {
    expect(summarizeOrigins([f('a.com'), f('b.com'), f('a.com'), f()])).toBe('a.com (2), b.com (1)');
  });
  it('returns null when no file has an origin', () => {
    expect(summarizeOrigins([f(), f()])).toBeNull();
  });
});
