/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import React from 'react';
import MonthGrid from '../../src/components/MonthGrid';
import type { RotationAssignment, Shift } from '../../src/domain/types';

function makeShift(id: string, startISO: string, type: Shift['type'] = 'MOSES'): Shift {
  return { id, residentId: 'r1', startISO, endISO: startISO, type };
}

function makeRotation(rotation: string): RotationAssignment {
  return {
    rotation,
    rawRotation: rotation,
    weekStartISO: '2026-12-14T00:00:00-05:00',
    vacationDates: [],
  };
}

const MOSES_DEC_18 = makeShift('S-moses', '2026-12-18T08:00:00-05:00');

function setup(overrides: Partial<React.ComponentProps<typeof MonthGrid>> = {}) {
  const onSelectShift = vi.fn();
  const utils = render(
    <MonthGrid
      shifts={[MOSES_DEC_18]}
      selectedShiftId={null}
      onSelectShift={onSelectShift}
      rotationByWeek={new Map()}
      today="2026-12-18"
      initialMonth="2026-12-01"
      {...overrides}
    />,
  );
  return { ...utils, onSelectShift };
}

afterEach(() => cleanup());

describe('MonthGrid', () => {
  it('renders the month title and a shift pill that selects on click', () => {
    const { onSelectShift } = setup();

    expect(screen.getByText('December 2026')).toBeTruthy();
    const pill = screen.getByRole('button', { name: /Moses shift on Dec 18, 2026/i });
    fireEvent.click(pill);
    expect(onSelectShift).toHaveBeenCalledWith('S-moses');
  });

  it('marks today and the selected shift cell', () => {
    const { container } = setup({ selectedShiftId: 'S-moses' });

    const cell = container.querySelector('[data-date="2026-12-18"]');
    expect(cell).toBeTruthy();
    expect(within(cell as HTMLElement).getByText('Today')).toBeTruthy();
    expect(cell?.classList.contains('month-cell--selected')).toBe(true);
    expect(cell?.getAttribute('aria-selected')).toBe('true');
  });

  it('dims days outside the visible month', () => {
    const { container } = setup();
    // Nov 30 is a leading day in the December grid.
    const leading = container.querySelector('[data-date="2026-11-30"]');
    expect(leading?.classList.contains('month-cell--out-of-month')).toBe(true);
  });

  it('hides the rotation column when no resident is set', () => {
    setup();
    expect(screen.queryByText('Rotation')).toBeNull();
  });

  it('shows the rotation column with the current-week highlight when a resident is set', () => {
    setup({
      residentName: 'Goldberg',
      rotationByWeek: new Map([['2026-12-14', makeRotation('Body / CT')]]),
    });

    expect(screen.getByText('Rotation')).toBeTruthy();
    expect(screen.getByText('Goldberg')).toBeTruthy();
    const rotationCell = screen.getByText('Body / CT');
    expect(rotationCell.classList.contains('month-rotation--current')).toBe(true);
  });

  it('navigates between months and back to today', () => {
    setup();
    fireEvent.click(screen.getByRole('button', { name: 'Next month' }));
    expect(screen.getByText('January 2027')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Previous month' }));
    fireEvent.click(screen.getByRole('button', { name: 'Previous month' }));
    expect(screen.getByText('November 2026')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Today' }));
    expect(screen.getByText('December 2026')).toBeTruthy();
  });
});
