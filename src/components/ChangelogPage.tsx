import {
  Calendar,
  Check,
  Copy,
  History,
  RotateCcw,
  Search,
  Sparkles,
  Tag,
  Wrench,
  X,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import {
  APP_VERSION,
  CHANGELOG_RELEASES,
  filterChangelogReleases,
  formatReleaseDate,
  getChangelogCategoryCounts,
  getCurrentRelease,
  type ChangelogCategory,
} from '../data/changelog';

interface ChangelogPageProps {
  isStandalone: boolean;
  isOnline: boolean;
  onNotify: (title: string, description?: string) => void;
}

type CategoryFilter = 'all' | ChangelogCategory;

const CATEGORY_META: Record<
  ChangelogCategory,
  { label: string; className: string }
> = {
  added: { label: 'Added', className: 'added' },
  improved: { label: 'Improved', className: 'improved' },
  fixed: { label: 'Fixed', className: 'fixed' },
};

export function ChangelogPage({
  isStandalone,
  isOnline,
  onNotify,
}: ChangelogPageProps) {
  const [category, setCategory] = useState<CategoryFilter>('all');
  const [query, setQuery] = useState('');
  const [copiedVersion, setCopiedVersion] = useState(false);

  const currentRelease = useMemo(() => getCurrentRelease(), []);
  const counts = useMemo(() => getChangelogCategoryCounts(), []);

  const filteredReleases = useMemo(
    () => filterChangelogReleases(CHANGELOG_RELEASES, query, category),
    [query, category]
  );

  const handleCopyVersion = async () => {
    const mode = isStandalone ? 'Installed PWA' : 'Browser';
    const connectivity = isOnline ? 'Online' : 'Offline';
    const summary = `Saltify Web v${APP_VERSION} (${currentRelease.date}) · ${mode} · ${connectivity}`;
    try {
      await navigator.clipboard.writeText(summary);
      setCopiedVersion(true);
      setTimeout(() => setCopiedVersion(false), 1800);
      onNotify('Version info copied', summary);
    } catch {
      onNotify('Current Version', summary);
    }
  };

  const hasActiveFilter = category !== 'all' || query.trim().length > 0;

  return (
    <section
      id="settings-panel-changelog"
      className="settings-panel"
      aria-labelledby="changelog-heading"
    >
      <div className="settings-panel-header">
        <div>
          <h2 id="changelog-heading" className="settings-panel-title">
            Change Log &amp; Version
          </h2>
          <p className="settings-panel-subtitle">
            Complete release history for Saltify Web, bundled offline with your app.
          </p>
        </div>
      </div>

      {/* Current Version Summary Banner */}
      <div className="changelog-hero" aria-label="Current application version">
        <div className="changelog-hero-main">
          <div className="changelog-hero-top">
            <img src="./favicon.svg" alt="" className="changelog-hero-mark" />
            <div className="changelog-hero-version-block">
              <div className="changelog-hero-title-row">
                <span className="changelog-hero-app">Saltify Web</span>
                <span id="changelog-current-version" className="version-pill current">
                  v{APP_VERSION}
                </span>
                <span className="version-status-label">Current Version</span>
              </div>
              <div className="changelog-hero-meta">
                <span className="changelog-meta-item">
                  <Calendar size={13} />
                  <span>Released {formatReleaseDate(currentRelease.date)}</span>
                </span>
                <span className="changelog-meta-item">
                  <History size={13} />
                  <span>
                    {CHANGELOG_RELEASES.length} releases ({counts.total} logged updates)
                  </span>
                </span>
              </div>
            </div>
          </div>
          <p className="changelog-hero-summary">
            <strong>{currentRelease.title}:</strong> {currentRelease.summary}
          </p>
        </div>

        <div className="changelog-hero-actions">
          <button
            id="copy-version-info-btn"
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={() => void handleCopyVersion()}
          >
            {copiedVersion ? <Check size={14} /> : <Copy size={14} />}
            <span>{copiedVersion ? 'Copied' : 'Copy Version Info'}</span>
          </button>
        </div>
      </div>

      {/* Category Filter Pills & Search */}
      <div className="changelog-toolbar" role="search" aria-label="Filter change log">
        <div
          className="changelog-filter-pills"
          role="group"
          aria-label="Filter by change category"
        >
          <button
            id="changelog-filter-all"
            type="button"
            className={`changelog-filter-btn ${category === 'all' ? 'active' : ''}`}
            aria-pressed={category === 'all'}
            onClick={() => setCategory('all')}
          >
            <Tag size={13} />
            <span>All</span>
            <span className="changelog-filter-count">{counts.total}</span>
          </button>
          <button
            id="changelog-filter-added"
            type="button"
            className={`changelog-filter-btn ${category === 'added' ? 'active' : ''}`}
            aria-pressed={category === 'added'}
            onClick={() => setCategory('added')}
          >
            <Sparkles size={13} />
            <span>Added</span>
            <span className="changelog-filter-count">{counts.added}</span>
          </button>
          <button
            id="changelog-filter-improved"
            type="button"
            className={`changelog-filter-btn ${category === 'improved' ? 'active' : ''}`}
            aria-pressed={category === 'improved'}
            onClick={() => setCategory('improved')}
          >
            <History size={13} />
            <span>Improved</span>
            <span className="changelog-filter-count">{counts.improved}</span>
          </button>
          <button
            id="changelog-filter-fixed"
            type="button"
            className={`changelog-filter-btn ${category === 'fixed' ? 'active' : ''}`}
            aria-pressed={category === 'fixed'}
            onClick={() => setCategory('fixed')}
          >
            <Wrench size={13} />
            <span>Fixed</span>
            <span className="changelog-filter-count">{counts.fixed}</span>
          </button>
        </div>

        <div className="changelog-search-wrap">
          <Search size={15} className="changelog-search-icon" aria-hidden="true" />
          <input
            id="changelog-search-input"
            type="search"
            className="field-input changelog-search-input"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search release notes..."
            aria-label="Search change log entries"
          />
          {query && (
            <button
              type="button"
              className="changelog-search-clear"
              aria-label="Clear change log search"
              onClick={() => setQuery('')}
            >
              <X size={14} />
            </button>
          )}
        </div>
      </div>

      {/* Release Timeline */}
      {filteredReleases.length === 0 ? (
        <div className="settings-card changelog-empty">
          <History size={24} className="changelog-empty-icon" />
          <h3>No matching release notes</h3>
          <p>
            No updates matched your current filter. Try clearing the search term or
            switching back to all categories.
          </p>
          {hasActiveFilter && (
            <button
              id="changelog-reset-filters-btn"
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => {
                setCategory('all');
                setQuery('');
              }}
            >
              <RotateCcw size={14} />
              <span>Reset Filters</span>
            </button>
          )}
        </div>
      ) : (
        <div className="changelog-timeline">
          {filteredReleases.map((release) => {
            const isCurrent = release.version === APP_VERSION;
            return (
              <article
                key={release.version}
                className={`settings-card changelog-release ${
                  isCurrent ? 'is-current' : ''
                }`}
                aria-labelledby={`release-v-${release.version}`}
              >
                <div className="changelog-release-header">
                  <div className="changelog-release-title-group">
                    <span className={`version-pill ${isCurrent ? 'current' : ''}`}>
                      v{release.version}
                    </span>
                    {isCurrent && (
                      <span className="changelog-current-tag">Installed</span>
                    )}
                    <h3
                      id={`release-v-${release.version}`}
                      className="changelog-release-title"
                    >
                      {release.title}
                    </h3>
                  </div>
                  <time className="changelog-release-date" dateTime={release.date}>
                    {formatReleaseDate(release.date)}
                  </time>
                </div>

                <p className="changelog-release-summary">{release.summary}</p>

                <ul className="changelog-item-list">
                  {release.changes.map((item, idx) => {
                    const meta = CATEGORY_META[item.category];
                    return (
                      <li
                        key={`${release.version}-${idx}`}
                        className="changelog-item-row"
                      >
                        <span className={`changelog-badge ${meta.className}`}>
                          {meta.label}
                        </span>
                        <div className="changelog-item-copy">
                          <span className="changelog-item-summary">{item.summary}</span>
                          {item.detail && (
                            <span className="changelog-item-detail">{item.detail}</span>
                          )}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
