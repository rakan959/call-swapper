/**
 * @vitest-environment jsdom
 * @req: F-005
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import App from '../../src/App';
import { Dataset, Shift, SwapCandidate, SwapPressureBreakdown } from '../../src/domain/types';
import { isWeekendOrHoliday } from '../../src/domain/calendar';

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

type CalendarEvent = {
  id: string;
};

type CalendarHeaderToolbar = {
  left?: string;
  center?: string;
  right?: string;
};

type CalendarOptions = {
  initialView?: string;
  headerToolbar?: CalendarHeaderToolbar;
  stickyHeaderDates?: boolean;
  datesSet?: () => void;
  eventClick?: (info: { event: { id: string } }) => void;
  events?: CalendarEvent[];
};

type CalendarStubInstance = {
  options: CalendarOptions;
  eventSources: CalendarEvent[][];
  render(): void;
  destroy(): void;
  removeAllEventSources(): void;
  addEventSource(events: CalendarEvent[]): void;
  setOption(name: string, value: unknown): void;
  changeView(viewName: string): void;
  view: { type: string };
};

const calendarInstances = vi.hoisted(() => [] as CalendarStubInstance[]) as CalendarStubInstance[];

const parseCsvToDatasetMock = vi.hoisted(() => vi.fn());

vi.mock('@utils/csv', () => {
  class CsvValidationError extends Error {}
  return {
    parseCsvToDataset: parseCsvToDatasetMock,
    CsvValidationError,
  };
});

vi.mock('@fullcalendar/core', () => {
  class CalendarStub implements CalendarStubInstance {
    public options: CalendarOptions;
    public eventSources: CalendarEvent[][] = [];
    public view: { type: string };

    constructor(_element: HTMLElement, options: CalendarOptions) {
      this.options = { ...options };
      this.view = { type: options.initialView ?? 'dayGridMonth' };
      calendarInstances.push(this);
    }

    render(): void {
      return;
    }

    destroy(): void {
      return;
    }

    removeAllEventSources(): void {
      this.eventSources = [];
    }

    addEventSource(events: CalendarEvent[]): void {
      this.eventSources.push(events);
    }

    setOption(name: string, value: unknown): void {
      if (name === 'headerToolbar') {
        this.options.headerToolbar = value as CalendarHeaderToolbar;
      } else if (name === 'stickyHeaderDates') {
        this.options.stickyHeaderDates = value as boolean;
      }
    }

    changeView(viewName: string): void {
      this.view = { type: viewName };
      this.options.datesSet?.();
    }
  }

  return { Calendar: CalendarStub };
});

const findSwapsForShiftMock = vi.hoisted(() => vi.fn());
const findBestSwapsMock = vi.hoisted(() => vi.fn());

vi.mock('@engine/swapEngine', () => ({
  findSwapsForShift: findSwapsForShiftMock,
  findBestSwaps: findBestSwapsMock,
}));

const CSV = `Shift ID,Resident,Resident ID,Start,End,Type,Location
S1,Alice Rivers,R1,2026-10-01T08:00:00Z,2026-10-01T20:00:00Z,MOSES,Main
S2,Bob Stone,R2,2026-10-02T08:00:00Z,2026-10-02T20:00:00Z,WEILER,Main
S3,Carol Evans,R3,2026-09-28T08:00:00Z,2026-09-28T20:00:00Z,IP CONSULT,Main
S4,Diana Flores,R4,2026-10-05T20:00:00Z,2026-10-06T08:00:00Z,NIGHT FLOAT,Main`;

const TARGET_SHIFT: Shift = {
  id: 'S1',
  residentId: 'R1',
  startISO: '2026-10-01T08:00:00Z',
  endISO: '2026-10-01T20:00:00Z',
  type: 'MOSES',
  location: 'Main',
};

const CANDIDATE_R2: Shift = {
  id: 'S2',
  residentId: 'R2',
  startISO: '2026-10-02T08:00:00Z',
  endISO: '2026-10-02T20:00:00Z',
  type: 'WEILER',
  location: 'Main',
};

const CANDIDATE_NIGHT_FLOAT: Shift = {
  id: 'S4',
  residentId: 'R4',
  startISO: '2026-10-05T20:00:00Z',
  endISO: '2026-10-06T08:00:00Z',
  type: 'NIGHT FLOAT',
  location: 'Main',
};

const CANDIDATE_IP_CONSULT: Shift = {
  id: 'S3',
  residentId: 'R3',
  startISO: '2026-10-03T08:00:00Z',
  endISO: '2026-10-03T20:00:00Z',
  type: 'IP CONSULT',
  location: 'Main',
};

const DATASET: Dataset = {
  residents: [
    {
      id: 'R1',
      name: 'Alice Rivers',
      eligibleShiftTypes: ['MOSES', 'WEILER', 'IP CONSULT', 'NIGHT FLOAT', 'BACKUP'],
      rotations: [],
      academicYears: [],
    },
    {
      id: 'R2',
      name: 'Bob Stone',
      eligibleShiftTypes: ['MOSES', 'WEILER', 'IP CONSULT', 'NIGHT FLOAT', 'BACKUP'],
      rotations: [],
      academicYears: [],
    },
    {
      id: 'R3',
      name: 'Carol Evans',
      eligibleShiftTypes: ['MOSES', 'WEILER', 'IP CONSULT', 'NIGHT FLOAT', 'BACKUP'],
      rotations: [],
      academicYears: [],
    },
    {
      id: 'R4',
      name: 'Diana Flores',
      eligibleShiftTypes: ['MOSES', 'WEILER', 'IP CONSULT', 'NIGHT FLOAT', 'BACKUP'],
      rotations: [],
      academicYears: [],
    },
  ],
  shifts: [TARGET_SHIFT, CANDIDATE_R2, CANDIDATE_IP_CONSULT, CANDIDATE_NIGHT_FLOAT],
};

const SCORE_SCALE = 100;

function clampPenalty(value: number): number {
  if (value > 0) {
    return 0;
  }
  if (value < -2) {
    return -2;
  }
  return value;
}

function resolveShiftMultiplier(shift: Shift): number {
  if (shift.type === 'BACKUP') {
    return 1;
  }

  const weekendOrHoliday = isWeekendOrHoliday(shift);
  const isNightFloat = shift.type === 'NIGHT FLOAT';
  if (!weekendOrHoliday && !isNightFloat) {
    return 1;
  }
  return weekendOrHoliday && isNightFloat ? 4 : 2;
}

function buildPressure(
  deltaScore: number,
  original: Shift,
  counterpart: Shift,
): SwapPressureBreakdown {
  const clampedDelta = Math.max(-1, Math.min(1, deltaScore));
  const originalDelta = clampedDelta / 2;
  const counterpartDelta = clampedDelta - originalDelta;

  const basePenalty = -1;

  const originalSwapped = clampPenalty(basePenalty + originalDelta);
  const counterpartSwapped = clampPenalty(basePenalty + counterpartDelta);

  const originalCalls = [
    {
      shiftId: `${original.id}-before`,
      shiftType: original.type,
      startISO: '2026-09-29T08:00:00Z',
      endISO: '2026-09-29T18:00:00Z',
      weight: 1,
      baseline: basePenalty,
      swapped: originalSwapped,
      delta: originalSwapped - basePenalty,
    },
  ];

  const counterpartCalls = [
    {
      shiftId: `${counterpart.id}-before`,
      shiftType: counterpart.type,
      startISO: '2026-10-04T08:00:00Z',
      endISO: '2026-10-04T18:00:00Z',
      weight: 1,
      baseline: basePenalty,
      swapped: counterpartSwapped,
      delta: counterpartSwapped - basePenalty,
    },
  ];

  const originalBaselineTotal = originalCalls.reduce((sum, call) => sum + call.baseline, 0);
  const originalSwappedTotal = originalCalls.reduce((sum, call) => sum + call.swapped, 0);
  const counterpartBaselineTotal = counterpartCalls.reduce((sum, call) => sum + call.baseline, 0);
  const counterpartSwappedTotal = counterpartCalls.reduce((sum, call) => sum + call.swapped, 0);

  const baselineScore = originalBaselineTotal + counterpartBaselineTotal;
  const swappedScore = originalSwappedTotal + counterpartSwappedTotal;
  const originalDeltaTotal = originalSwappedTotal - originalBaselineTotal;
  const counterpartDeltaTotal = counterpartSwappedTotal - counterpartBaselineTotal;

  const multiplier =
    SCORE_SCALE * resolveShiftMultiplier(original) * resolveShiftMultiplier(counterpart);

  const scaleCall = (call: (typeof originalCalls)[number]) => ({
    ...call,
    baseline: call.baseline * multiplier,
    swapped: call.swapped * multiplier,
    delta: call.delta * multiplier,
  });

  return {
    score: clampedDelta * multiplier,
    baselineScore: baselineScore * multiplier,
    swappedScore: swappedScore * multiplier,
    original: {
      residentId: original.residentId,
      focusShiftId: original.id,
      windowHours: 96,
      calls: originalCalls.map(scaleCall),
      baselineTotal: originalBaselineTotal * multiplier,
      swappedTotal: originalSwappedTotal * multiplier,
      deltaTotal: originalDeltaTotal * multiplier,
    },
    counterpart: {
      residentId: counterpart.residentId,
      focusShiftId: counterpart.id,
      windowHours: 96,
      calls: counterpartCalls.map(scaleCall),
      baselineTotal: counterpartBaselineTotal * multiplier,
      swappedTotal: counterpartSwappedTotal * multiplier,
      deltaTotal: counterpartDeltaTotal * multiplier,
    },
  };
}

function buildCandidates(scores: [Shift, number][]): SwapCandidate[] {
  return scores.map(([shift, rawScore]) => {
    const pressure = buildPressure(rawScore, TARGET_SHIFT, shift);
    return {
      a: TARGET_SHIFT,
      b: shift,
      score: pressure.score,
      pressure,
    };
  });
}

function createSwapCandidate(
  shift: Shift,
  myDelta: number,
  counterpartDelta: number,
  totalScore = myDelta + counterpartDelta,
): SwapCandidate {
  const originalSection: SwapPressureBreakdown['original'] = {
    residentId: TARGET_SHIFT.residentId,
    focusShiftId: TARGET_SHIFT.id,
    windowHours: 96,
    calls: [],
    baselineTotal: 0,
    swappedTotal: myDelta,
    deltaTotal: myDelta,
  };
  const counterpartSection: SwapPressureBreakdown['counterpart'] = {
    residentId: shift.residentId,
    focusShiftId: shift.id,
    windowHours: 96,
    calls: [],
    baselineTotal: 0,
    swappedTotal: counterpartDelta,
    deltaTotal: counterpartDelta,
  };
  const pressure: SwapPressureBreakdown = {
    score: totalScore,
    baselineScore: 0,
    swappedScore: totalScore,
    original: originalSection,
    counterpart: counterpartSection,
  };
  return {
    a: TARGET_SHIFT,
    b: shift,
    score: totalScore,
    pressure,
  };
}

const originalFetch = global.fetch;

let dateNowSpy: ReturnType<typeof vi.spyOn> | null = null;

describe('App side panel selection', () => {
  beforeEach(() => {
    dateNowSpy = vi.spyOn(Date, 'now').mockReturnValue(new Date('2026-09-30T12:00:00Z').getTime());
    calendarInstances.length = 0;
    (window as typeof window & { CSV_URL?: string }).CSV_URL = 'test://schedule.csv';
    const fetchMock = vi.fn(async () => ({
      ok: true,
      text: async () => CSV,
    })) as unknown as typeof fetch;
    global.fetch = fetchMock;
    findSwapsForShiftMock.mockReset();
    findBestSwapsMock.mockReset();
    parseCsvToDatasetMock.mockReset();
    parseCsvToDatasetMock.mockReturnValue(DATASET);
    document.cookie = 'swapSettings=; max-age=0; path=/';
  });

  afterEach(() => {
    cleanup();
    calendarInstances.length = 0;
    delete (window as typeof window & { CSV_URL?: string }).CSV_URL;
    if (originalFetch) {
      global.fetch = originalFetch;
    } else {
      // @ts-expect-error Allow clearing fetch when not available
      delete global.fetch;
    }
    vi.restoreAllMocks();
    if (dateNowSpy) {
      dateNowSpy.mockRestore();
      dateNowSpy = null;
    }
    window.history.replaceState(window.history.state, '', '/');
    document.cookie = 'swapSettings=; max-age=0; path=/';
  });

  it('opens the side panel with the selected shift details after an event click', async () => {
    render(<App />);

    await waitFor(() => {
      expect(calendarInstances[0]?.eventSources[0]?.length).toBeGreaterThan(0);
    });

    expect(screen.queryByText('S1')).toBeNull();

    const calendar = calendarInstances[0];
    expect(calendar).toBeDefined();
    expect(calendar?.options.eventClick).toBeTypeOf('function');

    act(() => {
      calendar?.options.eventClick?.({ event: { id: 'S1' } });
    });

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Alice Rivers' })).toBeTruthy();
    });

    const sidePanel = screen.getByLabelText('Selected shift details');
    expect(within(sidePanel).getByText(/Oct\s+1,\s+2026/)).toBeTruthy();
    expect(within(sidePanel).getByText(/Type/i)).toBeTruthy();
    expect(within(sidePanel).getByText('Main')).toBeTruthy();
    expect(within(sidePanel).queryByText('Shift')).toBeNull();

    const closeButton = screen.getByRole('button', { name: /close shift details/i });
    fireEvent.click(closeButton);

    await waitFor(() => {
      expect(screen.queryByText('S1')).toBeNull();
    });
  });

  it('clears the selection when the resident filter hides the shift', async () => {
    render(<App />);

    await waitFor(() => {
      expect(calendarInstances[0]?.eventSources[0]?.length).toBeGreaterThan(0);
    });

    const calendar = calendarInstances[0];
    expect(calendar).toBeDefined();

    act(() => {
      calendar?.options.eventClick?.({ event: { id: 'S1' } });
    });

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Alice Rivers' })).toBeTruthy();
    });

    const filter = screen.getByLabelText('Filter by resident');
    fireEvent.change(filter, { target: { value: 'R2' } });

    await waitFor(() => {
      expect(screen.queryByRole('heading', { name: 'Alice Rivers' })).toBeNull();
    });
  });

  /** @req: F-006 */
  it('lists swap candidates when requesting swaps for a shift', async () => {
    findSwapsForShiftMock.mockImplementation(async () =>
      buildCandidates([
        [CANDIDATE_R2, 0.62],
        [CANDIDATE_NIGHT_FLOAT, 0.87],
      ]),
    );

    render(<App />);

    await waitFor(() => {
      expect(calendarInstances[0]?.eventSources[0]?.length).toBeGreaterThan(0);
    });

    const residentSelect = screen.getByLabelText('Filter by resident');
    fireEvent.change(residentSelect, { target: { value: '' } });

    const calendar = calendarInstances[0];
    act(() => {
      calendar?.options.eventClick?.({ event: { id: 'S1' } });
    });

    await screen.findByRole('heading', { name: 'Alice Rivers' });
    const swapSection = await screen.findByRole('region', { name: /swap finder/i });
    const action = within(swapSection).getByRole('button', { name: /find swaps/i });
    fireEvent.click(action);

    await waitFor(() => {
      expect(findSwapsForShiftMock).toHaveBeenCalledTimes(1);
    });

    const list = await within(swapSection).findByRole('list', { name: /swap suggestions/i });
    const items = within(list).getAllByRole('listitem');
    expect(items).toHaveLength(2);
    const firstRowButton = within(items[0]!).getByRole('button');
    const detailsId = firstRowButton.getAttribute('aria-controls');
    expect(detailsId).toBeTruthy();
    expect(firstRowButton.getAttribute('aria-expanded')).toBe('false');
    expect(firstRowButton.textContent ?? '').toContain('Diana Flores');
    expect(firstRowButton.textContent ?? '').toContain('+174.00');
    fireEvent.click(firstRowButton);

    await waitFor(() => {
      expect(within(items[0]!).getByText('Night Float')).toBeTruthy();
      expect(within(items[0]!).getAllByText('Total')[0]).toBeTruthy();
    });

    expect(firstRowButton.getAttribute('aria-expanded')).toBe('true');
    if (detailsId) {
      const detailsGroup = within(items[0]!).getByRole('group', { name: /swap details for/i });
      expect(detailsGroup.getAttribute('id')).toBe(detailsId);
    }

    const beforeTerms = within(items[0]!).getAllByText('Before');
    const afterTerms = within(items[0]!).getAllByText('After');
    expect(beforeTerms).toHaveLength(2);
    expect(afterTerms).toHaveLength(2);

    const secondRowButton = within(items[1]!).getByRole('button');
    expect(secondRowButton.textContent ?? '').toContain('Bob Stone');
  });

  /** @req: F-008 */
  it('supports sorting the swap candidate list', async () => {
    findSwapsForShiftMock.mockImplementation(async () =>
      buildCandidates([
        [CANDIDATE_R2, 0.62],
        [CANDIDATE_NIGHT_FLOAT, 0.87],
        [CANDIDATE_IP_CONSULT, 0.62],
      ]),
    );

    render(<App />);

    await waitFor(() => {
      expect(calendarInstances[0]?.eventSources[0]?.length).toBeGreaterThan(0);
    });

    const residentSelect = screen.getByLabelText('Filter by resident');
    fireEvent.change(residentSelect, { target: { value: '' } });

    const calendar = calendarInstances[0];
    act(() => {
      calendar?.options.eventClick?.({ event: { id: 'S1' } });
    });

    await screen.findByRole('heading', { name: 'Alice Rivers' });
    const swapSection = await screen.findByRole('region', { name: /swap finder/i });
    const action = within(swapSection).getByRole('button', { name: /find swaps/i });
    fireEvent.click(action);

    await within(swapSection).findByRole('list', { name: /swap suggestions/i });
    const queryItems = () => within(swapSection).queryAllByRole('listitem');

    const getRowButtonTexts = () =>
      queryItems().map((item) => within(item).getByRole('button').textContent ?? '');

    // Score descending by default, with date tiebreaker ascending
    await waitFor(() => {
      const [first, second, third] = getRowButtonTexts();
      expect(first).toContain('Diana Flores');
      expect(second).toContain('Carol Evans');
      expect(third).toContain('Bob Stone');
      expect(first).toContain('|');
    });

    const sortSelect = within(swapSection).getByLabelText('Sort by');
    expect(within(sortSelect).getByRole('option', { name: 'My Score' })).toBeTruthy();
    fireEvent.change(sortSelect, { target: { value: 'date' } });

    await waitFor(() => {
      const directionButton = within(swapSection).getByRole('button', { name: 'Order' });
      expect(directionButton.textContent ?? '').toBe('Soonest → Latest');
      const texts = getRowButtonTexts();
      expect(texts[0]).toContain('Bob Stone');
      expect(texts[1]).toContain('Carol Evans');
      expect(texts[2]).toContain('Diana Flores');
    });

    const orderButton = within(swapSection).getByRole('button', { name: 'Order' });
    fireEvent.click(orderButton);

    await waitFor(() => {
      expect(orderButton.textContent ?? '').toBe('Latest → Soonest');
      const [first] = getRowButtonTexts();
      expect(first).toContain('Diana Flores');
    });

    fireEvent.change(sortSelect, { target: { value: 'score' } });

    await waitFor(() => {
      expect(orderButton.textContent ?? '').toBe('High → Low');
      const texts = getRowButtonTexts();
      expect(texts[0]).toContain('Diana Flores');
      expect(texts[1]).toContain('Carol Evans');
      expect(texts[2]).toContain('Bob Stone');
    });

    fireEvent.change(sortSelect, { target: { value: 'myScore' } });

    await waitFor(() => {
      expect(orderButton.textContent ?? '').toBe('High → Low');
      const texts = getRowButtonTexts();
      expect(texts[0]).toContain('Diana Flores');
    });

    fireEvent.click(orderButton);

    await waitFor(() => {
      expect(orderButton.textContent ?? '').toBe('Low → High');
      const texts = getRowButtonTexts();
      expect(texts[0]).toContain('Bob Stone');
    });
  });

  /** @req: F-009 */
  it('runs the best swaps search and renders ranked results', async () => {
    const firstPressure = buildPressure(0.93, TARGET_SHIFT, CANDIDATE_R2);
    const secondPressure = buildPressure(0.74, TARGET_SHIFT, CANDIDATE_IP_CONSULT);

    findBestSwapsMock.mockResolvedValue([
      {
        a: TARGET_SHIFT,
        b: CANDIDATE_R2,
        score: firstPressure.score,
        pressure: firstPressure,
        reasons: ['Balances Moses coverage', 'Improves rest window for Alice'],
      },
      {
        a: TARGET_SHIFT,
        b: CANDIDATE_IP_CONSULT,
        score: secondPressure.score,
        pressure: secondPressure,
      },
    ]);

    render(<App />);

    await waitFor(() => {
      expect(calendarInstances[0]?.eventSources[0]?.length).toBeGreaterThan(0);
    });

    const residentSelect = screen.getByLabelText('Filter by resident');
    fireEvent.change(residentSelect, { target: { value: 'R1' } });

    const bestSwapsButton = await screen.findByRole('button', { name: /find best swaps/i });
    await waitFor(() => {
      expect(bestSwapsButton.hasAttribute('disabled')).toBe(false);
    });

    fireEvent.click(bestSwapsButton);

    await waitFor(() => {
      expect(findBestSwapsMock).toHaveBeenCalledTimes(1);
    });

    const list = await screen.findByRole('list', { name: /top swap suggestions/i });
    const items = within(list)
      .getAllByRole('listitem')
      .filter((item) => item.parentElement === list);
    expect(items).toHaveLength(2);
    expect(items[0]!.textContent).toContain('Oct');
    expect(items[0]!.textContent).toContain('Bob Stone');
    expect(items[0]!.textContent).toContain('+93.00');

    const firstRowButton = items[0]!.querySelector('button');
    expect(firstRowButton).toBeTruthy();
    fireEvent.click(firstRowButton!);

    await waitFor(() => {
      expect(within(items[0]!).getByText(/Pressure on Alice Rivers/)).toBeTruthy();
      expect(within(items[0]!).getByText(/Pressure on Bob Stone/)).toBeTruthy();
      expect(within(items[0]!).getAllByText('Total')[0]).toBeTruthy();
    });

    const beforeTerms = within(items[0]!).getAllByText('Before');
    const afterTerms = within(items[0]!).getAllByText('After');
    expect(beforeTerms).toHaveLength(2);
    expect(afterTerms).toHaveLength(2);
  });

  it('respects saved swap settings cookie in the all swaps panel', async () => {
    const savedSettings = {
      defaultSortKey: 'average',
      defaultSortDirection: 'asc',
      hideNegativeResident: false,
      hideNegativeTotal: false,
    } as const;
    document.cookie = `swapSettings=${encodeURIComponent(JSON.stringify(savedSettings))}`;

    findBestSwapsMock.mockResolvedValue([
      createSwapCandidate(CANDIDATE_R2, 4, 2),
      createSwapCandidate(CANDIDATE_IP_CONSULT, 8, 4),
      createSwapCandidate(CANDIDATE_NIGHT_FLOAT, 10, 8),
    ]);

    render(<App />);

    await waitFor(() => {
      expect(calendarInstances[0]?.eventSources[0]?.length).toBeGreaterThan(0);
    });

    const residentSelect = screen.getByLabelText('Filter by resident');
    fireEvent.change(residentSelect, { target: { value: 'R1' } });

    const bestSwapsButton = await screen.findByRole('button', { name: /find best swaps/i });
    await waitFor(() => {
      expect(bestSwapsButton.hasAttribute('disabled')).toBe(false);
    });
    fireEvent.click(bestSwapsButton);

    await waitFor(() => {
      expect(findBestSwapsMock).toHaveBeenCalledTimes(1);
    });

    const list = await screen.findByRole('list', { name: 'All swap combinations' });
    await waitFor(() => {
      expect(within(list).getAllByRole('button', { name: /Avg/ })).toHaveLength(3);
    });

    const rows = within(list).getAllByRole('button', { name: /Avg/ });
    const averages = rows.map((row) => {
      const text = row.textContent ?? '';
      const match = /Avg\s([+\-0-9.]+)/u.exec(text);
      return match?.[1] ?? '';
    });
    expect(averages).toEqual(['+3.00', '+6.00', '+9.00']);

    const settingsToggle = screen.getByRole('button', { name: 'Settings' });
    fireEvent.click(settingsToggle);

    const sortSelect = screen.getByLabelText<HTMLSelectElement>('Default sort');
    expect(sortSelect.value).toBe('average');

    const orderButton = screen.getByRole('button', { name: 'Default order' });
    expect(orderButton.textContent ?? '').toContain('Low → High');

    const hideResidentCheckbox = screen.getByLabelText<HTMLInputElement>(
      'Hide swaps when any resident score is negative',
    );
    const hideTotalCheckbox = screen.getByLabelText<HTMLInputElement>(
      'Hide swaps when the combined score is negative',
    );

    expect(hideResidentCheckbox.checked).toBe(false);
    expect(hideTotalCheckbox.checked).toBe(false);
  });

  it('reveals filtered swaps and persists updated all swaps settings', async () => {
    findBestSwapsMock.mockResolvedValue([
      createSwapCandidate(CANDIDATE_R2, 6, 6),
      createSwapCandidate(CANDIDATE_IP_CONSULT, -4, 9, 5),
    ]);

    render(<App />);

    await waitFor(() => {
      expect(calendarInstances[0]?.eventSources[0]?.length).toBeGreaterThan(0);
    });

    const residentSelect = screen.getByLabelText('Filter by resident');
    fireEvent.change(residentSelect, { target: { value: 'R1' } });

    const bestSwapsButton = await screen.findByRole('button', { name: /find best swaps/i });
    await waitFor(() => {
      expect(bestSwapsButton.hasAttribute('disabled')).toBe(false);
    });
    fireEvent.click(bestSwapsButton);

    await waitFor(() => {
      expect(findBestSwapsMock).toHaveBeenCalledTimes(1);
    });

    const list = await screen.findByRole('list', { name: 'All swap combinations' });
    const hiddenMessage = await screen.findByText(/swap is hidden by the current filters/i);
    expect(hiddenMessage.textContent ?? '').toContain('1 swap is hidden');

    expect(within(list).getAllByRole('button', { name: /Avg/ })).toHaveLength(1);

    const settingsToggle = screen.getByRole('button', { name: 'Settings' });
    fireEvent.click(settingsToggle);

    const hideResidentCheckbox = screen.getByLabelText<HTMLInputElement>(
      'Hide swaps when any resident score is negative',
    );
    fireEvent.click(hideResidentCheckbox);

    await waitFor(() => {
      expect(screen.queryByText(/hidden by the current filters/i)).toBeNull();
    });

    await waitFor(() => {
      expect(within(list).getAllByRole('button', { name: /Avg/ })).toHaveLength(2);
    });

    await waitFor(() => {
      const cookieEntry = document.cookie
        .split('; ')
        .find((entry) => entry.startsWith('swapSettings='));
      expect(cookieEntry).toBeTruthy();
      const cookieValue = cookieEntry?.slice('swapSettings='.length) ?? '';
      const parsed = JSON.parse(decodeURIComponent(cookieValue));
      expect(parsed.hideNegativeResident).toBe(false);
      expect(parsed.hideNegativeTotal).toBe(true);
    });
  });
});
