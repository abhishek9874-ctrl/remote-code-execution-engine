import { describe, it, expect } from 'vitest';
import { compareOutput, normalizeOutput } from './output-comparator.js';

describe('normalizeOutput', () => {
  it('converts \\r\\n to \\n', () => {
    expect(normalizeOutput('a\r\nb')).toBe('a\nb');
  });
  it('strips trailing whitespace per line', () => {
    expect(normalizeOutput('hello   \nworld\t\n')).toBe('hello\nworld');
  });
  it('keeps leading whitespace', () => {
    expect(normalizeOutput('  indented')).toBe('  indented');
  });
  it('collapses trailing blank lines but keeps middle ones', () => {
    expect(normalizeOutput('a\n\nb\n\n\n')).toBe('a\n\nb');
  });
});

describe('compareOutput', () => {
  it('passes on exact match', () => {
    expect(compareOutput('hello', 'hello').passed).toBe(true);
  });
  it('passes when actual has a trailing newline', () => {
    expect(compareOutput('42\n', '42').passed).toBe(true);
  });
  it('passes despite CRLF differences', () => {
    expect(compareOutput('a\r\nb\r\n', 'a\nb').passed).toBe(true);
  });
  it('fails on different content', () => {
    expect(compareOutput('hello', 'bye').passed).toBe(false);
  });
  it('fails when a middle blank line is missing', () => {
    expect(compareOutput('a\nb', 'a\n\nb').passed).toBe(false);
  });
  it('fails on leading-indentation difference', () => {
    expect(compareOutput('  x', 'x').passed).toBe(false);
  });
  it('fails on case difference', () => {
    expect(compareOutput('Hello', 'hello').passed).toBe(false);
  });
  it('reason points at the first differing line', () => {
    const r = compareOutput('a\nb\nX', 'a\nb\nc');
    expect(r.reason).toContain('line 3');
  });
  it('treats two empty outputs as a pass', () => {
    expect(compareOutput('', '').passed).toBe(true);
  });
});