export const ROSTER_COLUMNS = ['external_id', 'full_name', 'email', 'groups', 'card_uid'] as const;
export const MAX_ROSTER_ROWS = 2000;

export interface RosterRow {
  line: number;
  external_id: string;
  full_name: string;
  email: string;
  groups: string[];
  card_uid: string;
}

export interface ParsedRoster {
  rows: RosterRow[];
  ignoredColumns: string[];
}

export class RosterFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RosterFormatError';
  }
}

interface RawRecord {
  line: number;
  fields: string[];
}

function parseCsvRecords(text: string): RawRecord[] {
  let content = text;
  if (content.charCodeAt(0) === 0xfeff) {
    content = content.slice(1);
  }

  let pos = 0;
  let currentLine = 1;
  const records: RawRecord[] = [];

  while (pos < content.length) {
    const recordStartLine = currentLine;
    const fields: string[] = [];
    let inRecord = true;

    while (inRecord && pos < content.length) {
      // Skip leading horizontal spaces/tabs before quote
      let peek = pos;
      while (peek < content.length && (content[peek] === ' ' || content[peek] === '\t')) {
        peek++;
      }

      let field = '';
      if (peek < content.length && content[peek] === '"') {
        pos = peek + 1; // skip leading spaces and opening quote
        const quoteStartLine = currentLine;
        let closed = false;

        while (pos < content.length) {
          const ch = content[pos];
          if (ch === '"') {
            if (pos + 1 < content.length && content[pos + 1] === '"') {
              field += '"';
              pos += 2;
            } else {
              closed = true;
              pos++;
              break;
            }
          } else if (ch === '\r') {
            if (pos + 1 < content.length && content[pos + 1] === '\n') {
              pos++;
            }
            field += '\n';
            pos++;
            currentLine++;
          } else if (ch === '\n') {
            field += '\n';
            pos++;
            currentLine++;
          } else {
            field += ch;
            pos++;
          }
        }

        if (!closed) {
          throw new RosterFormatError(`unterminated quoted field at line ${quoteStartLine}`);
        }

        // Consume trailing horizontal whitespace after closing quote up to delimiter or newline
        while (pos < content.length && content[pos] !== ',' && content[pos] !== '\r' && content[pos] !== '\n') {
          pos++;
        }
      } else {
        // Unquoted field
        while (pos < content.length) {
          const ch = content[pos];
          if (ch === ',' || ch === '\r' || ch === '\n') {
            break;
          }
          field += ch;
          pos++;
        }
      }

      fields.push(field);

      if (pos >= content.length) {
        break;
      }

      const nextChar = content[pos];
      if (nextChar === ',') {
        pos++;
        if (pos === content.length) {
          fields.push('');
        }
      } else if (nextChar === '\r') {
        pos++;
        if (pos < content.length && content[pos] === '\n') {
          pos++;
        }
        currentLine++;
        inRecord = false;
      } else if (nextChar === '\n') {
        pos++;
        currentLine++;
        inRecord = false;
      }
    }

    records.push({ line: recordStartLine, fields });
  }

  return records;
}

export function parseRoster(text: string): ParsedRoster {
  const records = parseCsvRecords(text);
  const nonEmptyRecords = records.filter((r) => !r.fields.every((f) => f.trim() === ''));

  if (nonEmptyRecords.length === 0) {
    throw new RosterFormatError('no data rows');
  }

  const headerRecord = nonEmptyRecords[0];
  const rawHeaders = headerRecord.fields.map((f) => f.trim().toLowerCase());

  const seenHeaders = new Set<string>();
  for (const h of rawHeaders) {
    if (seenHeaders.has(h)) {
      throw new RosterFormatError(`duplicate column ${h}`);
    }
    seenHeaders.add(h);
  }

  if (!seenHeaders.has('external_id')) {
    throw new RosterFormatError('missing column external_id');
  }
  if (!seenHeaders.has('full_name')) {
    throw new RosterFormatError('missing column full_name');
  }

  const knownColumns = new Set<string>(ROSTER_COLUMNS);
  const ignoredColumns: string[] = [];
  for (const h of rawHeaders) {
    if (!knownColumns.has(h)) {
      ignoredColumns.push(h);
    }
  }

  const headerIndex = new Map<string, number>();
  rawHeaders.forEach((name, index) => {
    headerIndex.set(name, index);
  });

  const dataRecords = nonEmptyRecords.slice(1);
  if (dataRecords.length === 0) {
    throw new RosterFormatError('no data rows');
  }
  if (dataRecords.length > MAX_ROSTER_ROWS) {
    throw new RosterFormatError('more than 2000 rows');
  }

  const extIdx = headerIndex.get('external_id')!;
  const nameIdx = headerIndex.get('full_name')!;
  const emailIdx = headerIndex.get('email');
  const groupsIdx = headerIndex.get('groups');
  const cardIdx = headerIndex.get('card_uid');

  const rows: RosterRow[] = [];

  for (const record of dataRecords) {
    const external_id = record.fields[extIdx]?.trim() ?? '';
    const full_name = record.fields[nameIdx]?.trim() ?? '';
    const email = emailIdx !== undefined ? (record.fields[emailIdx]?.trim() ?? '') : '';
    const card_uid = cardIdx !== undefined ? (record.fields[cardIdx]?.trim() ?? '') : '';

    const groups: string[] = [];
    if (groupsIdx !== undefined && record.fields[groupsIdx]) {
      const rawGroups = record.fields[groupsIdx].split(';');
      const seenGroup = new Set<string>();
      for (const part of rawGroups) {
        const trimmed = part.trim();
        if (trimmed.length > 0) {
          const lower = trimmed.toLowerCase();
          if (!seenGroup.has(lower)) {
            seenGroup.add(lower);
            groups.push(trimmed);
          }
        }
      }
    }

    rows.push({
      line: record.line,
      external_id,
      full_name,
      email,
      groups,
      card_uid,
    });
  }

  return { rows, ignoredColumns };
}
