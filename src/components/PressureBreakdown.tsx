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
  residentFocus?: 'all' | string;
}>;

type PreparedSection = {
  kind: 'original' | 'counterpart';
  label: string;
  calls: PreparedCall[];
  deltaTotal: number;
  deltaFormatted: string;
  deltaSign: 'positive' | 'negative' | 'neutral';
  totalDisplay: string;
  residentId: string;
  accessibleTotalLabel: string;
};

type PreparedCall = {
  id: string;
  label: string;
  score: string;
  deltaSign: 'positive' | 'negative' | 'neutral';
};

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
  residentFocus = 'all',
}: PressureBreakdownProps): JSX.Element {
  const sections = useMemo(() => {
    const totalFormatted = formatContributionWithFormatter(deltaFormatter, pressure.score);

    const createSection = (
      section: SwapPressureSection,
      label: string,
      kind: 'original' | 'counterpart',
    ): PreparedSection => {
      const sortedCalls = [...section.calls].sort((left, right) => right.delta - left.delta);

      const calls: PreparedCall[] = sortedCalls.map((call) => ({
        id: call.shiftId,
        label: formatCallLabel(call),
        score: formatContributionWithFormatter(deltaFormatter, call.delta),
        deltaSign: resolveSign(call.delta),
      }));

      const deltaFormatted = formatContributionWithFormatter(deltaFormatter, section.deltaTotal);
      const accessibleTotalLabel = `Resident delta ${deltaFormatted}, combined total ${totalFormatted}`;

      return {
        kind,
        label,
        calls,
        deltaTotal: section.deltaTotal,
        deltaFormatted,
        deltaSign: resolveSign(section.deltaTotal),
        totalDisplay: `${deltaFormatted}|${totalFormatted}`,
        residentId: section.residentId,
        accessibleTotalLabel,
      };
    };

    return [
      createSection(pressure.original, originalLabel, 'original'),
      createSection(pressure.counterpart, counterpartLabel, 'counterpart'),
    ];
  }, [pressure, originalLabel, counterpartLabel, deltaFormatter]);

  const focusResidentId = residentFocus === 'all' ? null : residentFocus;

  const visibleSections = useMemo(() => {
    if (!focusResidentId) {
      return sections;
    }
    const filtered = sections.filter((section) => section.residentId === focusResidentId);
    return filtered.length > 0 ? filtered : sections;
  }, [sections, focusResidentId]);

  const rootClassName = ['pressure-breakdown', className].filter(Boolean).join(' ');

  return (
    <div className={rootClassName}>
      {visibleSections.map((section) => {
        const captionId = `pressure-breakdown-${section.kind}`;
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
