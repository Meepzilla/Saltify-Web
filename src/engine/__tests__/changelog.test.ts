import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  APP_VERSION,
  CHANGELOG_RELEASES,
  filterChangelogReleases,
  formatReleaseDate,
  getChangelogCategoryCounts,
  getCurrentRelease,
} from '../../data/changelog';

const packageJson = JSON.parse(
  readFileSync(new URL('../../../package.json', import.meta.url), 'utf8')
) as { version: string };

describe('changelog & app version integrity', () => {
  it('injects APP_VERSION directly from package.json as valid SemVer', () => {
    expect(APP_VERSION).toBe(packageJson.version);
    expect(APP_VERSION).toMatch(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/);
  });

  it('lists the current APP_VERSION as the latest changelog release with unique versions', () => {
    expect(CHANGELOG_RELEASES.length).toBeGreaterThanOrEqual(1);
    expect(CHANGELOG_RELEASES[0].version).toBe(APP_VERSION);
    expect(getCurrentRelease().version).toBe(APP_VERSION);

    const seen = new Set<string>();
    for (const release of CHANGELOG_RELEASES) {
      expect(seen.has(release.version)).toBe(false);
      seen.add(release.version);
      expect(release.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(release.title.trim().length).toBeGreaterThan(0);
      expect(release.changes.length).toBeGreaterThan(0);
    }
  });

  it('computes accurate category counts across all releases', () => {
    const counts = getChangelogCategoryCounts(CHANGELOG_RELEASES);
    const manualTotal = CHANGELOG_RELEASES.reduce(
      (sum, r) => sum + r.changes.length,
      0
    );
    expect(counts.total).toBe(manualTotal);
    expect(counts.added + counts.improved + counts.fixed).toBe(counts.total);
    expect(counts.added).toBeGreaterThan(0);
    expect(counts.improved).toBeGreaterThan(0);
    expect(counts.fixed).toBeGreaterThan(0);
  });

  it('filters releases by category and search query', () => {
    const fixedOnly = filterChangelogReleases(CHANGELOG_RELEASES, '', 'fixed');
    expect(fixedOnly.length).toBeGreaterThan(0);
    for (const rel of fixedOnly) {
      expect(rel.changes.every((c) => c.category === 'fixed')).toBe(true);
    }

    const clauseMatches = filterChangelogReleases(
      CHANGELOG_RELEASES,
      'clausal density',
      'all'
    );
    expect(clauseMatches.some((r) => r.version === '1.2.0')).toBe(true);

    const versionMatches = filterChangelogReleases(CHANGELOG_RELEASES, 'v1.1.0', 'all');
    expect(versionMatches).toHaveLength(1);
    expect(versionMatches[0].version).toBe('1.1.0');
    expect(versionMatches[0].changes.length).toBe(
      CHANGELOG_RELEASES.find((r) => r.version === '1.1.0')?.changes.length
    );

    const noMatches = filterChangelogReleases(
      CHANGELOG_RELEASES,
      'nonexistent-query-token-xyz',
      'all'
    );
    expect(noMatches).toEqual([]);
  });

  it('formats ISO calendar dates without timezone rollover', () => {
    expect(formatReleaseDate('2026-11-23')).toBe('Nov 23, 2026');
    expect(formatReleaseDate('2026-01-01')).toBe('Jan 1, 2026');
    expect(formatReleaseDate('invalid-date')).toBe('invalid-date');
  });
});
