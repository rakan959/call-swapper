import type { Resident, Shift } from './types';

export function filterShiftsByResident(shifts: Shift[], residentId: string | null): Shift[] {
  if (!residentId) {
    return shifts;
  }
  return shifts.filter((shift) => shift.residentId === residentId);
}

export function isValidResidentId(residents: Resident[], residentId: string | null): boolean {
  if (!residentId) {
    return true;
  }
  return residents.some((resident) => resident.id === residentId);
}

export function normalizeResidentId(
  residents: Resident[],
  residentId: string | null,
): string | null {
  if (!residentId) {
    return null;
  }
  return isValidResidentId(residents, residentId) ? residentId : null;
}

export function nextResidentSearch(search: string, residentId: string | null): string {
  const params = new URLSearchParams(search);
  if (residentId) {
    params.set('resident', residentId);
  } else {
    params.delete('resident');
  }
  const query = params.toString();
  return query ? `?${query}` : '';
}
