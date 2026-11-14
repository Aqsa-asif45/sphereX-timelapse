/** "I spotted something": candidates the user marked, kept in this browser and exportable. */

export interface Candidate {
  id: string;
  target: string;
  ra: number; dec: number;
  /** what was on screen when it was marked */
  view: string; mjd: number;
  note: string;
  link: string;
  created: string;
}

const KEY = 'spherex-timelapse.candidates';

export function loadCandidates(): Candidate[] {
  try { return JSON.parse(localStorage.getItem(KEY) || '[]'); } catch { return []; }
}
export function saveCandidates(list: Candidate[]) { localStorage.setItem(KEY, JSON.stringify(list)); }

function download(name: string, type: string, text: string) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

export function exportCsv(list: Candidate[]) {
  const q = (s: string | number) => `"${String(s).replace(/"/g, '""')}"`;
  const rows = [['target', 'ra_deg', 'dec_deg', 'seen_in', 'mjd', 'note', 'link', 'created'].join(',')]
    .concat(list.map((c) => [q(c.target), c.ra.toFixed(6), c.dec.toFixed(6), q(c.view), c.mjd.toFixed(4), q(c.note), q(c.link), q(c.created)].join(',')));
  // the byte-order mark tells Excel the file is UTF-8 (otherwise "–" and "″" show as "â€“", "â€³")
  download('spherex-candidates.csv', 'text/csv', '﻿' + rows.join('\r\n'));
}
export function exportJson(list: Candidate[]) { download('spherex-candidates.json', 'application/json', JSON.stringify(list, null, 2)); }
export { download };
