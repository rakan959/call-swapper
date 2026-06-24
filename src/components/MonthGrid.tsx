import React, { useCallback, useMemo, useState } from 'react';
import type { JSX } from 'react';
import dayjs from '@utils/dayjs';
import type { RotationAssignment, Shift } from '@domain/types';
import { SHIFT_PALETTE } from './Legend';
import {
  buildMonthMatrix,
  CALENDAR_DATE_FORMAT,
  groupShiftsByDay,
  rotationWeekKey,
} from '@utils/monthGrid';

const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

/** Maximum shift pills rendered per day before collapsing into a "+N more" note. */
const MAX_PILLS_PER_DAY = 3;

type MonthGridProps = Readonly<{
  shifts: readonly Shift[];
  selectedShiftId: string | null;
  onSelectShift: (shiftId: string) => void;
  /** Rotation assignments keyed by the Monday `YYYY-MM-DD` of each week. */
  rotationByWeek: Map<string, RotationAssignment>;
  /** When set, the rotation column is shown with this resident's name. */
  residentName?: string | null;
  /** `YYYY-MM-DD` treated as "today" (defaults to now in the configured timezone). */
  today?: string;
  /** `YYYY-MM-DD` of the month to show first (defaults to the month of `today`). */
  initialMonth?: string;
}>;

function resolveToday(today: string | undefined): string {
  // Derive "now" via Date.now() (not new Date()) so it tracks the real clock in
  // production while remaining mockable in tests.
  return today ?? dayjs(Date.now()).tz().format(CALENDAR_DATE_FORMAT);
}

function monthStartOf(dateKey: string): string {
  return dayjs.utc(dateKey).startOf('month').format(CALENDAR_DATE_FORMAT);
}

function dayOfMonth(dateKey: string): number {
  return Number.parseInt(dateKey.slice(8, 10), 10);
}

function longDate(dateKey: string): string {
  return dayjs.utc(dateKey).format('MMM D, YYYY');
}

export default function MonthGrid({
  shifts,
  selectedShiftId,
  onSelectShift,
  rotationByWeek,
  residentName = null,
  today,
  initialMonth,
}: MonthGridProps): JSX.Element {
  const todayKey = useMemo(() => resolveToday(today), [today]);
  const [viewMonth, setViewMonth] = useState<string>(
    () => initialMonth ?? monthStartOf(todayKey),
  );

  const weeks = useMemo(() => buildMonthMatrix(viewMonth), [viewMonth]);
  const shiftsByDay = useMemo(() => groupShiftsByDay(shifts), [shifts]);
  const monthPrefix = viewMonth.slice(0, 7);
  const title = useMemo(() => dayjs.utc(viewMonth).format('MMMM YYYY'), [viewMonth]);
  const showRotation = Boolean(residentName);

  const goToPreviousMonth = useCallback(() => {
    setViewMonth((current) =>
      dayjs.utc(current).subtract(1, 'month').startOf('month').format(CALENDAR_DATE_FORMAT),
    );
  }, []);

  const goToNextMonth = useCallback(() => {
    setViewMonth((current) =>
      dayjs.utc(current).add(1, 'month').startOf('month').format(CALENDAR_DATE_FORMAT),
    );
  }, []);

  const goToToday = useCallback(() => {
    setViewMonth(monthStartOf(todayKey));
  }, [todayKey]);

  return (
    <div className="month-grid" role="grid" aria-label={`Call schedule for ${title}`}>
      <div className="month-grid__nav">
        <h2 className="month-grid__title">{title}</h2>
        <div className="month-grid__nav-buttons">
          <button type="button" className="month-grid__nav-today" onClick={goToToday}>
            Today
          </button>
          <button
            type="button"
            className="month-grid__nav-arrow"
            aria-label="Previous month"
            onClick={goToPreviousMonth}
          >
            ‹
          </button>
          <button
            type="button"
            className="month-grid__nav-arrow"
            aria-label="Next month"
            onClick={goToNextMonth}
          >
            ›
          </button>
        </div>
      </div>

      <div
        className={`month-grid__head${showRotation ? ' month-grid__head--with-rotation' : ''}`}
        role="row"
      >
        {showRotation && (
          <span className="month-grid__rotation-head" role="columnheader">
            <span className="month-grid__rotation-head-label">Rotation</span>
            <span className="month-grid__rotation-head-name">{residentName}</span>
          </span>
        )}
        {WEEKDAY_LABELS.map((label) => (
          <span key={label} className="month-grid__weekday" role="columnheader">
            {label}
          </span>
        ))}
      </div>

      <div className="month-grid__body">
        {weeks.map((week, weekIndex) => {
          const rotationKey = rotationWeekKey(week);
          const rotation = rotationKey ? rotationByWeek.get(rotationKey) : undefined;
          const isCurrentWeek = week.includes(todayKey);

          return (
            <div
              key={week[0] ?? `week-${weekIndex}`}
              className={`month-grid__week${showRotation ? ' month-grid__week--with-rotation' : ''}`}
              role="row"
            >
              {showRotation && (
                <RotationCell rotation={rotation} isCurrentWeek={isCurrentWeek} />
              )}
              {week.map((dateKey) => (
                <DayCell
                  key={dateKey}
                  dateKey={dateKey}
                  inMonth={dateKey.slice(0, 7) === monthPrefix}
                  isToday={dateKey === todayKey}
                  dayShifts={shiftsByDay.get(dateKey) ?? []}
                  selectedShiftId={selectedShiftId}
                  onSelectShift={onSelectShift}
                />
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}

type RotationCellProps = Readonly<{
  rotation: RotationAssignment | undefined;
  isCurrentWeek: boolean;
}>;

function RotationCell({ rotation, isCurrentWeek }: RotationCellProps): JSX.Element {
  const classNames = ['month-rotation'];
  if (!rotation) {
    classNames.push('month-rotation--empty');
  }
  if (isCurrentWeek) {
    classNames.push('month-rotation--current');
  }
  const title =
    rotation && rotation.rawRotation && rotation.rawRotation !== rotation.rotation
      ? rotation.rawRotation
      : undefined;
  return (
    <span className={classNames.join(' ')} role="gridcell" title={title}>
      {rotation ? rotation.rotation : '—'}
    </span>
  );
}

type DayCellProps = Readonly<{
  dateKey: string;
  inMonth: boolean;
  isToday: boolean;
  dayShifts: Shift[];
  selectedShiftId: string | null;
  onSelectShift: (shiftId: string) => void;
}>;

function DayCell({
  dateKey,
  inMonth,
  isToday,
  dayShifts,
  selectedShiftId,
  onSelectShift,
}: DayCellProps): JSX.Element {
  const containsSelected = dayShifts.some((shift) => shift.id === selectedShiftId);
  const visibleShifts = dayShifts.slice(0, MAX_PILLS_PER_DAY);
  const overflowCount = dayShifts.length - visibleShifts.length;

  const classNames = ['month-cell'];
  if (!inMonth) {
    classNames.push('month-cell--out-of-month');
  }
  if (isToday) {
    classNames.push('month-cell--today');
  }
  if (containsSelected) {
    classNames.push('month-cell--selected');
  }

  return (
    <div
      className={classNames.join(' ')}
      role="gridcell"
      aria-selected={containsSelected}
      data-date={dateKey}
    >
      <div className="month-cell__top">
        <span className="month-cell__daynum">{dayOfMonth(dateKey)}</span>
        {isToday && <span className="month-cell__today">Today</span>}
      </div>
      <div className="month-cell__events">
        {visibleShifts.map((shift) => {
          const palette = SHIFT_PALETTE[shift.type];
          const isSelected = shift.id === selectedShiftId;
          return (
            <button
              key={shift.id}
              type="button"
              className={`month-pill${isSelected ? ' month-pill--selected' : ''}`}
              style={{ backgroundColor: palette.background, color: palette.text }}
              aria-pressed={isSelected}
              aria-label={`${palette.label} shift on ${longDate(dateKey)} — select to find swaps`}
              onClick={() => onSelectShift(shift.id)}
            >
              {palette.label}
            </button>
          );
        })}
        {overflowCount > 0 && (
          <span className="month-cell__overflow">+{overflowCount} more</span>
        )}
      </div>
    </div>
  );
}
