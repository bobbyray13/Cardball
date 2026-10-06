import { describe, expect, it } from 'vitest';
import { cell, num, parseCsv, parseCsvTable, requireColumns, yearFromDate } from '../src/csv.js';

describe('parseCsv', () => {
  it('splits plain rows and ignores the trailing newline', () => {
    expect(parseCsv('a,b,c\n1,2,3\n')).toEqual([
      ['a', 'b', 'c'],
      ['1', '2', '3'],
    ]);
  });

  it('keeps commas and newlines inside quotes', () => {
    expect(parseCsv('name,note\n"Doe, John","line 1\nline 2"\n')).toEqual([
      ['name', 'note'],
      ['Doe, John', 'line 1\nline 2'],
    ]);
  });

  it('unescapes doubled quotes', () => {
    expect(parseCsv('a\n"he said ""hi"""\n')).toEqual([['a'], ['he said "hi"']]);
  });

  it('handles CRLF endings, blank lines and a leading BOM', () => {
    expect(parseCsv('\uFEFFa,b\r\n1,2\r\n\r\n3,4\r\n')).toEqual([
      ['a', 'b'],
      ['1', '2'],
      ['3', '4'],
    ]);
  });

  it('keeps a final row without a line ending', () => {
    expect(parseCsv('a,b\n1,2')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });
});

describe('parseCsvTable / requireColumns', () => {
  it('trims headers and reads columns by name', () => {
    const table = parseCsvTable(' playerID , yearID \ntroutmi01,2019\n');
    expect(table.header).toEqual(['playerID', 'yearID']);
    const columns = requireColumns(table, ['playerID', 'yearID'] as const, 'Sample.csv');
    const row = table.rows[0] ?? [];
    expect(cell(row, columns.playerID)).toBe('troutmi01');
    expect(cell(row, columns.yearID)).toBe('2019');
  });

  it('throws when a column is missing', () => {
    const table = parseCsvTable('playerID,yearID\ntroutmi01,2019\n');
    expect(() => requireColumns(table, ['playerID', 'HR'] as const, 'Batting.csv')).toThrow(
      /Batting\.csv: missing expected column "HR"/,
    );
  });
});

describe('value helpers', () => {
  it('treats blank cells as 0', () => {
    expect(num('')).toBe(0);
    expect(num(undefined)).toBe(0);
    expect(num(' 12 ')).toBe(12);
    expect(num('1.63')).toBeCloseTo(1.63);
    expect(num('n/a')).toBe(0);
  });

  it('reads the year out of a Lahman date', () => {
    expect(yearFromDate('1995-08-12')).toBe(1995);
    expect(yearFromDate('')).toBeNull();
    expect(yearFromDate(undefined)).toBeNull();
  });

  it('returns empty string for a column past the end of the row', () => {
    expect(cell(['a'], 5)).toBe('');
  });
});
