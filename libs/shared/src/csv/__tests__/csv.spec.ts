import { csvCell, csvHeaderComments, csvStream, type CsvColumn } from '../csv';

async function collect(stream: AsyncIterable<unknown>): Promise<string> {
  let out = '';
  for await (const chunk of stream) {
    out += String(chunk);
  }
  return out;
}

describe('csvCell', () => {
  it('should leave plain values untouched', () => {
    expect(csvCell('abc')).toBe('abc');
    expect(csvCell(null)).toBe('');
    expect(csvCell(undefined)).toBe('');
  });

  it('should quote and double quotes when the value has a delimiter, quote or line break', () => {
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell('a\nb')).toBe('"a\nb"');
    expect(csvCell('a;b', ';')).toBe('"a;b"');
    expect(csvCell('a;b')).toBe('a;b');
  });

  it('should prefix formula-leading strings but never numbers', () => {
    for (const lead of ['=', '+', '-', '@', '\t', '\r']) {
      expect(csvCell(`${lead}1`)).toContain(`'${lead}1`);
    }
    expect(csvCell(-5.5)).toBe('-5.5');
    expect(csvCell(12)).toBe('12');
  });
});

describe('csvHeaderComments', () => {
  it('should render # key: value lines on a single line each', () => {
    expect(
      csvHeaderComments([
        { key: 'range', value: '2026-08-29..2026-09-27' },
        { key: 'note', value: 'a\r\nb' },
      ])
    ).toEqual(['# range: 2026-08-29..2026-09-27', '# note: a b']);
  });
});

describe('csvStream', () => {
  interface Row {
    n: string;
    v: number;
  }
  const columns: CsvColumn<Row>[] = [
    { header: 'name', value: (r) => r.n },
    { header: 'value', value: (r) => r.v },
  ];

  it('should emit BOM, comments, header and CRLF-terminated rows', async () => {
    const out = await collect(
      csvStream(columns, [{ n: 'a,b', v: 1 }], { comments: ['# k: v'] })
    );
    expect(out).toBe('﻿# k: v\r\nname,value\r\n"a,b",1\r\n');
  });

  it('should honour bom=false and a custom delimiter', async () => {
    const out = await collect(csvStream(columns, [{ n: 'a', v: 2 }], { bom: false, delimiter: ';' }));
    expect(out).toBe('name;value\r\na;2\r\n');
  });

  it('should accept an async iterable of rows', async () => {
    async function* rows(): AsyncGenerator<Row> {
      yield await Promise.resolve({ n: 'x', v: 1 });
      yield { n: 'y', v: 2 };
    }
    const out = await collect(csvStream(columns, rows(), { bom: false }));
    expect(out).toBe('name,value\r\nx,1\r\ny,2\r\n');
  });
});
