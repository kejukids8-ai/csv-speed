// csv-speed: exact fast clone of csv-reader 1.0.0 semantics.
// Single-pass scanner, charCodeAt only, no regex in the hot path. Pure: no state across calls.

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

  const pieces = [];

  while (true) {
    // Lines with no characters are no records.
    while (pos < n) {
      const c = text.charCodeAt(pos);
      if (c === CH_LF) { pos += 1; line += 1; }
      else if (c === CH_CR && pos + 1 < n && text.charCodeAt(pos + 1) === CH_LF) { pos += 2; line += 1; }
      else break;
    }
    if (pos >= n) break;

    recordLine = line;
    recordRow = header && columns === null ? null : rows.length;
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
  // dropped (stray_cr). Fast path: one contiguous slice when nothing was dropped.
  function readUnquoted() {
    pieces.length = 0;
    const segStart = pos;
    commaEnded = false;
    let endIdx = n; // index of the field's last character + 1 (delimiter excluded)
    while (pos < n) {
      const c = text.charCodeAt(pos);
      if (c === CH_COMMA) { endIdx = pos; pos += 1; commaEnded = true; break; }
      if (c === CH_LF) { endIdx = pos; pos += 1; line += 1; break; }
      if (c === CH_CR) {
        if (pos + 1 < n && text.charCodeAt(pos + 1) === CH_LF) { endIdx = pos; pos += 2; line += 1; break; }
        errors.push({ code: 'stray_cr', line: recordLine, row: recordRow });
        pieces.push(text.slice(segStart, pos));
        pos += 1;
        return unquotedSlow(pos);
      }
      pos += 1;
    }
    return text.slice(segStart, endIdx);
  }

  // Continuation of an unquoted field after a dropped stray CR.
  function unquotedSlow(from) {
    let endIdx = n;
    while (pos < n) {
      const c = text.charCodeAt(pos);
      if (c === CH_COMMA) { endIdx = pos; pos += 1; commaEnded = true; break; }
      if (c === CH_LF) { endIdx = pos; pos += 1; line += 1; break; }
      if (c === CH_CR) {
        if (pos + 1 < n && text.charCodeAt(pos + 1) === CH_LF) { endIdx = pos; pos += 2; line += 1; break; }
        errors.push({ code: 'stray_cr', line: recordLine, row: recordRow });
        if (pos > from) pieces.push(text.slice(from, pos));
        pos += 1;
        from = pos;
        continue;
      }
      pos += 1;
    }
    if (pos > from) pieces.push(text.slice(from, endIdx));
    return pieces.join('');
  }

  // Quoted field whose opening quote is at pos.
  function readQuoted() {
    const open = pos;
    const openLine = line;
    pos += 1;
    pieces.length = 0;
    let segStart = pos;
    commaEnded = false;
    let closed = false;
    while (pos < n) {
      const c = text.charCodeAt(pos);
      if (c === CH_QUOTE) {
        if (pos + 1 < n && text.charCodeAt(pos + 1) === CH_QUOTE) {
          pieces.push(text.slice(segStart, pos), '"');
          pos += 2;
          segStart = pos;
          continue;
        }
        closed = true;
        break;
      }
      if (c === CH_CR) {
        // CRLF and a lone CR inside quotes are each one LF.
        if (pos > segStart) pieces.push(text.slice(segStart, pos));
        pieces.push('\n');
        line += 1;
        pos += (pos + 1 < n && text.charCodeAt(pos + 1) === CH_LF) ? 2 : 1;
        segStart = pos;
        continue;
      }
      if (c === CH_LF) line += 1;
      pos += 1;
    }
    if (!closed) {
      // The quote never closes: it is a literal character, and the text after it is
      // read again as unquoted.
      pos = open + 1;
      line = openLine;
      errors.push({ code: 'unterminated_quote', line: recordLine, row: recordRow });
      return '"' + readUnquoted();
    }
    let value;
    if (pos > segStart) {
      pieces.push(text.slice(segStart, pos)); // up to (not including) the closing quote
      value = pieces.length === 1 ? pieces[0] : pieces.join('');
    } else {
      value = pieces.length === 0 ? '' : pieces.join('');
    }
    pos += 1; // step past the closing quote
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
