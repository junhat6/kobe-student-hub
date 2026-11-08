import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  liveSessionSql,
  liveRestrictedSessionSql,
  type SessionStorageProof,
} from '../worker/auth/session-guard';
import {
  liveStudentSessionSql,
  liveStudentRestrictedSessionSql,
  liveStudentSessionBindings,
} from '../worker/auth/student-participation';

// Independent action matrix: a stronger student guard would incorrectly block cleanup,
// and a base-only guard would incorrectly permit new participation. Order is deliberate.
type Guard = 'base' | 'student' | 'profile-choice' | 'base-snapshot' | 'base-final-snapshot';
type Inventory = {
  className: string;
  private: Record<string, Guard[]>;
  public?: Record<string, number>;
};
const inventory: Record<string, Inventory> = {
  drafts: {
    className: 'PrivateDraftStore',
    private: {
      create: ['student'],
      read: ['base'],
      list: ['base'],
      update: ['student'],
      delete: ['base'],
    },
  },
  'public-profile': {
    className: 'PublicProfileStore',
    private: { current: ['profile-choice'], create: ['student', 'student', 'student'] },
  },
  publication: {
    className: 'ArticlePublicationStore',
    private: { publish: ['student', 'student'], getOwnReceipt: ['base'] },
    public: { readPublished: 1, readPublishedSelection: 1, boundedPublications: 2 },
  },
  projects: {
    className: 'ProjectStore',
    private: {
      createDraft: ['student'],
      getDraft: ['base'],
      listDrafts: ['base'],
      saveDraft: ['student'],
      publish: ['student', 'student'],
      receiptRow: ['student'],
      getOwnReceipt: ['base'],
    },
    public: { readPublished: 1, readAuthor: 2, readRecentPublished: 2 },
  },
  'own-publications': { className: 'OwnPublicationStore', private: { list: ['base'] } },
  'publication-stops': {
    className: 'PublicationStopStore',
    private: { state: ['base'], stop: ['base'] },
  },
  likes: {
    className: 'ArticleLikeStore',
    private: { getOwn: ['base'], setOwn: ['base', 'base', 'student'] },
    public: { readPublic: 3 },
  },
  moderation: {
    className: 'ArticleModerationStore',
    private: { report: ['student'], getOwnReport: ['base'], queue: ['base'], readCase: ['base'] },
  },
  'project-reports': {
    className: 'ProjectReportStore',
    private: {
      report: ['student'],
      getOwnReceipt: ['base', 'base'],
      queue: ['base'],
      readCase: ['base'],
    },
  },
  'auth/enrollment': {
    className: 'EnrollmentStore',
    private: {
      getOwn: ['base-snapshot'],
      save: ['base-snapshot', 'base-snapshot', 'base-final-snapshot'],
    },
  },
};
const source = (name: string) => readFileSync(resolve('worker', `${name}.ts`), 'utf8');
const compact = (text: string) => text.replace(/\s+/g, '');
function methodAt(text: string, offset: number) {
  return (
    [...text.slice(0, offset).matchAll(/\basync\s+(\w+)\s*\(/g)].at(-1)?.[1] ?? '<outside method>'
  );
}
function methodSource(text: string, name: string) {
  const methods = [...text.matchAll(/\basync\s+(\w+)\s*\(/g)],
    index = methods.findIndex((method) => method[1] === name);
  expect(index, `missing method ${name}`).toBeGreaterThanOrEqual(0);
  return text.slice(methods[index].index, methods[index + 1]?.index ?? text.length);
}
function balancedEnd(text: string, start: number, open: string, close: string) {
  let depth = 1,
    quote = '';
  for (let i = start + 1; i < text.length; i++) {
    const c = text[i];
    if (quote) {
      if (c === '\\') i++;
      else if (c === quote) quote = '';
      continue;
    }
    if (c === "'" || c === '"' || c === '`') {
      quote = c;
      continue;
    }
    if (c === '/' && text[i + 1] === '/') {
      i = text.indexOf('\n', i);
      if (i < 0) break;
      continue;
    }
    if (c === '/' && text[i + 1] === '*') {
      i = text.indexOf('*/', i + 2);
      if (i < 0) break;
      i++;
      continue;
    }
    if (c === open) depth++;
    if (c === close && --depth === 0) return i;
  }
  throw new Error('unclosed auditable source range');
}
function bindingArgs(text: string, offset: number) {
  const match = text.slice(offset).match(/^\s*\.bind\(/);
  if (!match) return null;
  const open = offset + match[0].lastIndexOf('(');
  return text.slice(open + 1, balancedEnd(text, open, '(', ')'));
}
function statements(text: string) {
  const found = [
    ...text.matchAll(
      /\.prepare\(\s*(`(?:\\.|[^`])*`|'(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*")\s*,?\s*\)/g,
    ),
  ];
  expect(found.length, 'every prepare must remain literal and auditable').toBe(
    [...text.matchAll(/\.prepare\s*\(/g)].length,
  );
  return found.map((match) => ({
    method: methodAt(text, match.index!),
    sql: match[1],
    bindings: bindingArgs(text, match.index! + match[0].length),
    offset: match.index!,
  }));
}
function importedAlias(text: string, exported: string, module: string) {
  const declaration = [...text.matchAll(/import\s*\{([^}]+)\}\s*from\s*['"]([^'"]+)['"]/g)].find(
    (match) => match[2] === module,
  );
  expect(declaration, `repository must import ${module}`).toBeTruthy();
  const item = declaration?.[1]
    .split(',')
    .map((value) => value.trim())
    .find((value) => new RegExp(`^${exported}(?:\\s|$)`).test(value));
  expect(item, `missing ${exported} import`).toBeTruthy();
  return item?.split(/\s+as\s+/)[1] ?? exported;
}
function guardAliases(file: string, text: string) {
  const prefix = file.startsWith('auth/') ? './' : './auth/';
  const base = importedAlias(
    text,
    file === 'drafts' ? 'liveRestrictedSessionSql' : 'liveSessionSql',
    prefix + 'session-guard',
  );
  const baseBindings = importedAlias(text, 'liveSessionBindings', prefix + 'session-guard');
  const studentNeeded = Object.values(inventory[file].private)
    .flat()
    .some((guard) => guard === 'student' || guard === 'profile-choice');
  return {
    base,
    baseBindings,
    student: studentNeeded
      ? importedAlias(
          text,
          file === 'drafts' ? 'liveStudentRestrictedSessionSql' : 'liveStudentSessionSql',
          prefix + 'student-participation',
        )
      : null,
    studentBindings: studentNeeded
      ? importedAlias(text, 'liveStudentSessionBindings', prefix + 'student-participation')
      : null,
  };
}
const interpolate = (alias: string, restricted = false) =>
  '${' + alias + (restricted ? '(p)' : '') + '}';

describe('independent private SQL guard inventory', () => {
  for (const [file, expected] of Object.entries(inventory))
    it(`${file}: exact SQL ownership and base/student action classification`, () => {
      const text = source(file),
        aliases = guardAliases(file, text),
        actual: Record<string, number> = {};
      const classes = [...text.matchAll(/\bclass\s+(\w+)\s*\{/g)];
      expect(classes.map((match) => match[1])).toEqual([expected.className]);
      const classStart = text.indexOf('{', classes[0].index!),
        classEnd = balancedEnd(text, classStart, '{', '}');
      for (const statement of statements(text)) {
        const index = actual[statement.method] ?? 0;
        actual[statement.method] = index + 1;
        const label = `${file}.${statement.method}[${index}]`;
        expect(
          statement.offset,
          `${label}: SQL must remain in its owning repository`,
        ).toBeGreaterThan(classStart);
        expect(statement.offset).toBeLessThan(classEnd);
        if (Object.hasOwn(expected.public ?? {}, statement.method)) continue;
        expect(
          Object.hasOwn(expected.private, statement.method),
          `unclassified SQL: ${label}`,
        ).toBe(true);
        const guard = expected.private[statement.method]?.[index];
        expect(guard, `unclassified extra SQL: ${label}`).toBeTruthy();
        expect(statement.bindings, `${label}: private SQL must bind its proof`).not.toBeNull();
        const student = guard === 'student',
          dynamic = guard === 'profile-choice';
        const sqlAlias = dynamic ? 'sql' : student ? aliases.student! : aliases.base;
        expect(statement.sql, `${label}: required ${guard} predicate`).toContain(
          interpolate(sqlAlias, file === 'drafts'),
        );
        if (!dynamic && aliases.student)
          expect(statement.sql, `${label}: guard kind must not drift`).not.toContain(
            interpolate(student ? aliases.base : aliases.student, file === 'drafts'),
          );
        const bindingAlias =
          guard === 'base-snapshot'
            ? 'bindings'
            : guard === 'base-final-snapshot'
              ? 'finalBindings'
              : dynamic
                ? 'values'
                : student
                  ? aliases.studentBindings!
                  : aliases.baseBindings;
        const cached = guard === 'base-snapshot' || guard === 'base-final-snapshot' || dynamic;
        expect(statement.bindings, `${label}: matching proof bindings`).toMatch(
          new RegExp(`\\.\\.\\.${bindingAlias}\\s*${cached ? '(?:,|$)' : '\\('}`),
        );
        expect(statement.sql, `${label}: no copied session guard`).not.toMatch(
          /\b(?:FROM|JOIN)\s+auth_sessions\b/i,
        );
      }
      expect(actual).toEqual({
        ...Object.fromEntries(
          Object.entries(expected.private).map(([method, guards]) => [method, guards.length]),
        ),
        ...expected.public,
      });
      expect(text, 'repository must not duplicate idle timeout arithmetic').not.toContain(
        'SESSION_IDLE_MS',
      );
    });
  it('profile helper defaults to base reads and selects student predicate/bindings for every create/retry', () => {
    const text = source('public-profile'),
      a = guardAliases('public-profile', text),
      current = compact(methodSource(text, 'current'));
    expect(current).toContain('asynccurrent(p:Proof,writer=false)');
    expect(current).toContain(
      `constsql=writer?${a.student}:${a.base},values=writer?${a.studentBindings}(p):${a.baseBindings}(p);`,
    );
    const statement = statements(text).filter((s) => s.method === 'current');
    expect(statement).toHaveLength(1);
    expect(compact(statement[0].bindings ?? '').replace(/,$/, '')).toBe('...values,p.accountId');
    const calls = [...text.matchAll(/this\.current\(([^)]*)\)/g)].map((match) => ({
      method: methodAt(text, match.index!),
      arguments: compact(match[1]),
    }));
    expect(calls).toEqual([
      { method: 'getOwn', arguments: 'p' },
      { method: 'create', arguments: 'proof,true' },
      { method: 'create', arguments: 'retry,true' },
      { method: 'create', arguments: 'final,true' },
    ]);
  });
  it('like removal alone owns the two base statements; addition owns the student INSERT', () => {
    const text = source('likes'),
      branch = [...text.matchAll(/if\s*\(\s*!liked\s*\)\s*\{/g)];
    expect(branch).toHaveLength(1);
    expect(methodAt(text, branch[0].index!)).toBe('setOwn');
    const start = text.indexOf('{', branch[0].index!),
      end = balancedEnd(text, start, '{', '}');
    const sql = statements(text).filter((statement) => statement.method === 'setOwn');
    expect(sql).toHaveLength(3);
    expect(sql.map((statement) => statement.offset >= start && statement.offset < end)).toEqual([
      true,
      true,
      false,
    ]);
    expect(sql[0].sql).toMatch(/^`DELETE FROM article_likes\b/);
    expect(sql[1].sql).toMatch(/^`SELECT CASE WHEN/);
    expect(sql[2].sql).toMatch(/^`INSERT INTO article_likes\b/);
    expect(compact(text.slice(start, end))).toContain('return{liked:false}');
  });
  it('enrollment read/correction snapshots derive from the base proof in each owning method', () => {
    const text = source('auth/enrollment');
    for (const name of ['getOwn', 'save'])
      expect(compact(methodSource(text, name))).toContain(
        'constbindings=liveSessionBindings(proof),now=bindings[3]asnumber',
      );
    expect(compact(methodSource(text, 'save'))).toContain(
      'constfinalBindings=liveSessionBindings(proof),finalNow=finalBindings[3]asnumber',
    );
    expect(
      statements(text).map((statement) => compact(statement.bindings ?? '').replace(/,$/, '')),
    ).toEqual([
      '...bindings,proof.accountId',
      'proof.accountId,...saved,proof.accountId,...bindings',
      '...saved,proof.accountId,value.expectedVersion,now,...bindings',
      'proof.accountId,...saved,...finalBindings',
    ]);
  });
  it('student helper composes the exact central authority and private current-period predicates', () => {
    const period =
      'EXISTS(SELECT 1 FROM private_enrollment_periods e WHERE e.owner_account_id=? AND e.policy_version=1 AND e.starts_at_ms<=? AND e.ends_at_ms>? AND e.updated_at_ms<=?)';
    expect(liveStudentSessionSql).toBe(`(${liveSessionSql} AND ${period})`);
    const proof: SessionStorageProof = {
      tokenHash: 'token',
      accountId: 'owner',
      contextHash: 'context',
      nowMs: 1800000000000,
      clock: () => 1800000000001,
    };
    expect(liveStudentRestrictedSessionSql(proof)).toBe(
      `(${liveRestrictedSessionSql(proof)} AND ${period})`,
    );
    const restricted = {
      ...proof,
      restriction: () => ({ accountId: 'owner', accountEpoch: 2, expiresAtMs: 1800000001000 }),
    };
    expect(liveStudentRestrictedSessionSql(restricted)).toBe(
      `(${liveRestrictedSessionSql(restricted)} AND ${period})`,
    );
  });
  it('student proof samples one fresh time for session, period and future-record bounds', () => {
    const prior = 1800000000000,
      fresh = prior + 1;
    let samples = 0;
    const proof: SessionStorageProof = {
      tokenHash: 'token',
      accountId: 'owner',
      contextHash: 'context',
      nowMs: prior,
      clock: () => fresh + samples++,
    };
    expect(liveStudentSessionBindings(proof)).toEqual([
      'token',
      'owner',
      'context',
      fresh,
      fresh,
      fresh,
      fresh,
      fresh - 1800000,
      fresh,
      'owner',
      fresh,
      fresh,
      fresh,
    ]);
    expect(samples).toBe(1);
    samples = 0;
    const expires = fresh + 1000;
    expect(
      liveStudentSessionBindings({
        ...proof,
        restriction: () => ({ accountId: 'owner', accountEpoch: 2, expiresAtMs: expires }),
      }),
    ).toEqual([
      'token',
      'owner',
      'context',
      fresh,
      fresh,
      fresh,
      fresh,
      fresh - 1800000,
      fresh,
      'owner',
      2,
      expires,
      fresh,
      expires,
      'owner',
      fresh,
      fresh,
      fresh,
    ]);
    expect(samples).toBe(1);
    expect(() => liveStudentSessionBindings({ ...proof, clock: () => prior - 1 })).toThrow(
      'unavailable session clock',
    );
  });
  it('new authenticated repositories cannot silently evade the participant inventory or its explicit privileged exclusion', () => {
    const found = readdirSync('worker', { recursive: true })
      .filter((file): file is string => typeof file === 'string' && file.endsWith('.ts'))
      .filter((file) => {
        const text = readFileSync(resolve('worker', file), 'utf8');
        return /new SessionStore\s*\(/.test(text) && /\.prepare\s*\(/.test(text);
      })
      .map((file) => file.slice(0, -3))
      .sort();
    // Existing operator admission/retention has its own privileged audit. It is not a
    // student action. Pin the sole exclusion so new auth repositories fail this test.
    expect(found).toEqual([...Object.keys(inventory), 'auth/admission'].sort());
    const privileged = statements(source('auth/admission')).reduce<Record<string, number>>(
      (counts, statement) => {
        counts[statement.method] = (counts[statement.method] ?? 0) + 1;
        return counts;
      },
      {},
    );
    expect(privileged).toEqual({ decide: 1, purge: 5 });
  });
  it('inventory is exactly 40 private SQL sites (24 base, 15 student, one explicit choice) and 12 public sites', () => {
    const guards = Object.values(inventory).flatMap((item) => Object.values(item.private).flat());
    expect(guards).toHaveLength(40);
    expect(guards.filter((guard) => guard.startsWith('base'))).toHaveLength(24);
    expect(guards.filter((guard) => guard === 'student')).toHaveLength(15);
    expect(guards.filter((guard) => guard === 'profile-choice')).toHaveLength(1);
    expect(
      Object.values(inventory)
        .flatMap((item) => Object.values(item.public ?? {}))
        .reduce((a, b) => a + b, 0),
    ).toBe(12);
  });
});
