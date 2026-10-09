// Escape text before it goes into innerHTML. Anything that did not come from
// this codebase (SkyBoT replies, FITS headers, archive file names, link
// parameters) passes through here so it can only ever show up as text.
const ENT = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

export const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ENT[c]);
