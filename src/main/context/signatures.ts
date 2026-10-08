export interface Signature {
  pattern: RegExp;
  app: string;
  category: string;
  /** Advisory only — the user's existing folders always take priority */
  folderHint?: string;
}

// Word-ish boundary for names like "P60_2025.pdf" or "my-tax-return.pdf" without matching "syntax.md"
const B = '(?:^|[-_ .()])';
const E = '(?:[-_ .()]|$)';

export const SIGNATURES: Signature[] = [
  // Screenshots
  { pattern: /^Screenshot[ _(-]/i, app: 'Screenshot', category: 'Screenshots', folderHint: 'Screenshots' },
  { pattern: /^Screen ?Shot \d{4}-\d{2}-\d{2}/i, app: 'macOS screenshot', category: 'Screenshots', folderHint: 'Screenshots' },
  { pattern: /^(Snip|Snagit|Lightshot|ShareX_)/i, app: 'Screen capture tool', category: 'Screenshots', folderHint: 'Screenshots' },
  { pattern: /^(Capture|Annotation) \d{4}-\d{2}-\d{2}/i, app: 'Windows capture', category: 'Screenshots', folderHint: 'Screenshots' },

  // Messaging apps
  { pattern: /^WhatsApp (Image|Video|Audio|Document)/i, app: 'WhatsApp', category: 'Media', folderHint: 'WhatsApp' },
  { pattern: /^PTT-\d{8}-WA/i, app: 'WhatsApp', category: 'Voice notes', folderHint: 'WhatsApp' },
  { pattern: /^(photo|video)_\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}/i, app: 'Telegram', category: 'Media', folderHint: 'Telegram' },
  { pattern: /^unknown(-\d+)?\.(png|jpe?g|gif|webp)$/i, app: 'Discord', category: 'Images', folderHint: 'Discord' },
  { pattern: /^signal-\d{4}-\d{2}-\d{2}/i, app: 'Signal', category: 'Media', folderHint: 'Signal' },
  { pattern: /^received_\d{10,}/i, app: 'Facebook Messenger', category: 'Media' },

  // Recordings (OBS has no prefix; Game Bar puts the game title first)
  { pattern: /^\d{4}-\d{2}-\d{2} \d{2}-\d{2}-\d{2}\.(mkv|mp4|flv|mov)$/i, app: 'OBS recording', category: 'Videos', folderHint: 'Videos/Recordings' },
  { pattern: /^.+ \d{4}-\d{2}-\d{2} \d{2}-\d{2}-\d{2}\.mp4$/i, app: 'Xbox Game Bar clip', category: 'Videos', folderHint: 'Videos/Captures' },
  { pattern: /\.DVR\.mp4$|^.+ \d{4}\.\d{2}\.\d{2} - \d{2}\.\d{2}\.\d{2}\.\d{2}/i, app: 'NVIDIA ShadowPlay clip', category: 'Videos', folderHint: 'Videos/Captures' },
  { pattern: /^(zoom_\d+\.mp4|GMT\d{8}-\d{6}_Recording)/i, app: 'Zoom recording', category: 'Meeting recordings', folderHint: 'Videos/Meetings' },
  { pattern: /Meeting Recording|^Recording-\d|Meet Recording/i, app: 'Teams/Meet recording', category: 'Meeting recordings', folderHint: 'Videos/Meetings' },
  { pattern: /^(New Recording( \d+)?|Voice \d+)\.m4a$/i, app: 'Voice memo', category: 'Audio', folderHint: 'Audio' },

  // Cameras
  { pattern: /^IMG_\d{4,}/i, app: 'Phone camera', category: 'Photos', folderHint: 'Photos' },
  { pattern: /^PXL_\d{8}_/i, app: 'Google Pixel camera', category: 'Photos', folderHint: 'Photos' },
  { pattern: /^\d{8}_\d{6}\.(jpe?g|heic|mp4)$/i, app: 'Samsung camera', category: 'Photos', folderHint: 'Photos' },
  { pattern: /^DSC[_F]?\d{4,}/i, app: 'Digital camera', category: 'Photos', folderHint: 'Photos' },
  { pattern: /^DJI_\d{4}/i, app: 'DJI drone', category: 'Photos', folderHint: 'Photos' },
  { pattern: /^(GOPR\d{4}|GH\d{6})/i, app: 'GoPro', category: 'Videos', folderHint: 'Videos' },
  { pattern: /\.(heic|heif)$/i, app: 'iPhone photo', category: 'Photos', folderHint: 'Photos' },
  { pattern: /\.(cr2|cr3|nef|arw|dng|raf|orf|rw2)$/i, app: 'Camera RAW', category: 'Photos', folderHint: 'Photos/RAW' },

  // Game launchers and games (before generic installers)
  { pattern: /^(SteamSetup|steam_)/i, app: 'Steam', category: 'Games', folderHint: 'Games' },
  { pattern: /^(EpicInstaller|EpicGamesLauncher)/i, app: 'Epic Games', category: 'Games', folderHint: 'Games' },
  { pattern: /^setup_.+_\(\d+\)\.exe$|^GOG/i, app: 'GOG', category: 'Games', folderHint: 'Games' },
  { pattern: /^Battle\.net-Setup/i, app: 'Battle.net', category: 'Games', folderHint: 'Games' },
  { pattern: /^(EAapp|EA ?Desktop|Origin)Installer|^EAappInstaller/i, app: 'EA app', category: 'Games', folderHint: 'Games' },
  { pattern: /^(UbisoftConnect|UplayInstaller)/i, app: 'Ubisoft Connect', category: 'Games', folderHint: 'Games' },
  { pattern: /\.(mcworld|mcpack|mcaddon)$|^MinecraftInstaller/i, app: 'Minecraft', category: 'Games', folderHint: 'Games' },
  { pattern: /\.(sav|savegame)$/i, app: 'Game save', category: 'Games', folderHint: 'Games/Saves' },

  // Software
  { pattern: /(setup|install(er)?).*\.(exe|msi)$/i, app: 'Software installer', category: 'Software', folderHint: 'Software/Installers' },
  { pattern: /[-_.](x64|x86|amd64|arm64|win64|win32)[-_.].*\.(exe|msi|zip)$|[-_.](x64|x86|amd64|arm64|win64|win32)\.(exe|msi|zip)$/i, app: 'Software installer', category: 'Software', folderHint: 'Software/Installers' },
  { pattern: /\.(msi|msix|appx|appxbundle)$/i, app: 'Windows installer package', category: 'Software', folderHint: 'Software/Installers' },
  { pattern: /\.(dmg|pkg)$/i, app: 'macOS installer', category: 'Software', folderHint: 'Software/Installers' },
  { pattern: /\.(deb|rpm|appimage)$/i, app: 'Linux package', category: 'Software', folderHint: 'Software/Installers' },
  { pattern: /\.apk$/i, app: 'Android app', category: 'Software', folderHint: 'Software/Android' },
  { pattern: /\.(iso|img)$/i, app: 'Disk image', category: 'Software', folderHint: 'Software/Disk images' },
  { pattern: /\.vsix$/i, app: 'VS Code extension', category: 'Development', folderHint: 'Development' },
  { pattern: /\.whl$/i, app: 'Python wheel', category: 'Development', folderHint: 'Development' },
  { pattern: /\.jar$/i, app: 'Java archive', category: 'Development', folderHint: 'Development' },
  { pattern: /\.torrent$/i, app: 'Torrent', category: 'Downloads' },

  // Finance and admin documents
  { pattern: new RegExp(`invoice|^inv[-_ ]?\\d+`, 'i'), app: 'Invoice', category: 'Finance', folderHint: 'Finance/Invoices' },
  { pattern: /statement/i, app: 'Bank statement', category: 'Finance', folderHint: 'Finance/Bank' },
  { pattern: /receipt/i, app: 'Receipt', category: 'Finance', folderHint: 'Finance/Receipts' },
  { pattern: /payslip|pay[-_ ]?stub|salary/i, app: 'Payslip', category: 'Finance', folderHint: 'Finance/Payslips' },
  { pattern: new RegExp(`${B}(tax|p60|p45|p11d|w-?2|1099|hmrc|self[-_ ]assessment)${E}`, 'i'), app: 'Tax document', category: 'Finance', folderHint: 'Finance/Tax' },
  { pattern: new RegExp(`contract|agreement|${B}nda${E}`, 'i'), app: 'Contract', category: 'Documents', folderHint: 'Documents/Contracts' },
  { pattern: new RegExp(`${B}(cv|resume|résumé|curriculum[-_ ]vitae)${E}`, 'i'), app: 'CV / résumé', category: 'Documents', folderHint: 'Documents/Career' },
  { pattern: /passport|driving[-_ ]?licen[cs]e|birth[-_ ]?certificate/i, app: 'ID document', category: 'Documents', folderHint: 'Documents/Personal' },
  { pattern: /boarding[-_ ]?pass|e-?ticket|itinerary|booking[-_ ]?confirmation/i, app: 'Travel document', category: 'Travel', folderHint: 'Documents/Travel' },

  // Data exports and other apps
  { pattern: /^takeout-\d/i, app: 'Google Takeout', category: 'Backups', folderHint: 'Backups' },
  { pattern: /^(facebook|instagram|twitter)-[\w-]*\d/i, app: 'Social media export', category: 'Backups', folderHint: 'Backups' },
  { pattern: /\.ics$/i, app: 'Calendar invite', category: 'Documents' },
  { pattern: /\.(eml|msg)$/i, app: 'Email', category: 'Documents', folderHint: 'Documents/Email' },
  { pattern: /\.kdbx$/i, app: 'KeePass database', category: 'Security' },
  { pattern: /\.(blend|blend1)$/i, app: 'Blender', category: '3D', folderHint: 'Projects/3D' },
  { pattern: /\.(stl|3mf|gcode)$/i, app: '3D printing', category: '3D', folderHint: 'Projects/3D printing' },
  { pattern: /\.(psd|psb)$/i, app: 'Photoshop', category: 'Design', folderHint: 'Design' },
  { pattern: /\.(ai|indd)$/i, app: 'Illustrator / InDesign', category: 'Design', folderHint: 'Design' },
  { pattern: /\.(fig|sketch|xd)$/i, app: 'UI design file', category: 'Design', folderHint: 'Design' },
  { pattern: /\.(prproj|aep|drp)$/i, app: 'Video editing project', category: 'Videos', folderHint: 'Videos/Projects' },
  { pattern: /\.(als|flp|logicx|ptx)$/i, app: 'Music production project', category: 'Music', folderHint: 'Music/Projects' },
  { pattern: /\.(ttf|otf|woff2?)$/i, app: 'Font', category: 'Fonts', folderHint: 'Fonts' },
  { pattern: /\.(epub|mobi|azw3)$/i, app: 'E-book', category: 'Books', folderHint: 'Books' },
  { pattern: /\.(srt|vtt|ass)$/i, app: 'Subtitles', category: 'Videos', folderHint: 'Videos' },
];

export function matchSignature(fileName: string): Signature | null {
  return SIGNATURES.find((s) => s.pattern.test(fileName)) ?? null;
}

/** Prompt lines like `Phone camera — Photos, usually in "Photos" (12 files)`, most frequent first */
export function summarizeSignatures(fileNames: string[], max = 5): string[] {
  const counts = new Map<Signature, number>();
  for (const name of fileNames) {
    const sig = matchSignature(name);
    if (sig) counts.set(sig, (counts.get(sig) ?? 0) + 1);
  }
  // Several entries can share an app name (e.g. installers); merge them into one line
  const byLabel = new Map<string, number>();
  for (const [sig, n] of counts) {
    const hint = sig.folderHint ? `, usually in "${sig.folderHint}"` : '';
    const label = `${sig.app} — ${sig.category}${hint}`;
    byLabel.set(label, (byLabel.get(label) ?? 0) + n);
  }
  return Array.from(byLabel.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, max)
    .map(([label, n]) => `${label} (${n} file${n === 1 ? '' : 's'})`);
}
