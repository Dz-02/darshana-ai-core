/**
 * The core must stay application-agnostic, and this test is what keeps it so.
 *
 * It scans every shipped source file (tests excluded; comments stripped, since prose may
 * legitimately explain why something is absent) and fails on anything that would tie the
 * core to one application, one database or one environment: environment variables, browser
 * storage, hostnames and URLs, tenancy column names, database or table names, product names.
 * Adding such a thing to the core fails CI instead of surfacing later as one app's data in
 * another's screen.
 */
import { strict as assert } from 'node:assert';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('.', import.meta.url));

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return name === 'testing' ? [] : sourceFiles(full);
    return full.endsWith('.ts') && !full.endsWith('.test.ts') ? [full] : [];
  });
}

function stripComments(code: string): string {
  return code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

const FORBIDDEN: Array<[string, RegExp]> = [
  ['environment variables', /process\.env|import\.meta\.env/],
  ['browser storage', /\blocalStorage\b|\bsessionStorage\b/],
  ['page location / hostnames', /window\.location|\blocation\.hostname|document\.cookie/],
  ['literal URLs', /https?:\/\//],
  ['tenancy column names', /sub_institute|institute_id|org_id\b/],
  ['database or table names', /\b(vivek_erp|hp_erp|tblstudent|tbluser|hpbrain|agentic_agent|fees_)\w*/],
  ['application names', /\b(lms_k12|lms-k12|g2g|gtg|edvance|nextlms)\b/i],
  ['module ids from an application', /\b(admissions|attendance|fees|talent_management|hrit_management)\b/i],
];

describe('the core stays application-agnostic', () => {
  const files = sourceFiles(root);

  it('finds the source it is meant to police', () => {
    assert.ok(files.length >= 5, `expected shipped source files, found ${files.length}`);
  });

  for (const [label, pattern] of FORBIDDEN) {
    it(`contains no ${label}`, () => {
      const offenders = files
        .filter((file) => pattern.test(stripComments(readFileSync(file, 'utf8'))))
        .map((file) => file.slice(root.length));
      assert.deepEqual(offenders, [], `${label} found in shipped core source`);
    });
  }
});
