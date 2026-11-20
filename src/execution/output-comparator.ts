export interface ComparisonResult {
  passed: boolean;
  reason: string;
}

export function normalizeOutput(text: string): string {
  return text
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .split('\n')
    .map((line) => line.replace(/[ \t]+$/, ''))
    .join('\n')
    .replace(/\n+$/, '');
}

export function compareOutput(actual: string, expected: string): ComparisonResult {
  const a = normalizeOutput(actual);
  const e = normalizeOutput(expected);
  if (a === e) return { passed: true, reason: 'Output matches expected output.' };
  return { passed: false, reason: buildMismatchReason(a, e) };
}

function buildMismatchReason(actual: string, expected: string): string {
  const actualLines = actual.split('\n');
  const expectedLines = expected.split('\n');
  const max = Math.max(actualLines.length, expectedLines.length);
  for (let i = 0; i < max; i++) {
    if (actualLines[i] !== expectedLines[i]) {
      return `Output differs at line ${i + 1}: expected ${JSON.stringify(expectedLines[i] ?? '(nothing)')}, got ${JSON.stringify(actualLines[i] ?? '(nothing)')}.`;
    }
  }
  return 'Output differs from expected output.';
}