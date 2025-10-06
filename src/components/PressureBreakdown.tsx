import React, { useMemo } from 'react';
import type { JSX } from 'react';
import dayjs from '@utils/dayjs';
import { SwapPressureBreakdown, SwapPressureCall, SwapPressureSection } from '@domain/types';

type PressureBreakdownProps = Readonly<{
  pressure: SwapPressureBreakdown;
  originalLabel: string;
  counterpartLabel: string;
  valueFormatter: Intl.NumberFormat;
  deltaFormatter: Intl.NumberFormat;
  className?: string;
}>;

type PreparedSection = {
  label: string;
  calls: PreparedCall[];
  deltaTotal: number;
  deltaFormatted: string;
  deltaSign: 'positive' | 'negative' | 'neutral';
  totalDisplay: string;
  isFiltered: boolean;
  accessibleTotalLabel: string;
};

type PreparedCall = {
  id: string;
  label: string;
  score: string;
  deltaSign: 'positive' | 'negative' | 'neutral';
};

function prepareSection(
  section: SwapPressureSection,
  label: string,
  deltaFormatter: Intl.NumberFormat,
  totalFormatted: string,
  filteredResidentId: string,
  filteredTotalFormatted: string,
): PreparedSection {
  const sortedCalls = [...section.calls].sort((left, right) => right.delta - left.delta);

  const calls: PreparedCall[] = sortedCalls.map((call) => ({
    id: call.shiftId,
    label: formatCallLabel(call),
    score: formatContributionWithFormatter(deltaFormatter, call.delta),
    deltaSign: resolveSign(call.delta),
  }));

  const deltaTotal = section.deltaTotal;

  const deltaFormatted = formatContributionWithFormatter(deltaFormatter, deltaTotal);
  const isFiltered = section.residentId === filteredResidentId;
  const totalDisplay = isFiltered
    ? `${filteredTotalFormatted}|${totalFormatted}`
    : `${deltaFormatted}|${totalFormatted}`;
  const accessibleTotalLabel = isFiltered
    ? `Resident delta ${filteredTotalFormatted}, combined total ${totalFormatted}`
    : `Resident delta ${deltaFormatted}, combined total ${totalFormatted}`;

  return {
    label,
    calls,
    deltaTotal,
    deltaFormatted,
    deltaSign: resolveSign(deltaTotal),
    totalDisplay,
    isFiltered,
    accessibleTotalLabel,
  };
}

function resolveSign(value: number): 'positive' | 'negative' | 'neutral' {
  if (value > 0) {
    return 'positive';
  }
  if (value < 0) {
    return 'negative';
  }
  return 'neutral';
}

function formatContributionWithFormatter(formatter: Intl.NumberFormat, value: number): string {
  const formatted = formatter.format(value);
  if (value > 0 && !formatted.startsWith('+')) {
    return `+${formatted}`;
  }
  return formatted;
}

function formatCallLabel(call: SwapPressureCall): string {
  if (call.shiftId.startsWith('bonus:rotation:')) {
    const start = dayjs(call.startISO);
    const rotationLabel = call.rotationLabel ?? 'Priority rotation';
    return `${start.format('MMM D')} • Rotation pressure (${rotationLabel})`;
  }
  if (call.shiftId.startsWith('penalty:ip-consult:')) {
    return 'IP consult mismatch penalty';
  }

  const start = dayjs(call.startISO);
  let typeLabel = formatShiftType(call.shiftType);
  if (call.calendarContext && (call.shiftType === 'MOSES' || call.shiftType === 'WEILER')) {
    typeLabel = `${typeLabel} ${call.calendarContext === 'holiday' ? 'Holiday' : 'Weekend'}`;
  }
  return `${start.format('MMM D')} • ${typeLabel}`;
}

const SHIFT_TYPE_LABELS: Record<string, string> = {
  MOSES: 'Moses',
  WEILER: 'Weiler',
  'IP CONSULT': 'IP Consult',
  'NIGHT FLOAT': 'Night Float',
  BACKUP: 'Backup',
};

function formatShiftType(type: string): string {
  return SHIFT_TYPE_LABELS[type] ?? type;
}

export default function PressureBreakdown({
  pressure,
  originalLabel,
  counterpartLabel,
  valueFormatter: _valueFormatter,
  deltaFormatter,
  className,
}: PressureBreakdownProps): JSX.Element {
  const sections = useMemo(() => {
    const totalFormatted = formatContributionWithFormatter(deltaFormatter, pressure.score);
    const filteredResidentId = pressure.original.residentId;
    const filteredTotalFormatted = formatContributionWithFormatter(
      deltaFormatter,
      pressure.original.deltaTotal,
    );
    const original = prepareSection(
      pressure.original,
      originalLabel,
      deltaFormatter,
      totalFormatted,
      filteredResidentId,
      filteredTotalFormatted,
    );
    const counterpart = prepareSection(
      pressure.counterpart,
      counterpartLabel,
      deltaFormatter,
      totalFormatted,
      filteredResidentId,
      filteredTotalFormatted,
    );
    return [original, counterpart];
  }, [pressure, originalLabel, counterpartLabel, deltaFormatter]);

  const rootClassName = ['pressure-breakdown', className].filter(Boolean).join(' ');

  return (
    <div className={rootClassName}>
      {sections.map((section, index) => {
        const captionId = `pressure-breakdown-${index}`;
        return (
          <section key={section.label} className="pressure-breakdown__section">
            <h4>Pressure on {section.label}</h4>
            {section.calls.length === 0 ? (
              <p className="pressure-breakdown__empty">No other calls near this shift.</p>
            ) : (
              <table className="pressure-breakdown__table" aria-labelledby={captionId}>
                <caption id={captionId} className="legend-visually-hidden">
                  Pressure contributions for {section.label}
                </caption>
                <thead>
                  <tr>
                    <th scope="col">Call</th>
                    <th scope="col">Score</th>
                  </tr>
                </thead>
                <tbody>
                  {section.calls.map((call) => (
                    <tr
                      key={call.id}
                      className={`pressure-breakdown__row pressure-breakdown__row--${call.deltaSign}`}
                    >
                      <th scope="row">{call.label}</th>
                      <td>{call.score}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr
                    className={`pressure-breakdown__row pressure-breakdown__row--${section.deltaSign}`}
                  >
                    <th scope="row">Total</th>
                    <td aria-label={section.accessibleTotalLabel}>
                      <span aria-hidden="true">{section.totalDisplay}</span>
                      <span className="legend-visually-hidden">{section.accessibleTotalLabel}</span>
                    </td>
                  </tr>
                </tfoot>
              </table>
            )}
          </section>
        );
      })}
    </div>
  );
}
