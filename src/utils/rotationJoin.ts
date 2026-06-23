import type { Resident, RotationAssignment, ResidentAcademicYearAssignment } from '@domain/types';
import type {
  ResidentRotationsMap,
  ResidentAcademicYearMap,
  ResidentDisplayNameMap,
} from '@utils/rotations';
import { canonicalizeResidentId } from '@utils/csv';

function surnameId(fullName: string): string {
  const tokens = fullName.trim().split(/\s+/);
  const surname = tokens.length > 0 ? tokens[tokens.length - 1]! : fullName;
  return canonicalizeResidentId(surname);
}

type Index<T> = { bySurname: Map<string, T>; ambiguous: Set<string> };

function indexBySurname<T>(source: Map<string, T>, displayNames: ResidentDisplayNameMap): Index<T> {
  const bySurname = new Map<string, T>();
  const ambiguous = new Set<string>();
  for (const [fullId, value] of source) {
    const display = displayNames.get(fullId);
    const sid = display ? surnameId(display) : fullId;
    if (bySurname.has(sid) || ambiguous.has(sid)) {
      ambiguous.add(sid);
      bySurname.delete(sid);
      continue;
    }
    bySurname.set(sid, value);
  }
  return { bySurname, ambiguous };
}

export function attachRotationsBySurname(
  residents: Resident[],
  rotations: ResidentRotationsMap,
  academicYears: ResidentAcademicYearMap,
  displayNames: ResidentDisplayNameMap,
): Resident[] {
  const rotIdx = indexBySurname<RotationAssignment[]>(rotations, displayNames);
  const ayIdx = indexBySurname<ResidentAcademicYearAssignment[]>(academicYears, displayNames);

  const ambiguous = new Set<string>([...rotIdx.ambiguous, ...ayIdx.ambiguous]);
  if (ambiguous.size > 0) {
    console.warn(`rotationJoin: ambiguous surnames, rotations not attached: ${[...ambiguous].join(', ')}`);
  }

  return residents.map((resident) => ({
    ...resident,
    rotations: rotIdx.bySurname.get(resident.id) ?? [],
    academicYears: ayIdx.bySurname.get(resident.id) ?? [],
  }));
}
