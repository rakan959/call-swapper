import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { JSX } from 'react';
import dayjs from '@utils/dayjs';
import { Dataset, Resident, Shift, ShiftType, SwapCandidate } from '@domain/types';
import { SwapSettings } from '@domain/swapSettings';
import { findSwapsForShift, SwapRejectionDetail, SwapSearchResult } from '@engine/swapEngine';
import { findRotationForDate } from '@utils/rotations';
import { formatScore } from '@utils/score';
import {
  createSwapComparator,
  defaultSortDirection,
  SWAP_SORT_LABELS,
  SwapSortKey,
} from '@domain/swapSort';
import { filterCandidatesBySettings } from '@utils/swapFilters';
import { getCounterpartScore, getMyScore, getTotalScore } from '@utils/swapMetrics';
import PressureBreakdown from './PressureBreakdown';

export type ShiftPalette = {
  label: string;
  background: string;
  border: string;
  text: string;
  description: string;
};

export type SidePanelProps = Readonly<{
  shift: Shift;
  resident: Resident | undefined;
  palette: ShiftPalette;
  dataset: Dataset;
  onClose: () => void;
  swapSettings: SwapSettings;
}>;

type SwapLoadState = 'idle' | 'loading' | 'ready' | 'error';

const TYPE_LABELS: Record<ShiftType, string> = {
  MOSES: 'Moses',
  WEILER: 'Weiler',
  'IP CONSULT': 'IP Consult',
  'NIGHT FLOAT': 'Night Float',
  BACKUP: 'Backup',
};

type SwapFinderSectionProps = Readonly<{
  dataset: Dataset;
  shift: Shift;
  swapSettings: SwapSettings;
}>;

const EMPTY_ROTATION_LABEL = '—';

type RotationPair = {
  before: string | null;
  after: string | null;
};

function formatSwapDate(shift: Shift): string {
  return dayjs(shift.startISO).format('MMM D, YYYY');
}

function resolveRotation(resident: Resident | undefined, iso: string): string | null {
  if (!resident) {
    return null;
  }

  const assignment = findRotationForDate(resident.rotations ?? [], iso);
  return assignment?.rotation ?? null;
}

function buildRotationPair(
  resident: Resident | undefined,
  beforeISO: string,
  afterISO: string,
): RotationPair {
  return {
    before: resolveRotation(resident, beforeISO),
    after: resolveRotation(resident, afterISO),
  };
}

function formatRotationValue(value: string | null): string {
  return value ?? EMPTY_ROTATION_LABEL;
}

function SwapFinderSection({ dataset, shift, swapSettings }: SwapFinderSectionProps): JSX.Element {
  const [loadState, setLoadState] = useState<SwapLoadState>('idle');
  const [error, setError] = useState<string | null>(null);
  const [searchResult, setSearchResult] = useState<SwapSearchResult | null>(null);
  const [sortKey, setSortKey] = useState<SwapSortKey>('score');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>(defaultSortDirection('score'));
  const [expandedCandidateId, setExpandedCandidateId] = useState<string | null>(null);
  const [residentFilter, setResidentFilter] = useState<string>(shift.residentId);
  const requestTokenRef = useRef(0);

  const residentsById = useMemo(() => new Map(dataset.residents.map((r) => [r.id, r])), [dataset]);

  const pressureValueFormatter = useMemo(
    () =>
      new Intl.NumberFormat(undefined, {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }),
    [],
  );

  const pressureDeltaFormatter = useMemo(
    () =>
      new Intl.NumberFormat(undefined, {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }),
    [],
  );

  useEffect(() => {
    requestTokenRef.current += 1;
    setLoadState('idle');
    setError(null);
    setSearchResult(null);
    setSortKey('score');
    setSortDirection(defaultSortDirection('score'));
    setExpandedCandidateId(null);
    setResidentFilter(shift.residentId);
  }, [dataset, shift.id]);

  const acceptedCandidates = searchResult?.accepted ?? [];
  const hiddenByResidentCount = useMemo(() => {
    if (!swapSettings.hideNegativeResident) {
      return 0;
    }
    return acceptedCandidates.reduce((count, candidate) => {
      const myScore = getMyScore(candidate);
      const counterpartScore = getCounterpartScore(candidate);
      return myScore < 0 || counterpartScore < 0 ? count + 1 : count;
    }, 0);
  }, [acceptedCandidates, swapSettings.hideNegativeResident]);

  const hiddenByTotalCount = useMemo(() => {
    if (!swapSettings.hideNegativeTotal) {
      return 0;
    }
    return acceptedCandidates.reduce(
      (count, candidate) => (getTotalScore(candidate) < 0 ? count + 1 : count),
      0,
    );
  }, [acceptedCandidates, swapSettings.hideNegativeTotal]);

  const rejectedCandidates = useMemo(() => {
    return (searchResult?.rejected ?? []).filter(
      (entry) => !['moses-tier-mismatch', 'weekend-mismatch'].includes(entry.reason.kind),
    );
  }, [searchResult?.rejected]);

  const filteredCandidates = useMemo(() => {
    return filterCandidatesBySettings(acceptedCandidates, {
      hideNegativeResident: swapSettings.hideNegativeResident,
      hideNegativeTotal: swapSettings.hideNegativeTotal,
    });
  }, [acceptedCandidates, swapSettings.hideNegativeResident, swapSettings.hideNegativeTotal]);

  const sortedCandidates = useMemo(() => {
    const today = dayjs().startOf('day');
    const upcoming = filteredCandidates.filter((candidate) => {
      const targetStart = dayjs(candidate.a.startISO);
      const counterpartStart = dayjs(candidate.b.startISO);
      if (targetStart.isBefore(today, 'day')) {
        return false;
      }
      if (counterpartStart.isBefore(today, 'day')) {
        return false;
      }
      return true;
    });

    const getTimestamp = (value: string) => dayjs(value).valueOf();

    const resolveDate = (candidate: SwapCandidate) => getTimestamp(candidate.b.startISO);
    const comparator = createSwapComparator(sortKey, {
      direction: sortDirection,
      resolveDate,
    });
    return [...upcoming].sort(comparator);
  }, [filteredCandidates, sortDirection, sortKey]);

  const callsByResidentOptions = useMemo(() => {
    const ownerName = residentsById.get(shift.residentId)?.name ?? shift.residentId;
    const counterparts = new Map<string, string>();
    sortedCandidates.forEach((candidate) => {
      const counterpartId = candidate.b.residentId;
      if (counterpartId === shift.residentId) {
        return;
      }
      if (!counterparts.has(counterpartId)) {
        const counterpartName = residentsById.get(counterpartId)?.name ?? counterpartId;
        counterparts.set(counterpartId, counterpartName);
      }
    });

    const counterpartOptions = Array.from(counterparts.entries())
      .map(([id, name]) => ({ id, name }))
      .sort((left, right) => left.name.localeCompare(right.name));

    return [{ id: shift.residentId, name: ownerName }, ...counterpartOptions];
  }, [residentsById, shift.residentId, sortedCandidates]);

  useEffect(() => {
    if (callsByResidentOptions.some((option) => option.id === residentFilter)) {
      return;
    }
    setResidentFilter(shift.residentId);
  }, [callsByResidentOptions, residentFilter, shift.residentId]);

  const visibleCandidates = useMemo(() => {
    if (residentFilter === shift.residentId) {
      return sortedCandidates;
    }
    return sortedCandidates.filter((candidate) => candidate.b.residentId === residentFilter);
  }, [sortedCandidates, residentFilter, shift.residentId]);

  useEffect(() => {
    if (!expandedCandidateId) {
      return;
    }
    const stillVisible = visibleCandidates.some((candidate) => {
      const swapKey = `${candidate.a.id}-${candidate.b.id}`;
      return swapKey === expandedCandidateId;
    });
    if (!stillVisible) {
      setExpandedCandidateId(null);
    }
  }, [expandedCandidateId, visibleCandidates]);

  const residentFocusValue = residentFilter === shift.residentId ? 'all' : residentFilter;

  const handleFindSwaps = async () => {
    const token = requestTokenRef.current + 1;
    requestTokenRef.current = token;
    setLoadState('loading');
    setError(null);
    try {
      const results = await findSwapsForShift(dataset, shift, { collectRejections: true });
      if (requestTokenRef.current !== token) {
        return;
      }
      setSearchResult(results);
      setExpandedCandidateId(null);
      setLoadState('ready');
    } catch (err) {
      if (requestTokenRef.current !== token) {
        return;
      }
      const message = err instanceof Error ? err.message : 'Unknown error while finding swaps';
      setError(message);
      setLoadState('error');
    }
  };

  const handleSortKeyChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
    const nextKey = event.target.value as SwapSortKey;
    setSortKey(nextKey);
    setSortDirection(defaultSortDirection(nextKey));
  };

  const toggleSortDirection = () => {
    setSortDirection((prev) => (prev === 'asc' ? 'desc' : 'asc'));
  };

  let sortDirectionText: string;
  if (sortKey === 'date') {
    sortDirectionText = sortDirection === 'desc' ? 'Latest → Soonest' : 'Soonest → Latest';
  } else {
    sortDirectionText = sortDirection === 'desc' ? 'High → Low' : 'Low → High';
  }

  const toggleCandidate = (candidateId: string) => {
    setExpandedCandidateId((previous) => (previous === candidateId ? null : candidateId));
  };

  const rejectedGeneral = useMemo(() => {
    return rejectedCandidates.filter((entry) => entry.category === 'general');
  }, [rejectedCandidates]);

  const rejectedShabbos = useMemo(() => {
    return rejectedCandidates.filter((entry) => entry.category === 'shabbos');
  }, [rejectedCandidates]);

  const shouldShowGeneral = swapSettings.showRejectedSwaps && rejectedGeneral.length > 0;
  const shouldShowShabbos = swapSettings.showShabbosRejectedSwaps && rejectedShabbos.length > 0;

  const renderRejectedSection = (label: string, items: SwapRejectionDetail[]) => {
    return (
      <section className="swap-panel__debug" aria-label={label}>
        <h4 className="swap-panel__debug-title">{label}</h4>
        <ul className="swap-panel__debug-list">
          {items.map((entry) => {
            const counterpartResident = residentsById.get(entry.b.residentId);
            const counterpartName = counterpartResident?.name ?? entry.b.residentId;
            const swapDate = formatSwapDate(entry.b);
            const scoreLabel = formatScore(entry.score);
            return (
              <li key={`rejected-${entry.a.id}-${entry.b.id}`} className="swap-panel__debug-item">
                <div className="swap-panel__debug-row">
                  <span className="swap-panel__debug-col swap-panel__debug-col--date">
                    {swapDate}
                  </span>
                  <span className="swap-panel__debug-col swap-panel__debug-col--resident">
                    {counterpartName}
                  </span>
                  <span className="swap-panel__debug-col swap-panel__debug-col--score">
                    {scoreLabel}
                  </span>
                </div>
                <p className="swap-panel__debug-reason">{entry.reasonLabel}</p>
              </li>
            );
          })}
        </ul>
      </section>
    );
  };

  return (
    <section className="swap-panel" aria-label="Swap finder" aria-busy={loadState === 'loading'}>
      <header className="swap-panel__header">
        <div>
          <h3 className="swap-panel__title">Find swaps</h3>
          <p className="swap-panel__subtitle">
            Explore feasible swaps for this shift. Results respect all scheduling constraints.
          </p>
        </div>
        <button
          type="button"
          className="swap-panel__action"
          onClick={handleFindSwaps}
          disabled={loadState === 'loading'}
        >
          {loadState === 'loading' ? 'Finding…' : 'Find swaps'}
        </button>
      </header>

      {loadState === 'idle' && (
        <p className="swap-panel__hint" aria-live="polite">
          Run the search to see suggested swap partners.
        </p>
      )}

      {loadState === 'error' && error && (
        <p role="alert" className="swap-panel__error">
          Unable to load swaps: {error}
        </p>
      )}

      {loadState === 'ready' && (
        <>
          <div className="swap-panel__controls">
            <div className="swap-panel__control">
              <label htmlFor="swap-sort-key">Sort by</label>
              <select id="swap-sort-key" value={sortKey} onChange={handleSortKeyChange}>
                {Object.entries(SWAP_SORT_LABELS).map(([key, label]) => (
                  <option key={key} value={key}>
                    {label}
                  </option>
                ))}
              </select>
            </div>
            <div className="swap-panel__control swap-panel__control--compact">
              <span id="swap-sort-direction-label" className="swap-panel__control-label">
                Order
              </span>
              <button
                type="button"
                className="swap-panel__order"
                aria-pressed={sortDirection === 'desc'}
                aria-labelledby="swap-sort-direction-label"
                onClick={toggleSortDirection}
              >
                {sortDirectionText}
              </button>
            </div>
            <div className="swap-panel__control">
              <label htmlFor="swap-resident-filter">Calls by resident</label>
              <select
                id="swap-resident-filter"
                value={residentFilter}
                onChange={(event) => setResidentFilter(event.target.value)}
              >
                {callsByResidentOptions.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {swapSettings.hideNegativeResident && hiddenByResidentCount > 0 && (
            <p className="swap-panel__filters">
              {hiddenByResidentCount === 1
                ? '1 call hidden because of negative resident score.'
                : `${hiddenByResidentCount} calls hidden because of negative resident score.`}
            </p>
          )}

          {swapSettings.hideNegativeTotal && hiddenByTotalCount > 0 && (
            <p className="swap-panel__filters">
              {hiddenByTotalCount === 1
                ? '1 call hidden because of negative combined score.'
                : `${hiddenByTotalCount} calls hidden because of negative combined score.`}
            </p>
          )}

          {visibleCandidates.length === 0 ? (
            <p className="swap-panel__empty" role="status" aria-live="polite">
              No swaps are available for this shift.
            </p>
          ) : (
            <ul className="swap-panel__list" aria-label="Swap suggestions">
              {visibleCandidates.map((candidate) => {
                const swapKey = `${candidate.a.id}-${candidate.b.id}`;
                const isExpanded = expandedCandidateId === swapKey;
                const detailsId = `swap-details-${swapKey}`;
                const originalResident = residentsById.get(candidate.a.residentId);
                const counterpartResident = residentsById.get(candidate.b.residentId);
                const counterpartName = counterpartResident?.name ?? candidate.b.residentId;
                const originalName = originalResident?.name ?? candidate.a.residentId;
                const targetDateLabel = formatSwapDate(candidate.b);
                const originalDateLabel = formatSwapDate(candidate.a);
                const originalRotations = buildRotationPair(
                  originalResident,
                  candidate.a.startISO,
                  candidate.b.startISO,
                );
                const counterpartRotations = buildRotationPair(
                  counterpartResident,
                  candidate.b.startISO,
                  candidate.a.startISO,
                );
                const myScoreLabel = `${formatScore(candidate.pressure.original.deltaTotal)}|${formatScore(candidate.score)}`;
                return (
                  <li
                    key={swapKey}
                    className={`swap-panel__item${isExpanded ? ' swap-panel__item--expanded' : ''}`}
                  >
                    <button
                      type="button"
                      className="swap-panel__row"
                      aria-expanded={isExpanded}
                      aria-controls={detailsId}
                      aria-label={`Swap with ${counterpartName} on ${targetDateLabel}`}
                      onClick={() => toggleCandidate(swapKey)}
                    >
                      <span className="swap-panel__cell swap-panel__cell--date">
                        {targetDateLabel}
                      </span>
                      <span className="swap-panel__cell swap-panel__cell--resident">
                        {counterpartName}
                      </span>
                      <span className="swap-panel__cell swap-panel__cell--score">
                        {myScoreLabel}
                      </span>
                    </button>

                    {isExpanded && (
                      <div
                        className="swap-panel__details"
                        id={detailsId}
                        role="group"
                        aria-label={`Swap details for ${originalName} and ${counterpartName}`}
                      >
                        <div className="swap-panel__shift-grid">
                          <article
                            className="swap-panel__shift"
                            aria-label={`Shift ${candidate.a.id} for ${originalName}`}
                          >
                            <h5>{originalName}</h5>
                            <p className="swap-panel__shift-type">
                              {TYPE_LABELS[candidate.a.type]}
                            </p>
                            <p className="swap-panel__shift-date">{originalDateLabel}</p>
                            <dl
                              className="swap-panel__shift-rotation"
                              aria-label="Rotation before and after swap"
                            >
                              <div>
                                <dt>Before</dt>
                                <dd>{formatRotationValue(originalRotations.before)}</dd>
                              </div>
                              <div>
                                <dt>After</dt>
                                <dd>{formatRotationValue(originalRotations.after)}</dd>
                              </div>
                            </dl>
                          </article>
                          <span className="swap-panel__swap-icon" aria-hidden="true">
                            ↔
                          </span>
                          <article
                            className="swap-panel__shift"
                            aria-label={`Shift ${candidate.b.id} for ${counterpartName}`}
                          >
                            <h5>{counterpartName}</h5>
                            <p className="swap-panel__shift-type">
                              {TYPE_LABELS[candidate.b.type]}
                            </p>
                            <p className="swap-panel__shift-date">{targetDateLabel}</p>
                            <dl
                              className="swap-panel__shift-rotation"
                              aria-label="Rotation before and after swap"
                            >
                              <div>
                                <dt>Before</dt>
                                <dd>{formatRotationValue(counterpartRotations.before)}</dd>
                              </div>
                              <div>
                                <dt>After</dt>
                                <dd>{formatRotationValue(counterpartRotations.after)}</dd>
                              </div>
                            </dl>
                          </article>
                        </div>

                        <PressureBreakdown
                          className="swap-panel__breakdown"
                          pressure={candidate.pressure}
                          originalLabel={originalName}
                          counterpartLabel={counterpartName}
                          valueFormatter={pressureValueFormatter}
                          deltaFormatter={pressureDeltaFormatter}
                          residentFocus={residentFocusValue}
                        />

                        {candidate.reasons && candidate.reasons.length > 0 && (
                          <ul className="best-swaps-panel__reasons" aria-label="Scoring highlights">
                            {candidate.reasons.map((reason) => (
                              <li key={`${swapKey}-reason-${reason}`}>{reason}</li>
                            ))}
                          </ul>
                        )}

                        {candidate.advisories && candidate.advisories.length > 0 && (
                          <ul className="best-swaps-panel__flags" aria-label="Swap considerations">
                            {candidate.advisories.map((advisory, index) => (
                              <li key={`${swapKey}-advisory-${index}`}>{advisory.message}</li>
                            ))}
                          </ul>
                        )}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}

          {(shouldShowGeneral || shouldShowShabbos) && (
            <div className="swap-panel__debug-sections">
              {shouldShowGeneral &&
                renderRejectedSection('Rejected swaps (debug)', rejectedGeneral)}
              {shouldShowShabbos &&
                renderRejectedSection('Rejected Shabbos swaps (debug)', rejectedShabbos)}
            </div>
          )}
        </>
      )}

      {loadState === 'loading' && (
        <p className="swap-panel__loading" role="status" aria-live="polite">
          Evaluating swap candidates…
        </p>
      )}
    </section>
  );
}

function formatShiftDateLabel(shift: Shift): string {
  const start = dayjs(shift.startISO);
  const end = dayjs(shift.endISO);
  const inSameDay = start.isSame(end, 'day');

  return inSameDay
    ? start.format('dddd, MMM D, YYYY')
    : `${start.format('MMM D, YYYY')} \u2013 ${end.format('MMM D, YYYY')}`;
}

export function SidePanel({
  shift,
  resident,
  palette,
  dataset,
  onClose,
  swapSettings,
}: SidePanelProps): JSX.Element {
  useEffect(() => {
    if (typeof document === 'undefined' || typeof window === 'undefined') {
      return;
    }
    if (typeof window.matchMedia !== 'function') {
      return;
    }
    const mediaQuery = window.matchMedia('(max-width: 768px)');
    if (!mediaQuery.matches) {
      return;
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const handleChange = () => {
      if (!mediaQuery.matches) {
        document.body.style.overflow = previousOverflow;
      } else {
        document.body.style.overflow = 'hidden';
      }
    };

    if (typeof mediaQuery.addEventListener === 'function') {
      mediaQuery.addEventListener('change', handleChange);
    } else if (typeof mediaQuery.addListener === 'function') {
      mediaQuery.addListener(handleChange);
    }

    return () => {
      if (typeof mediaQuery.removeEventListener === 'function') {
        mediaQuery.removeEventListener('change', handleChange);
      } else if (typeof mediaQuery.removeListener === 'function') {
        mediaQuery.removeListener(handleChange);
      }
      document.body.style.overflow = previousOverflow;
    };
  }, []);

  const dateLabel = formatShiftDateLabel(shift);
  const typeValue = shift.location ?? palette.label;

  return (
    <aside className="side-panel" aria-label="Selected shift details">
      <header className="side-panel__header">
        <div
          className="side-panel__badge"
          style={{ backgroundColor: palette.background, color: palette.text }}
        >
          <span className="side-panel__badge-label">{palette.label}</span>
        </div>
        <button
          type="button"
          className="side-panel__close"
          onClick={onClose}
          aria-label="Close shift details"
        >
          <span aria-hidden="true">×</span>
        </button>
      </header>

      <div className="side-panel__body">
        <h2 className="side-panel__title">{resident?.name ?? 'Unknown resident'}</h2>
        <dl className="side-panel__details">
          <div>
            <dt>Date</dt>
            <dd>{dateLabel}</dd>
          </div>
          {typeValue && (
            <div>
              <dt>Type</dt>
              <dd>{typeValue}</dd>
            </div>
          )}
        </dl>
      </div>

      <SwapFinderSection dataset={dataset} shift={shift} swapSettings={swapSettings} />
    </aside>
  );
}

export default SidePanel;
