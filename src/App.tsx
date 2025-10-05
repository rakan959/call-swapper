import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import dayjs from '@utils/dayjs';
import { Calendar, EventSourceInput } from '@fullcalendar/core';
import dayGridPlugin from '@fullcalendar/daygrid';
import timeGridPlugin from '@fullcalendar/timegrid';
import interactionPlugin from '@fullcalendar/interaction';
import listPlugin from '@fullcalendar/list';
import {
  Dataset,
  Resident,
  RotationAssignment,
  ResidentAcademicYearAssignment,
  Shift,
  SwapCandidate,
} from '@domain/types';
import {
  filterShiftsByResident,
  isValidResidentId,
  nextResidentSearch,
} from '@domain/residentFilter';
import { parseCsvToDataset, CsvValidationError } from '@utils/csv';
import {
  findRotationForDate,
  parseRotationCsv,
  RotationCsvValidationError,
  ResidentRotationsMap,
  ResidentAcademicYearMap,
} from '@utils/rotations';
import { findBestSwaps } from '@engine/swapEngine';
import SidePanel from './components/SidePanel';
import { SHIFT_PALETTE, LegendPaletteEntry } from './components/Legend';
import PressureBreakdown from './components/PressureBreakdown';
import { formatScore } from '@utils/score';
import {
  createSwapComparator,
  defaultSortDirection,
  SWAP_SORT_LABELS,
  SortDirection,
  SwapSortKey,
} from '@domain/swapSort';
import {
  getAverageScore,
  getCounterpartScore,
  getMyScore,
  getTotalScore,
} from '@utils/swapMetrics';
import { filterCandidatesBySettings } from '@utils/swapFilters';
import { loadSwapSettings, saveSwapSettings, SwapSettings } from '@domain/swapSettings';
import { debugError, debugLog } from '@utils/debug';
import { resolveRuntimeEnv } from './config/runtimeEnv';

const { csvUrl: DEFAULT_CSV_URL, rotationCsvUrl: DEFAULT_ROTATION_CSV_URL } = resolveRuntimeEnv();

const EMPTY_ROTATION_LABEL = '—';

type RotationPair = {
  before: string | null;
  after: string | null;
};

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

type LoadState = 'idle' | 'loading' | 'ready' | 'error';

type BestSwapsState = {
  status: 'idle' | 'loading' | 'ready' | 'error';
  candidates: SwapCandidate[];
  error: string | null;
};

type AllSwapsListProps = Readonly<{
  candidates: SwapCandidate[];
  residentsById: Map<string, Resident>;
  residentNameById: Map<string, string>;
  dateFormatter: Intl.DateTimeFormat;
  valueFormatter: Intl.NumberFormat;
  deltaFormatter: Intl.NumberFormat;
  expandedId: string | null;
  onToggle: (candidateId: string) => void;
}>;

function AllSwapsList({
  candidates,
  residentsById,
  residentNameById,
  dateFormatter,
  valueFormatter,
  deltaFormatter,
  expandedId,
  onToggle,
}: AllSwapsListProps): JSX.Element {
  return (
    <ul className="all-swaps-panel__list" aria-label="All swap combinations">
      {candidates.map((candidate) => {
        const swapKey = `${candidate.a.id}-${candidate.b.id}`;
        const isExpanded = expandedId === swapKey;
        const originalResidentName =
          residentNameById.get(candidate.a.residentId) ?? candidate.a.residentId;
        const counterpartResidentName =
          residentNameById.get(candidate.b.residentId) ?? candidate.b.residentId;
        const originalShiftDate = dateFormatter.format(new Date(candidate.a.startISO));
        const counterpartShiftDate = dateFormatter.format(new Date(candidate.b.startISO));
        const scoreLabel = `${formatScore(getMyScore(candidate))}|${formatScore(getCounterpartScore(candidate))}|${formatScore(getTotalScore(candidate))}`;
        const averageLabel = formatScore(getAverageScore(candidate));
        const originalResident = residentsById.get(candidate.a.residentId);
        const counterpartResident = residentsById.get(candidate.b.residentId);
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

        return (
          <li
            key={swapKey}
            className={`all-swaps-panel__item${isExpanded ? ' all-swaps-panel__item--expanded' : ''}`}
          >
            <button
              type="button"
              className="all-swaps-panel__row"
              aria-expanded={isExpanded}
              onClick={() => onToggle(swapKey)}
            >
              <span className="all-swaps-panel__cell all-swaps-panel__cell--date">
                {counterpartShiftDate}
              </span>
              <span className="all-swaps-panel__cell all-swaps-panel__cell--resident">
                {counterpartResidentName}
              </span>
              <span className="all-swaps-panel__cell all-swaps-panel__cell--score">
                <span className="all-swaps-panel__score-label">{scoreLabel}</span>
                <span className="all-swaps-panel__score-meta">Avg {averageLabel}</span>
              </span>
            </button>

            {isExpanded && (
              <div className="all-swaps-panel__details">
                <div className="all-swaps-panel__shift-grid">
                  <article
                    className="all-swaps-panel__shift"
                    aria-label={`Shift ${candidate.a.id} for ${originalResidentName}`}
                  >
                    <h4>{originalResidentName}</h4>
                    <p className="all-swaps-panel__shift-type">
                      {SHIFT_PALETTE[candidate.a.type].label}
                    </p>
                    <p className="all-swaps-panel__shift-date">{originalShiftDate}</p>
                    <dl
                      className="all-swaps-panel__shift-rotation"
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
                  <span className="all-swaps-panel__swap-icon" aria-hidden="true">
                    ↔
                  </span>
                  <article
                    className="all-swaps-panel__shift"
                    aria-label={`Shift ${candidate.b.id} for ${counterpartResidentName}`}
                  >
                    <h4>{counterpartResidentName}</h4>
                    <p className="all-swaps-panel__shift-type">
                      {SHIFT_PALETTE[candidate.b.type].label}
                    </p>
                    <p className="all-swaps-panel__shift-date">{counterpartShiftDate}</p>
                    <dl
                      className="all-swaps-panel__shift-rotation"
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
                  className="all-swaps-panel__breakdown"
                  pressure={candidate.pressure}
                  originalLabel={originalResidentName}
                  counterpartLabel={counterpartResidentName}
                  valueFormatter={valueFormatter}
                  deltaFormatter={deltaFormatter}
                />

                {candidate.reasons && candidate.reasons.length > 0 && (
                  <ul className="all-swaps-panel__reasons" aria-label="Scoring highlights">
                    {candidate.reasons.map((reason) => (
                      <li key={`${swapKey}-reason-${reason}`}>{reason}</li>
                    ))}
                  </ul>
                )}

                {candidate.advisories && candidate.advisories.length > 0 && (
                  <ul className="all-swaps-panel__flags" aria-label="Swap considerations">
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
  );
}

type AllSwapsPanelProps = Readonly<{
  status: BestSwapsState['status'];
  error: string | null;
  candidates: SwapCandidate[];
  residentsById: Map<string, Resident>;
  residentNameById: Map<string, string>;
  selectedResidentName: string | null;
  dateFormatter: Intl.DateTimeFormat;
  valueFormatter: Intl.NumberFormat;
  deltaFormatter: Intl.NumberFormat;
  settings: SwapSettings;
}>;

function resolveCandidateDate(candidate: SwapCandidate): number {
  const aTime = Date.parse(candidate.a.startISO);
  const bTime = Date.parse(candidate.b.startISO);
  if (Number.isNaN(aTime) && Number.isNaN(bTime)) {
    return 0;
  }
  if (Number.isNaN(aTime)) {
    return bTime;
  }
  if (Number.isNaN(bTime)) {
    return aTime;
  }
  return Math.min(aTime, bTime);
}

function AllSwapsPanel({
  status,
  error,
  candidates,
  residentsById,
  residentNameById,
  selectedResidentName,
  dateFormatter,
  valueFormatter,
  deltaFormatter,
  settings,
}: AllSwapsPanelProps): JSX.Element {
  const [sortKey, setSortKey] = useState<SwapSortKey>(settings.defaultSortKey);
  const [sortDirection, setSortDirection] = useState<SortDirection>(settings.defaultSortDirection);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const candidatePool = useMemo(() => {
    return candidates.filter(
      (candidate) => candidate.a.type !== 'BACKUP' && candidate.b.type !== 'BACKUP',
    );
  }, [candidates]);

  useEffect(() => {
    setSortKey(settings.defaultSortKey);
    setSortDirection(settings.defaultSortDirection);
    setExpandedId(null);
  }, [settings.defaultSortDirection, settings.defaultSortKey]);

  const filteredCandidates = useMemo(() => {
    return filterCandidatesBySettings(candidatePool, {
      hideNegativeResident: settings.hideNegativeResident,
      hideNegativeTotal: settings.hideNegativeTotal,
    });
  }, [candidatePool, settings.hideNegativeResident, settings.hideNegativeTotal]);

  const hiddenCount = candidatePool.length - filteredCandidates.length;

  const sortedCandidates = useMemo(() => {
    const comparator = createSwapComparator(sortKey, {
      direction: sortDirection,
      resolveDate: resolveCandidateDate,
      resolveTieBreaker: (candidate) => `${candidate.a.id}-${candidate.b.id}`,
    });
    return [...filteredCandidates].sort(comparator);
  }, [filteredCandidates, sortDirection, sortKey]);

  const handleSortKeyChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
    const key = event.target.value as SwapSortKey;
    setSortKey(key);
    setSortDirection(defaultSortDirection(key));
  };

  const toggleSortDirection = () => {
    setSortDirection((prev) => (prev === 'asc' ? 'desc' : 'asc'));
  };

  const toggleCandidate = (candidateId: string) => {
    setExpandedId((current) => (current === candidateId ? null : candidateId));
  };

  const sortDirectionText =
    sortKey === 'date'
      ? sortDirection === 'desc'
        ? 'Latest → Soonest'
        : 'Soonest → Latest'
      : sortDirection === 'desc'
        ? 'High → Low'
        : 'Low → High';

  let body: JSX.Element;
  if (status === 'idle') {
    body = (
      <p className="all-swaps-panel__hint">
        {selectedResidentName
          ? `Run the search to populate every feasible swap for ${selectedResidentName}.`
          : 'Choose a resident and run the swap search to populate this list.'}
      </p>
    );
  } else if (status === 'loading') {
    body = <p className="all-swaps-panel__loading">Evaluating all swap combinations…</p>;
  } else if (status === 'error') {
    body = (
      <p role="alert" className="all-swaps-panel__error">
        Unable to load swaps: {error ?? 'Unknown error'}
      </p>
    );
  } else if (sortedCandidates.length === 0) {
    body = (
      <p className="all-swaps-panel__empty">
        {filteredCandidates.length === 0
          ? 'No swaps match the current filters.'
          : 'No swaps are available for the selected resident.'}
      </p>
    );
  } else {
    body = (
      <>
        <div className="all-swaps-panel__controls">
          <div className="all-swaps-panel__control">
            <label htmlFor="all-swaps-sort-key">Sort by</label>
            <select id="all-swaps-sort-key" value={sortKey} onChange={handleSortKeyChange}>
              {Object.entries(SWAP_SORT_LABELS).map(([key, label]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
            </select>
          </div>
          <div className="all-swaps-panel__control all-swaps-panel__control--compact">
            <span id="all-swaps-sort-direction-label" className="all-swaps-panel__control-label">
              Order
            </span>
            <button
              type="button"
              className="all-swaps-panel__order"
              aria-pressed={sortDirection === 'desc'}
              aria-labelledby="all-swaps-sort-direction-label"
              onClick={toggleSortDirection}
            >
              {sortDirectionText}
            </button>
          </div>
        </div>

        {hiddenCount > 0 && (
          <p className="all-swaps-panel__filters">
            {hiddenCount} {hiddenCount === 1 ? 'swap is' : 'swaps are'} hidden by the current
            filters.
          </p>
        )}

        <AllSwapsList
          candidates={sortedCandidates}
          residentsById={residentsById}
          residentNameById={residentNameById}
          dateFormatter={dateFormatter}
          valueFormatter={valueFormatter}
          deltaFormatter={deltaFormatter}
          expandedId={expandedId}
          onToggle={toggleCandidate}
        />
      </>
    );
  }

  return <div className="all-swaps-panel">{body}</div>;
}

export default function App(): JSX.Element {
  const [dataset, setDataset] = useState<Dataset | null>(null);
  const [loadState, setLoadState] = useState<LoadState>('idle');
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectedResidentId, setSelectedResidentId] = useState<string | null>(() => {
    if (typeof window === 'undefined') {
      return null;
    }
    const params = new URLSearchParams(window.location.search);
    const residentParam = params.get('resident');
    return residentParam ?? null;
  });
  const [selectedShiftId, setSelectedShiftId] = useState<string | null>(null);
  const [bestSwapsState, setBestSwapsState] = useState<BestSwapsState>({
    status: 'idle',
    candidates: [],
    error: null,
  });
  const [expandedSwapId, setExpandedSwapId] = useState<string | null>(null);
  const [swapSettings, setSwapSettings] = useState<SwapSettings>(() => loadSwapSettings());
  const [isSwapSettingsOpen, setIsSwapSettingsOpen] = useState(false);

  const calendarContainerRef = useRef<HTMLDivElement | null>(null);
  const calendarRef = useRef<Calendar | null>(null);
  const bestSwapsRequestTokenRef = useRef(0);
  const swapSettingsContainerRef = useRef<HTMLDivElement | null>(null);

  const updateSwapSettings = useCallback(
    (update: Partial<SwapSettings>) => {
      setSwapSettings((current) => ({
        defaultSortKey: update.defaultSortKey ?? current.defaultSortKey,
        defaultSortDirection: update.defaultSortDirection ?? current.defaultSortDirection,
        hideNegativeResident: update.hideNegativeResident ?? current.hideNegativeResident,
        hideNegativeTotal: update.hideNegativeTotal ?? current.hideNegativeTotal,
      }));
    },
    [setSwapSettings],
  );

  useEffect(() => {
    if (!isSwapSettingsOpen || typeof document === 'undefined') {
      return;
    }
    const handlePointerDown = (event: MouseEvent) => {
      if (!swapSettingsContainerRef.current) {
        return;
      }
      if (event.target instanceof Node && swapSettingsContainerRef.current.contains(event.target)) {
        return;
      }
      setIsSwapSettingsOpen(false);
    };
    const handleKeydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsSwapSettingsOpen(false);
      }
    };
    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeydown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeydown);
    };
  }, [isSwapSettingsOpen]);

  const handleDefaultSortKeySettingChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
    const key = event.target.value as SwapSortKey;
    updateSwapSettings({
      defaultSortKey: key,
      defaultSortDirection: defaultSortDirection(key),
    });
  };

  const handleDefaultSortDirectionSetting = () => {
    updateSwapSettings({
      defaultSortDirection: swapSettings.defaultSortDirection === 'asc' ? 'desc' : 'asc',
    });
  };

  const handleToggleHideNegativeResident = () => {
    updateSwapSettings({ hideNegativeResident: !swapSettings.hideNegativeResident });
  };

  const handleToggleHideNegativeTotal = () => {
    updateSwapSettings({ hideNegativeTotal: !swapSettings.hideNegativeTotal });
  };

  const defaultSortDirectionText = useMemo(() => {
    if (swapSettings.defaultSortKey === 'date') {
      return swapSettings.defaultSortDirection === 'desc' ? 'Latest → Soonest' : 'Soonest → Latest';
    }
    return swapSettings.defaultSortDirection === 'desc' ? 'High → Low' : 'Low → High';
  }, [swapSettings.defaultSortDirection, swapSettings.defaultSortKey]);

  useEffect(() => {
    const container = calendarContainerRef.current;
    if (!container) {
      return;
    }

    const supportsMatchMedia =
      typeof window !== 'undefined' && typeof window.matchMedia === 'function';
    const mediaQuery = supportsMatchMedia ? window.matchMedia('(max-width: 768px)') : null;

    const resolveHeaderToolbar = (compact: boolean) => ({
      left: 'prev,next today',
      center: 'title',
      right: compact ? 'listWeek,dayGridMonth' : 'dayGridMonth,timeGridWeek',
    });

    const initialCompact = mediaQuery?.matches ?? false;

    const calendar = new Calendar(container, {
      plugins: [dayGridPlugin, timeGridPlugin, interactionPlugin, listPlugin],
      initialView: initialCompact ? 'listWeek' : 'dayGridMonth',
      headerToolbar: resolveHeaderToolbar(initialCompact),
      height: 'auto',
      stickyHeaderDates: !initialCompact,
      expandRows: true,
      eventDisplay: 'block',
      events: [],
      datesSet: () => {
        rotationColumnSyncRef.current();
      },
      eventClick: (info) => {
        setSelectedShiftId(info.event.id);
      },
    });

    const applyResponsiveOptions = (compact: boolean) => {
      calendar.setOption('headerToolbar', resolveHeaderToolbar(compact));
      calendar.setOption('stickyHeaderDates', !compact);
      if (compact) {
        if (calendar.view?.type !== 'listWeek') {
          calendar.changeView('listWeek');
        }
      } else if (calendar.view?.type === 'listWeek') {
        calendar.changeView('dayGridMonth');
      }
    };

    let handleMediaChange: ((event: MediaQueryListEvent) => void) | null = null;
    if (mediaQuery) {
      handleMediaChange = (event) => {
        applyResponsiveOptions(event.matches);
      };

      if (typeof mediaQuery.addEventListener === 'function') {
        mediaQuery.addEventListener('change', handleMediaChange);
      } else if (typeof mediaQuery.addListener === 'function') {
        mediaQuery.addListener(handleMediaChange);
      }
    }

    calendar.render();
    calendarRef.current = calendar;
    rotationColumnSyncRef.current();

    applyResponsiveOptions(initialCompact);

    return () => {
      if (mediaQuery && handleMediaChange) {
        if (typeof mediaQuery.removeEventListener === 'function') {
          mediaQuery.removeEventListener('change', handleMediaChange);
        } else if (typeof mediaQuery.removeListener === 'function') {
          mediaQuery.removeListener(handleMediaChange);
        }
      }
      calendar.destroy();
      calendarRef.current = null;
    };
  }, []);

  const residentOptions = useMemo(() => {
    if (!dataset) {
      return [];
    }
    return [...dataset.residents].sort((a, b) => a.name.localeCompare(b.name));
  }, [dataset]);

  const visibleShifts = useMemo<Shift[]>(() => {
    if (!dataset) {
      return [];
    }
    return filterShiftsByResident(dataset.shifts, selectedResidentId);
  }, [dataset, selectedResidentId]);

  const filteredResident = useMemo(() => {
    if (!dataset || !selectedResidentId) {
      return null;
    }
    return dataset.residents.find((resident) => resident.id === selectedResidentId) ?? null;
  }, [dataset, selectedResidentId]);

  const residentNameById = useMemo(() => {
    if (!dataset) {
      return new Map<string, string>();
    }
    return new Map(dataset.residents.map((resident) => [resident.id, resident.name]));
  }, [dataset]);

  const residentsById = useMemo(() => {
    if (!dataset) {
      return new Map<string, Resident>();
    }
    return new Map(dataset.residents.map((resident) => [resident.id, resident]));
  }, [dataset]);

  const bestSwapDateFormatter = useMemo(
    () =>
      new Intl.DateTimeFormat(undefined, {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      }),
    [],
  );

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

  const rotationAssignmentsByWeek = useMemo(() => {
    if (!filteredResident) {
      return new Map<string, RotationAssignment>();
    }
    const assignments = new Map<string, RotationAssignment>();
    filteredResident.rotations.forEach((assignment) => {
      const key = dayjs.utc(assignment.weekStartISO).format('YYYY-MM-DD');
      if (!assignments.has(key)) {
        assignments.set(key, assignment);
      }
    });
    return assignments;
  }, [filteredResident]);

  useEffect(() => {
    if (!dataset) {
      return;
    }
    if (isValidResidentId(dataset.residents, selectedResidentId)) {
      return;
    }
    setSelectedResidentId(null);
  }, [dataset, selectedResidentId]);

  useEffect(() => {
    if (!dataset) {
      setSelectedShiftId(null);
      return;
    }
    if (!selectedShiftId) {
      return;
    }
    const exists = dataset.shifts.some((shift) => shift.id === selectedShiftId);
    if (!exists) {
      setSelectedShiftId(null);
    }
  }, [dataset, selectedShiftId]);

  useEffect(() => {
    if (!selectedShiftId) {
      return;
    }
    const isVisible = visibleShifts.some((shift) => shift.id === selectedShiftId);
    if (!isVisible) {
      setSelectedShiftId(null);
    }
  }, [visibleShifts, selectedShiftId]);

  useEffect(() => {
    setExpandedSwapId(null);
  }, [selectedResidentId]);

  useEffect(() => {
    saveSwapSettings(swapSettings);
  }, [swapSettings]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }
    const search = nextResidentSearch(window.location.search, selectedResidentId);
    const nextUrl = `${window.location.pathname}${search}${window.location.hash}`;
    if (nextUrl !== window.location.pathname + window.location.search + window.location.hash) {
      window.history.replaceState(window.history.state, '', nextUrl);
    }
  }, [selectedResidentId]);

  useEffect(() => {
    bestSwapsRequestTokenRef.current += 1;
    setBestSwapsState({ status: 'idle', candidates: [], error: null });
  }, [dataset, selectedResidentId]);

  const handleFindBestSwaps = useCallback(async () => {
    if (!dataset || !selectedResidentId) {
      return;
    }
    setExpandedSwapId(null);
    const token = bestSwapsRequestTokenRef.current + 1;
    bestSwapsRequestTokenRef.current = token;
    setBestSwapsState({ status: 'loading', candidates: [], error: null });
    try {
      const results = await findBestSwaps(dataset, selectedResidentId);
      if (bestSwapsRequestTokenRef.current !== token) {
        return;
      }
      setBestSwapsState({ status: 'ready', candidates: results, error: null });
    } catch (error: unknown) {
      if (bestSwapsRequestTokenRef.current !== token) {
        return;
      }
      const message =
        error instanceof Error ? error.message : 'Unknown error while finding best swaps';
      setBestSwapsState({ status: 'error', candidates: [], error: message });
    }
  }, [dataset, selectedResidentId]);

  const filteredBestSwaps = useMemo(() => {
    return filterCandidatesBySettings(bestSwapsState.candidates, {
      hideNegativeResident: swapSettings.hideNegativeResident,
      hideNegativeTotal: swapSettings.hideNegativeTotal,
    });
  }, [
    bestSwapsState.candidates,
    swapSettings.hideNegativeResident,
    swapSettings.hideNegativeTotal,
  ]);

  const hiddenBestSwapsCount = bestSwapsState.candidates.length - filteredBestSwaps.length;

  const topBestSwaps = useMemo(() => {
    return filteredBestSwaps.slice(0, 10);
  }, [filteredBestSwaps]);

  const handleToggleCandidate = useCallback((candidateKey: string) => {
    setExpandedSwapId((current) => (current === candidateKey ? null : candidateKey));
  }, []);

  const isBestSwapsActionDisabled =
    !dataset || loadState !== 'ready' || !selectedResidentId || bestSwapsState.status === 'loading';

  const events = useMemo<EventSourceInput>(() => {
    return visibleShifts.map((shift) => {
      const palette = SHIFT_PALETTE[shift.type];
      return {
        id: shift.id,
        title: palette.label,
        start: shift.startISO,
        end: shift.endISO,
        backgroundColor: palette.background,
        borderColor: palette.border,
        textColor: palette.text,
        display: 'block',
        classNames: selectedShiftId === shift.id ? ['fc-event--selected'] : [],
      };
    });
  }, [visibleShifts, selectedShiftId]);

  const selectedShift = useMemo(() => {
    if (!dataset || !selectedShiftId) {
      return null;
    }
    return dataset.shifts.find((shift) => shift.id === selectedShiftId) ?? null;
  }, [dataset, selectedShiftId]);

  const selectedResident = useMemo(() => {
    if (!dataset || !selectedShift) {
      return undefined;
    }
    return dataset.residents.find((resident) => resident.id === selectedShift.residentId);
  }, [dataset, selectedShift]);

  const syncRotationColumn = useCallback(() => {
    const calendarInstance = calendarRef.current;
    const container = calendarContainerRef.current;
    if (!container) {
      return;
    }

    const applyAriaColIndices = (
      cells: ArrayLike<HTMLTableCellElement>,
      startIndex: number,
    ): void => {
      for (let offset = 0; offset < cells.length; offset += 1) {
        const cell = cells[offset];
        if (cell) {
          cell.setAttribute('aria-colindex', `${startIndex + offset}`);
        }
      }
    };

    const removeRotationColumn = (): void => {
      container.querySelectorAll('.calendar-rotation-header').forEach((node) => node.remove());
      container.querySelectorAll('.calendar-rotation-cell').forEach((node) => node.remove());

      const headerRowEl = container.querySelector('.fc-col-header thead tr');
      if (headerRowEl) {
        applyAriaColIndices(headerRowEl.querySelectorAll('th'), 1);
      }

      container
        .querySelectorAll<HTMLTableRowElement>('.fc-daygrid-body tbody tr')
        .forEach((row) => {
          applyAriaColIndices(row.querySelectorAll<HTMLTableCellElement>('td[data-date]'), 1);
        });
    };

    removeRotationColumn();

    if (!calendarInstance || calendarInstance.view?.type !== 'dayGridMonth' || !filteredResident) {
      return;
    }

    const resolveWeekStart = (
      firstDateAttr: string | null,
    ): { mondayKey: string; monday: dayjs.Dayjs } | null => {
      if (!firstDateAttr) {
        return null;
      }

      let monday = dayjs.utc(firstDateAttr, 'YYYY-MM-DD', true);
      if (!monday.isValid()) {
        monday = dayjs.utc(firstDateAttr);
      }
      if (!monday.isValid()) {
        return null;
      }

      const dayOfWeek = monday.day();
      if (dayOfWeek === 0) {
        monday = monday.add(1, 'day');
      } else if (dayOfWeek > 1) {
        monday = monday.subtract(dayOfWeek - 1, 'day');
      }

      return { mondayKey: monday.format('YYYY-MM-DD'), monday };
    };

    const today = dayjs.utc().startOf('day');

    const createRotationCell = (
      mondayKey: string,
      monday: dayjs.Dayjs,
      assignment: RotationAssignment | undefined,
    ): HTMLTableCellElement => {
      const rotationCell = document.createElement('td');
      rotationCell.className = 'calendar-rotation-cell';
      rotationCell.setAttribute('role', 'gridcell');
      rotationCell.setAttribute('aria-colindex', '1');
      rotationCell.setAttribute('data-rotation-week', mondayKey);

      if (assignment) {
        rotationCell.textContent = assignment.rotation;
        if (assignment.rawRotation && assignment.rawRotation !== assignment.rotation) {
          rotationCell.title = assignment.rawRotation;
        }
        const weekEnd = monday.add(6, 'day');
        if (!today.isBefore(monday) && !today.isAfter(weekEnd)) {
          rotationCell.classList.add('calendar-rotation-cell--current');
        }
      } else {
        rotationCell.textContent = '—';
        rotationCell.classList.add('calendar-rotation-cell--empty');
      }

      return rotationCell;
    };

    const updateWeekRow = (row: HTMLTableRowElement): void => {
      const dayCells = Array.from(row.querySelectorAll<HTMLTableCellElement>('td[data-date]'));
      if (dayCells.length === 0) {
        return;
      }

      const firstCell = dayCells[0] ?? null;
      const weekInfo = resolveWeekStart(firstCell ? firstCell.getAttribute('data-date') : null);
      if (!weekInfo) {
        return;
      }

      const assignment = rotationAssignmentsByWeek.get(weekInfo.mondayKey);
      const rotationCell = createRotationCell(weekInfo.mondayKey, weekInfo.monday, assignment);
      row.insertBefore(rotationCell, row.firstChild);
      applyAriaColIndices(dayCells, 2);
    };

    const headerRow = container.querySelector('.fc-col-header thead tr');
    if (headerRow) {
      const rotationHeader = document.createElement('th');
      rotationHeader.className = 'calendar-rotation-header';
      rotationHeader.setAttribute('role', 'columnheader');
      rotationHeader.setAttribute('aria-colindex', '1');

      const rotationLabel = document.createElement('span');
      rotationLabel.className = 'calendar-rotation-header__subtitle';
      rotationLabel.textContent = 'Rotation';

      const rotationResident = document.createElement('span');
      rotationResident.className = 'calendar-rotation-header__title';
      rotationResident.textContent = filteredResident.name;

      rotationHeader.append(rotationLabel, rotationResident);
      rotationHeader.title = `${filteredResident.name} rotation schedule`;
      headerRow.insertBefore(rotationHeader, headerRow.firstChild);
      applyAriaColIndices(headerRow.querySelectorAll('th'), 1);
    }

    const weekRows = container.querySelectorAll<HTMLTableRowElement>('.fc-daygrid-body tbody tr');
    weekRows.forEach(updateWeekRow);
  }, [filteredResident, rotationAssignmentsByWeek]);

  const rotationColumnSyncRef = useRef<() => void>(() => {});
  rotationColumnSyncRef.current = syncRotationColumn;

  const selectedPalette: LegendPaletteEntry | null = selectedShift
    ? SHIFT_PALETTE[selectedShift.type]
    : null;

  useEffect(() => {
    const calendar = calendarRef.current;
    if (!calendar) {
      return;
    }

    calendar.removeAllEventSources();
    calendar.addEventSource(events);
    syncRotationColumn();
  }, [events, syncRotationColumn]);

  useEffect(() => {
    syncRotationColumn();
  }, [rotationAssignmentsByWeek, syncRotationColumn]);

  useEffect(() => {
    if (loadState === 'ready') {
      syncRotationColumn();
    }
  }, [loadState, syncRotationColumn]);

  useEffect(() => {
    const runtimeWindow = window as typeof window & {
      CSV_URL?: string;
      ROTATION_CSV_URL?: string;
    };

    const scheduleUrl = runtimeWindow.CSV_URL ?? DEFAULT_CSV_URL;
    const rotationUrl = runtimeWindow.ROTATION_CSV_URL ?? DEFAULT_ROTATION_CSV_URL;

    if (!scheduleUrl) {
      setLoadState('idle');
      setLoadError(null);
      return;
    }

    const fetchCsv = async (url: string, label: string): Promise<string> => {
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`Failed to fetch ${label} CSV (status ${response.status})`);
      }
      return response.text();
    };

    const loadData = async (): Promise<void> => {
      setLoadState('loading');
      setLoadError(null);

      try {
        const [scheduleCsv, rotationCsv] = await Promise.all([
          fetchCsv(scheduleUrl, 'schedule'),
          rotationUrl ? fetchCsv(rotationUrl, 'rotation') : Promise.resolve(''),
        ]);

        const parsedDataset = parseCsvToDataset(scheduleCsv);
        const rotationData = rotationUrl
          ? parseRotationCsv(rotationCsv)
          : {
              rotations: new Map<string, RotationAssignment[]>(),
              academicYears: new Map<string, ResidentAcademicYearAssignment[]>(),
            };
        const rotationAssignments: ResidentRotationsMap = rotationData.rotations;
        const academicYearAssignments: ResidentAcademicYearMap = rotationData.academicYears;

        const augmentedDataset: Dataset = {
          ...parsedDataset,
          residents: parsedDataset.residents.map((resident) => ({
            ...resident,
            rotations: rotationAssignments.get(resident.id) ?? [],
            academicYears: academicYearAssignments.get(resident.id) ?? [],
          })),
        };

        const scheduleResidentIds = new Set(augmentedDataset.residents.map((entry) => entry.id));
        const unmatchedRotations = Array.from(rotationAssignments.keys()).filter(
          (residentId) => !scheduleResidentIds.has(residentId),
        );
        if (unmatchedRotations.length > 0) {
          debugLog('app.rotations.unmatched', () => ({ count: unmatchedRotations.length }));
        }

        setDataset(augmentedDataset);
        setLoadState('ready');
      } catch (error: unknown) {
        let message = 'Unknown error while loading schedule data';
        if (
          error instanceof CsvValidationError ||
          error instanceof RotationCsvValidationError ||
          error instanceof Error
        ) {
          message = error.message;
        }
        debugError('app.data.load-error', () => ({
          message,
          kind: error instanceof Error ? error.name : typeof error,
        }));
        setDataset(null);
        setLoadError(message);
        setLoadState('error');
      }
    };

    void loadData();
  }, []);

  const scheduleSummary = useMemo(() => {
    if (!dataset) {
      return null;
    }
    const residents = dataset.residents.length;
    const shifts = dataset.shifts.length;
    if (selectedResidentId) {
      const resident = dataset.residents.find((entry) => entry.id === selectedResidentId);
      const targetName = resident?.name ?? selectedResidentId;
      const residentShiftCount = filterShiftsByResident(dataset.shifts, selectedResidentId).length;
      return `${residentShiftCount} shift${residentShiftCount === 1 ? '' : 's'} for ${targetName} (of ${shifts} total across ${residents} residents)`;
    }
    return `${shifts} shift${shifts === 1 ? '' : 's'} across ${residents} resident${residents === 1 ? '' : 's'}`;
  }, [dataset, selectedResidentId]);

  let bestSwapsContent: React.ReactNode;
  if (!dataset || loadState !== 'ready') {
    bestSwapsContent = (
      <p className="best-swaps-panel__hint">
        Load the schedule data to search for recommended swaps.
      </p>
    );
  } else if (!selectedResidentId) {
    bestSwapsContent = (
      <p className="best-swaps-panel__hint">
        Filter the calendar by a resident to evaluate their swap opportunities.
      </p>
    );
  } else {
    const residentDisplayName = filteredResident?.name ?? 'the selected resident';
    bestSwapsContent = (
      <>
        {bestSwapsState.status === 'loading' && (
          <p className="best-swaps-panel__loading">
            Evaluating swap combinations for {residentDisplayName}…
          </p>
        )}

        {bestSwapsState.status === 'error' && bestSwapsState.error && (
          <p role="alert" className="best-swaps-panel__error">
            Unable to load best swaps: {bestSwapsState.error}
          </p>
        )}

        {bestSwapsState.status === 'ready' &&
          hiddenBestSwapsCount > 0 &&
          topBestSwaps.length > 0 && (
            <p className="best-swaps-panel__filters">
              {hiddenBestSwapsCount === 1
                ? '1 swap suggestion is hidden by the current filters.'
                : `${hiddenBestSwapsCount} swap suggestions are hidden by the current filters.`}
            </p>
          )}

        {bestSwapsState.status === 'ready' && topBestSwaps.length === 0 && (
          <p className="best-swaps-panel__empty">
            {hiddenBestSwapsCount > 0
              ? 'No swap suggestions match the current filters.'
              : `No feasible swaps were found for ${residentDisplayName}.`}
          </p>
        )}

        {bestSwapsState.status === 'ready' && topBestSwaps.length > 0 && (
          <>
            <h3 className="best-swaps-panel__section-title">Top 10 swap suggestions</h3>
            <ol className="best-swaps-panel__list" aria-label="Top 10 swap suggestions">
              {topBestSwaps.map((candidate) => {
                const aResidentName =
                  residentNameById.get(candidate.a.residentId) ?? candidate.a.residentId;
                const bResidentName =
                  residentNameById.get(candidate.b.residentId) ?? candidate.b.residentId;
                const aStart = new Date(candidate.a.startISO);
                const bStart = new Date(candidate.b.startISO);
                const aDate = bestSwapDateFormatter.format(aStart);
                const bDate = bestSwapDateFormatter.format(bStart);
                const aShiftLabel = SHIFT_PALETTE[candidate.a.type].label;
                const bShiftLabel = SHIFT_PALETTE[candidate.b.type].label;
                const originalResident = residentsById.get(candidate.a.residentId);
                const counterpartResident = residentsById.get(candidate.b.residentId);
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
                const swapKey = `${candidate.a.id}-${candidate.b.id}`;
                const isExpanded = expandedSwapId === swapKey;
                const scoreLabel = `${formatScore(candidate.pressure.original.deltaTotal)}|${formatScore(candidate.score)}`;

                return (
                  <li
                    key={swapKey}
                    className={`best-swaps-panel__item${isExpanded ? ' best-swaps-panel__item--expanded' : ''}`}
                  >
                    <button
                      type="button"
                      className="best-swaps-panel__row"
                      aria-expanded={isExpanded}
                      onClick={() => handleToggleCandidate(swapKey)}
                    >
                      <span className="best-swaps-panel__cell best-swaps-panel__cell--date">
                        {aDate}
                      </span>
                      <span className="best-swaps-panel__cell best-swaps-panel__cell--resident">
                        {bResidentName}
                      </span>
                      <span className="best-swaps-panel__cell best-swaps-panel__cell--score">
                        {scoreLabel}
                      </span>
                    </button>

                    {isExpanded && (
                      <div className="best-swaps-panel__details">
                        <div className="best-swaps-panel__shift-grid">
                          <article
                            className="best-swaps-panel__shift"
                            aria-label={`Shift ${candidate.a.id} for ${aResidentName}`}
                          >
                            <h4>{aResidentName}</h4>
                            <p className="best-swaps-panel__shift-type">{aShiftLabel}</p>
                            <p className="best-swaps-panel__shift-date">{aDate}</p>
                            <dl
                              className="best-swaps-panel__shift-rotation"
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
                          <span className="best-swaps-panel__swap-icon" aria-hidden="true">
                            ↔
                          </span>
                          <article
                            className="best-swaps-panel__shift"
                            aria-label={`Shift ${candidate.b.id} for ${bResidentName}`}
                          >
                            <h4>{bResidentName}</h4>
                            <p className="best-swaps-panel__shift-type">{bShiftLabel}</p>
                            <p className="best-swaps-panel__shift-date">{bDate}</p>
                            <dl
                              className="best-swaps-panel__shift-rotation"
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
                          className="best-swaps-panel__breakdown"
                          pressure={candidate.pressure}
                          originalLabel={aResidentName}
                          counterpartLabel={bResidentName}
                          valueFormatter={pressureValueFormatter}
                          deltaFormatter={pressureDeltaFormatter}
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
            </ol>
          </>
        )}
      </>
    );
  }

  return (
    <div className="app" role="application" aria-labelledby="app-title">
      <header className="app__header">
        <div className="app__header-inner">
          <div className="app__header-primary">
            <h1 id="app-title">Call Swap Finder</h1>
            <p className="app__tagline">
              View the call schedule, switch between month and week views, and understand shift
              types at a glance.
            </p>
          </div>
          <div className="app__header-controls">
            <form className="resident-filter" aria-label="Resident filter">
              <label htmlFor="resident-select">Filter by resident</label>
              <select
                id="resident-select"
                value={selectedResidentId ?? ''}
                onChange={(event) => {
                  const value = event.target.value;
                  setSelectedResidentId(value === '' ? null : value);
                }}
                disabled={!dataset || residentOptions.length === 0}
              >
                <option value="">All residents</option>
                {residentOptions.map((resident) => (
                  <option key={resident.id} value={resident.id}>
                    {resident.name}
                  </option>
                ))}
              </select>
            </form>
            <div className="swap-settings" ref={swapSettingsContainerRef}>
              <button
                type="button"
                className="swap-settings__toggle"
                aria-haspopup="dialog"
                aria-expanded={isSwapSettingsOpen}
                aria-controls="swap-settings-dialog"
                onClick={() => setIsSwapSettingsOpen((previous) => !previous)}
              >
                Settings
              </button>
              {isSwapSettingsOpen && (
                <dialog
                  id="swap-settings-dialog"
                  className="swap-settings__popover"
                  aria-modal="false"
                  open
                >
                  <h3 className="swap-settings__title">Swap defaults</h3>
                  <div className="swap-settings__row">
                    <label htmlFor="swap-default-sort">Default sort</label>
                    <select
                      id="swap-default-sort"
                      value={swapSettings.defaultSortKey}
                      onChange={handleDefaultSortKeySettingChange}
                    >
                      {Object.entries(SWAP_SORT_LABELS).map(([key, label]) => (
                        <option key={key} value={key}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="swap-settings__row swap-settings__row--compact">
                    <span id="swap-default-order-label" className="swap-settings__label">
                      Default order
                    </span>
                    <button
                      type="button"
                      className="swap-settings__order"
                      aria-labelledby="swap-default-order-label"
                      onClick={handleDefaultSortDirectionSetting}
                    >
                      {defaultSortDirectionText}
                    </button>
                  </div>
                  <fieldset className="swap-settings__fieldset">
                    <legend className="swap-settings__legend">Filters</legend>
                    <label htmlFor="swap-setting-hide-resident" className="swap-settings__checkbox">
                      <input
                        id="swap-setting-hide-resident"
                        type="checkbox"
                        checked={swapSettings.hideNegativeResident}
                        onChange={handleToggleHideNegativeResident}
                      />
                      <span>Hide swaps when any resident score is negative</span>
                    </label>
                    <label htmlFor="swap-setting-hide-total" className="swap-settings__checkbox">
                      <input
                        id="swap-setting-hide-total"
                        type="checkbox"
                        checked={swapSettings.hideNegativeTotal}
                        onChange={handleToggleHideNegativeTotal}
                      />
                      <span>Hide swaps when the combined score is negative</span>
                    </label>
                  </fieldset>
                </dialog>
              )}
            </div>
          </div>
        </div>
      </header>

      <main className="app__main">
        <section className="calendar-panel" aria-label="Call schedule calendar">
          <div
            ref={calendarContainerRef}
            className="calendar-panel__calendar"
            aria-live="polite"
            aria-busy={loadState === 'loading'}
          />
        </section>

        {selectedShift && selectedPalette && dataset && (
          <div className="side-panel-layer">
            <button
              type="button"
              className="side-panel-layer__scrim"
              aria-label="Dismiss shift details overlay"
              onClick={() => setSelectedShiftId(null)}
            />
            <SidePanel
              shift={selectedShift}
              resident={selectedResident}
              palette={selectedPalette}
              dataset={dataset}
              swapSettings={swapSettings}
              onClose={() => setSelectedShiftId(null)}
            />
          </div>
        )}
        <section className="best-swaps-panel" aria-label="Find best swaps">
          <header className="best-swaps-panel__header">
            <div>
              <h2 className="best-swaps-panel__title">Find best swaps</h2>
              <p className="best-swaps-panel__subtitle">
                {filteredResident
                  ? `Search for the strongest swap partners for ${filteredResident.name}.`
                  : 'Choose a resident to enable tailored swap recommendations.'}
              </p>
            </div>
            <div className="best-swaps-panel__actions">
              <button
                type="button"
                className="best-swaps-panel__action"
                onClick={handleFindBestSwaps}
                disabled={isBestSwapsActionDisabled}
              >
                {bestSwapsState.status === 'loading' ? 'Finding…' : 'Find best swaps'}
              </button>
            </div>
          </header>

          {bestSwapsContent}

          <AllSwapsPanel
            status={bestSwapsState.status}
            error={bestSwapsState.error}
            candidates={bestSwapsState.candidates}
            residentsById={residentsById}
            residentNameById={residentNameById}
            selectedResidentName={filteredResident?.name ?? null}
            dateFormatter={bestSwapDateFormatter}
            valueFormatter={pressureValueFormatter}
            deltaFormatter={pressureDeltaFormatter}
            settings={swapSettings}
          />
        </section>

        <section className="status-panel" aria-live="polite">
          {loadState === 'loading' && <p>Loading schedule…</p>}
          {loadState === 'error' && loadError && (
            <p role="alert">Unable to load the schedule: {loadError}</p>
          )}
          {loadState === 'idle' && !dataset && (
            <p>
              Configure a CSV source by setting <code>VITE_CSV_URL</code> during build or defining{' '}
              <code>window.CSV_URL</code> before the app loads.
            </p>
          )}
          {loadState === 'ready' && scheduleSummary && <p>{scheduleSummary}</p>}
        </section>
      </main>
    </div>
  );
}
