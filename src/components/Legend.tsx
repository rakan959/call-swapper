import React, { useEffect, useMemo } from 'react';
import { debugLog } from '@utils/debug';
import { SHIFT_TYPES, ShiftType } from '@domain/types';
import type { ShiftPalette } from './SidePanel';

export type LegendPaletteEntry = ShiftPalette & {
  type: ShiftType;
};

export const SHIFT_PALETTE: Record<ShiftType, LegendPaletteEntry> = {
  MOSES: {
    type: 'MOSES',
    label: 'Moses',
    background: '#2563eb',
    border: '#1e40af',
    text: '#ffffff',
    description: 'Moses service shift',
  },
  WEILER: {
    type: 'WEILER',
    label: 'Weiler',
    background: '#0f766e',
    border: '#115e59',
    text: '#ffffff',
    description: 'Weiler hospital coverage',
  },
  'IP CONSULT': {
    type: 'IP CONSULT',
    label: 'IP Consult',
    background: '#7c3aed',
    border: '#6d28d9',
    text: '#ffffff',
    description: 'Inpatient consult service',
  },
  'NIGHT FLOAT': {
    type: 'NIGHT FLOAT',
    label: 'Night Float',
    background: '#111827',
    border: '#1f2937',
    text: '#ffffff',
    description: 'Night float coverage',
  },
  BACKUP: {
    type: 'BACKUP',
    label: 'Backup',
    background: '#f97316',
    border: '#ea580c',
    text: '#0f172a',
    description: 'Backup / relief',
  },
};

export const MINIMUM_LEGEND_CONTRAST = 4.5;

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const normalized = hex.replace('#', '');
  if (normalized.length !== 6) {
    throw new Error(`Expected 6-digit hex color, received "${hex}"`);
  }
  const value = Number.parseInt(normalized, 16);
  const r = (value >> 16) & 0xff;
  const g = (value >> 8) & 0xff;
  const b = value & 0xff;
  return { r, g, b };
}

function channelToLinear(channel: number): number {
  const proportion = channel / 255;
  if (proportion <= 0.03928) {
    return proportion / 12.92;
  }
  return ((proportion + 0.055) / 1.055) ** 2.4;
}

function relativeLuminance({ r, g, b }: { r: number; g: number; b: number }): number {
  const linearR = channelToLinear(r);
  const linearG = channelToLinear(g);
  const linearB = channelToLinear(b);
  return 0.2126 * linearR + 0.7152 * linearG + 0.0722 * linearB;
}

export function calculateContrastRatio(foregroundHex: string, backgroundHex: string): number {
  const foreground = hexToRgb(foregroundHex);
  const background = hexToRgb(backgroundHex);
  const foregroundLuminance = relativeLuminance(foreground);
  const backgroundLuminance = relativeLuminance(background);
  const brightest = Math.max(foregroundLuminance, backgroundLuminance);
  const darkest = Math.min(foregroundLuminance, backgroundLuminance);
  const ratio = (brightest + 0.05) / (darkest + 0.05);
  return Math.round(ratio * 100) / 100;
}

function useContrastWarnings(entries: LegendPaletteEntry[]): void {
  useEffect(() => {
    entries.forEach((entry) => {
      const ratio = calculateContrastRatio(entry.text, entry.background);
      if (ratio < MINIMUM_LEGEND_CONTRAST) {
        debugLog('legend.contrast.warning', () => ({
          label: entry.label,
          ratio,
          minimum: MINIMUM_LEGEND_CONTRAST,
        }));
      }
    });
  }, [entries]);
}

type LegendProps = {
  titleId?: string;
  ariaLabel?: string;
};

export default function Legend({ titleId = 'legend-title', ariaLabel }: LegendProps): JSX.Element {
  const entries = useMemo(() => SHIFT_TYPES.map((type) => SHIFT_PALETTE[type]), []);
  useContrastWarnings(entries);

  const descriptionId = `${titleId}-description`;

  return (
    <aside
      className="legend-panel"
      aria-label={ariaLabel ?? 'Shift type legend'}
      aria-describedby={descriptionId}
    >
      <h2 id={titleId}>Shift type legend</h2>
      <p id={descriptionId} className="legend-visually-hidden">
        Each item pairs a color with a shift type and description.
      </p>
      <ul className="legend-list" role="list">
        {entries.map((entry) => (
          <li key={entry.type} className="legend-item">
            <span
              className="legend-swatch"
              style={{ backgroundColor: entry.background, borderColor: entry.border }}
              aria-hidden="true"
            />
            <span>
              <span className="legend-label">{entry.label}</span>
              <span className="legend-description"> — {entry.description}</span>
            </span>
          </li>
        ))}
      </ul>
    </aside>
  );
}
