/**
 * @vitest-environment jsdom
 * @req: F-003
 * @req: N-003
 */
import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import Legend, {
  MINIMUM_LEGEND_CONTRAST,
  SHIFT_PALETTE,
  calculateContrastRatio,
} from '../../src/components/Legend';
import { SHIFT_TYPES } from '../../src/domain/types';

describe('Legend component', () => {
  it('renders an accessible list of shift type entries', () => {
    render(<Legend />);

    const legend = screen.getByLabelText('Shift type legend');
    expect(legend).toBeTruthy();

    const describedById = legend.getAttribute('aria-describedby');
    expect(describedById).toBeTruthy();
    if (describedById) {
      const descriptionElement = document.getElementById(describedById);
      expect(descriptionElement?.textContent).toMatch(/pairs a color/i);
    }

    const list = within(legend).getByRole('list');
    const items = within(list).getAllByRole('listitem');
    expect(items).toHaveLength(SHIFT_TYPES.length);

    SHIFT_TYPES.forEach((type) => {
      const entry = SHIFT_PALETTE[type];
      expect(within(legend).getByText(entry.label)).toBeTruthy();
      expect(within(legend).getByText(new RegExp(entry.description, 'i'))).toBeTruthy();
    });
  });

  it('exposes contrast ratios at or above AA thresholds for each shift type', () => {
    const entries = SHIFT_TYPES.map((type) => SHIFT_PALETTE[type]);
    entries.forEach((entry) => {
      const ratio = calculateContrastRatio(entry.text, entry.background);
      expect(ratio).toBeGreaterThanOrEqual(MINIMUM_LEGEND_CONTRAST);
    });
  });
});
