// csv-speed: exact fast clone of csv-reader 1.0.0 semantics.
// v6: clean-line fast path (one native split(',') per clean record) plus an exact
// indexOf-based field scanner for broken records. Pure: no state across calls.

const CH_COMMA = 44, CH_QUOTE = 34, CH_CR = 13, CH_LF = 10, CH_BOM = 0xfeff;

export function run(input) {
  const text = String(input.text);
  const header = input.header === true;
  const errors = [];
  const rows = [];
  let columns = null;
  let width = -1;
  const n = text.length;

  let pos = 0;
  let line = 1;
  if (n > 0 && text.charCodeAt(0) === CH_BOM) pos = 1;

  let recordLine = 1;
  let recordRow = null;
  let commaEnded = false; // how the last field ended: true = comma (record goes on)

  while (true) {
    // Lines with no characters are no records (skip LF / CRLF runs).
    while (pos < n) {
      const c = text.charCodeAt(pos);
      if (c === CH_LF) { pos += 1; line += 1; }
      else if (c === CH_CR && pos + 1 < n && text.charCodeAt(pos + 1) === CH_LF) { pos += 2; line += 1; }
      else break;
    }
    if (pos >= n) break;

    recordLine = line;
    recordRow = header && columns === null ? null : rows.length;

    // Clean-line fast path: the whole record is this one line, with no quote and no CR.
    const nl = text.indexOf('\n', pos);
    const lineEnd = nl === -1 ? n : nl;
    const lcr = text.indexOf('\r', pos);
    const lq = text.indexOf('"', pos);
    if ((lcr === -1 || lcr >= lineEnd) && (lq === -1 || lq >= lineEnd)) {
      const fields = (lineEnd > pos ? text.slice(pos, lineEnd) : '').split(',');
      if (nl === -1) pos = n;
      else { pos = nl + 1; line += 1; }
      if (width < 0) width = fields.length;
      if (header && columns === null) {
        columns = fields;
        continue;
      }
      if (fields.length < width) {
        errors.push({ code: 'short_row', line: recordLine, row: recordRow, fields: fields.length });
        while (fields.length < width) fields.push('');
      } else if (fields.length > width) {
        errors.push({ code: 'long_row', line: recordLine, row: recordRow, extra: fields.splice(width) });
      }
      rows.push(fields);
      continue;
    }

    // Broken record: exact field scanner.
    const fields = [];
    let quoted;
    do {
      quoted = text.charCodeAt(pos) === CH_QUOTE;
      const field = quoted ? readQuoted() : readUnquoted();
      fields.push(field);
    } while (commaEnded);

    // A line that held only stray CRs is left with no characters: no record.
    if (fields.length === 1 && fields[0] === '' && !quoted) continue;

    if (width < 0) width = fields.length;
    if (header && columns === null) {
      columns = fields;
      continue;
    }
    if (fields.length < width) {
      errors.push({ code: 'short_row', line: recordLine, row: recordRow, fields: fields.length });
      while (fields.length < width) fields.push('');
    } else if (fields.length > width) {
      errors.push({ code: 'long_row', line: recordLine, row: recordRow, extra: fields.splice(width) });
    }
    rows.push(fields);
  }
  return { columns: header ? (columns === null ? [] : columns) : null, rows, errors };

  // Unquoted field: runs to a comma, line break or the end. A CR not followed by LF is
  // dropped (stray_cr). Uses indexOf to jump between candidate delimiter positions.
  function readUnquoted() {
    commaEnded = false;
    const from = pos;
    const ic = text.indexOf(',', pos);
    const il = text.indexOf('\n', pos);
    const ir = text.indexOf('\r', pos);
    if (ic === -1 && il === -1 && ir === -1) { pos = n; return text.slice(from, n); }
    let end = -1, which = -1;
    if (ic !== -1) { end = ic; which = 0; }
    if (il !== -1 && (end === -1 || il < end)) { end = il; which = 1; }
    if (ir !== -1 && (end === -1 || ir < end)) { end = ir; which = 2; }
    if (which === 0) { pos = end + 1; commaEnded = true; return text.slice(from, end); }
    if (which === 1) { pos = end + 1; line += 1; return text.slice(from, end); }
    if (end + 1 < n && text.charCodeAt(end + 1) === CH_LF) { pos = end + 2; line += 1; return text.slice(from, end); }
    // stray CR: drop it, continue reading unquoted
    errors.push({ code: 'stray_cr', line: recordLine, row: recordRow });
    pos = end + 1;
    return text.slice(from, end) + unquotedCont();
  }

  // Continuation of an unquoted field after a dropped stray CR.
  function unquotedCont() {
    const from = pos;
    while (pos < n) {
      const ic = text.indexOf(',', pos);
      const il = text.indexOf('\n', pos);
      const ir = text.indexOf('\r', pos);
      if (ic === -1 && il === -1 && ir === -1) { pos = n; return text.slice(from, n); }
      let end = -1, which = -1;
      if (ic !== -1) { end = ic; which = 0; }
      if (il !== -1 && (end === -1 || il < end)) { end = il; which = 1; }
      if (ir !== -1 && (end === -1 || ir < end)) { end = ir; which = 2; }
      if (which === 0) { pos = end + 1; commaEnded = true; return text.slice(from, end); }
      if (which === 1) { pos = end + 1; line += 1; return text.slice(from, end); }
      if (end + 1 < n && text.charCodeAt(end + 1) === CH_LF) { pos = end + 2; line += 1; return text.slice(from, end); }
      // another stray CR
      errors.push({ code: 'stray_cr', line: recordLine, row: recordRow });
      pos = end + 1;
      return text.slice(from, end) + unquotedCont();
    }
    return '';
  }

  // Quoted field whose opening quote is at pos.
  function readQuoted() {
    const open = pos;
    const openLine = line;
    pos += 1;
    commaEnded = false;
    let value = '';
    let segStart = pos;
    let closed = false;
    while (pos < n) {
      // earliest of: next quote, next CR, next LF (each from the current pos)
      const q = text.indexOf('"', pos);
      const cr = text.indexOf('\r', pos);
      const lf = text.indexOf('\n', pos);
      if (q === -1 && cr === -1 && lf === -1) break; // unterminated to end of text
      let earliest = -1, kind = 0;
      if (q !== -1) { earliest = q; kind = 0; }
      if (lf !== -1 && (earliest === -1 || lf < earliest)) { earliest = lf; kind = 1; }
      if (cr !== -1 && (earliest === -1 || cr < earliest)) { earliest = cr; kind = 2; }
      if (kind === 0) {
        // quote: doubled?
        if (earliest + 1 < n && text.charCodeAt(earliest + 1) === CH_QUOTE) {
          value += text.slice(segStart, earliest) + '"';
          pos = earliest + 2;
          segStart = pos;
          continue;
        }
        value += text.slice(segStart, earliest);
        pos = earliest + 1;
        closed = true;
        break;
      }
      if (kind === 1) {
        // LF inside quotes: value keeps it, line bumps
        line += 1;
        pos = earliest + 1;
        continue;
      }
      // CR inside quotes: CR (or CRLF) reads as one LF
      if (earliest > segStart) value += text.slice(segStart, earliest);
      value += '\n';
      line += 1;
      pos = (earliest + 1 < n && text.charCodeAt(earliest + 1) === CH_LF) ? earliest + 2 : earliest + 1;
      segStart = pos;
    }
    if (!closed) {
      // The quote never closes: it is a literal character, and the text after it is
      // read again as unquoted.
      pos = open + 1;
      line = openLine;
      errors.push({ code: 'unterminated_quote', line: recordLine, row: recordRow });
      return '"' + readUnquoted();
    }
    if (pos >= n) return value;
    const c2 = text.charCodeAt(pos);
    if (c2 === CH_COMMA) { pos += 1; commaEnded = true; return value; }
    if (c2 === CH_LF) { pos += 1; line += 1; return value; }
    if (c2 === CH_CR && pos + 1 < n && text.charCodeAt(pos + 1) === CH_LF) { pos += 2; line += 1; return value; }
    // What follows the closing quote is appended as it stands, up to the next comma or
    // line break (quote_junk, when the field ends with characters kept).
    const junk = readUnquoted();
    if (junk.length > 0) errors.push({ code: 'quote_junk', line: recordLine, row: recordRow });
    return value + junk;
  }
}
