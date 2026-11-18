import { parseRoster, RosterFormatError } from '../../src/identity/roster-csv';

describe('parseRoster', () => {
  it('strips UTF-8 BOM and parses columns correctly', () => {
    const csv = '\uFEFFexternal_id,full_name,email\nSV001,Nguyen Van A,a@example.com';
    const parsed = parseRoster(csv);
    expect(parsed.ignoredColumns).toEqual([]);
    expect(parsed.rows).toHaveLength(1);
    expect(parsed.rows[0]).toEqual({
      line: 2,
      external_id: 'SV001',
      full_name: 'Nguyen Van A',
      email: 'a@example.com',
      groups: [],
      card_uid: '',
    });
  });

  it('handles CRLF line endings', () => {
    const csv = 'external_id,full_name\r\nSV001,User One\r\nSV002,User Two\r\n';
    const parsed = parseRoster(csv);
    expect(parsed.rows).toHaveLength(2);
    expect(parsed.rows[0].external_id).toBe('SV001');
    expect(parsed.rows[0].line).toBe(2);
    expect(parsed.rows[1].external_id).toBe('SV002');
    expect(parsed.rows[1].line).toBe(3);
  });

  it('handles quoted commas, newlines, and escaped quotes', () => {
    const csv = [
      'external_id,full_name,email',
      'SV001,"Doe, Jane",jane@example.com',
      'SV002,"Line 1\nLine 2",line@example.com',
      'SV003,"He said ""Hello""",hello@example.com',
    ].join('\n');
    const parsed = parseRoster(csv);
    expect(parsed.rows).toHaveLength(3);
    expect(parsed.rows[0].full_name).toBe('Doe, Jane');
    expect(parsed.rows[1].full_name).toBe('Line 1\nLine 2');
    expect(parsed.rows[2].full_name).toBe('He said "Hello"');
  });

  it('accepts headers in any case and column order', () => {
    const csv = 'CARD_UID,Groups,FULL_NAME,EXTERNAL_ID,Email\n04A1B2C3,K65;IT,Alice,SV001,alice@example.com';
    const parsed = parseRoster(csv);
    expect(parsed.rows).toHaveLength(1);
    expect(parsed.rows[0]).toEqual({
      line: 2,
      external_id: 'SV001',
      full_name: 'Alice',
      email: 'alice@example.com',
      groups: ['K65', 'IT'],
      card_uid: '04A1B2C3',
    });
  });

  it('throws on missing required columns', () => {
    expect(() => parseRoster('full_name,email\nAlice,a@b.com')).toThrow(RosterFormatError);
    expect(() => parseRoster('full_name,email\nAlice,a@b.com')).toThrow('missing column external_id');

    expect(() => parseRoster('external_id,email\nSV001,a@b.com')).toThrow(RosterFormatError);
    expect(() => parseRoster('external_id,email\nSV001,a@b.com')).toThrow('missing column full_name');
  });

  it('collects unknown header columns into ignoredColumns', () => {
    const csv = 'external_id,department,full_name,phone\nSV001,CS,Bob,123456';
    const parsed = parseRoster(csv);
    expect(parsed.ignoredColumns).toEqual(['department', 'phone']);
    expect(parsed.rows).toHaveLength(1);
    expect(parsed.rows[0].external_id).toBe('SV001');
    expect(parsed.rows[0].full_name).toBe('Bob');
  });

  it('throws on duplicated header column names', () => {
    expect(() => parseRoster('external_id,full_name,EXTERNAL_ID\nSV001,Alice,SV001')).toThrow(RosterFormatError);
    expect(() => parseRoster('external_id,full_name,EXTERNAL_ID\nSV001,Alice,SV001')).toThrow('duplicate column external_id');
  });

  it('skips blank lines and preserves correct 1-based physical line numbers', () => {
    const csv = [
      '',
      '   ',
      'external_id,full_name',
      '',
      'SV001,Alice',
      '   ,   ',
      '',
      'SV002,Bob',
      '',
    ].join('\n');
    const parsed = parseRoster(csv);
    expect(parsed.rows).toHaveLength(2);
    expect(parsed.rows[0]).toEqual({
      line: 5,
      external_id: 'SV001',
      full_name: 'Alice',
      email: '',
      groups: [],
      card_uid: '',
    });
    expect(parsed.rows[1]).toEqual({
      line: 8,
      external_id: 'SV002',
      full_name: 'Bob',
      email: '',
      groups: [],
      card_uid: '',
    });
  });

  it('splits groups by semicolon, trims parts, drops empty and case-insensitive duplicates', () => {
    const csv = 'external_id,full_name,groups\nSV001,Alice," CNTT-K65 ; cntt-k65 ; ; ATTT ; attt ; CNTT-K65 "';
    const parsed = parseRoster(csv);
    expect(parsed.rows).toHaveLength(1);
    expect(parsed.rows[0].groups).toEqual(['CNTT-K65', 'ATTT']);
  });

  it('throws RosterFormatError on unterminated quoted field with the starting line number', () => {
    const csv = 'external_id,full_name\nSV001,"unterminated field\nSV002,Bob';
    expect(() => parseRoster(csv)).toThrow(RosterFormatError);
    expect(() => parseRoster(csv)).toThrow('unterminated quoted field at line 2');
  });

  it('throws when there are no data rows or file exceeds MAX_ROSTER_ROWS', () => {
    expect(() => parseRoster('')).toThrow('no data rows');
    expect(() => parseRoster('   \n\n  ')).toThrow('no data rows');
    expect(() => parseRoster('external_id,full_name\n')).toThrow('no data rows');

    const lines = ['external_id,full_name'];
    for (let i = 1; i <= 2001; i++) {
      lines.push(`SV${i},User ${i}`);
    }
    expect(() => parseRoster(lines.join('\n'))).toThrow('more than 2000 rows');

    // 2000 rows should succeed
    const validLines = ['external_id,full_name'];
    for (let i = 1; i <= 2000; i++) {
      validLines.push(`SV${i},User ${i}`);
    }
    const parsed = parseRoster(validLines.join('\n'));
    expect(parsed.rows).toHaveLength(2000);
  });
});
