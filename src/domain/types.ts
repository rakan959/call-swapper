import { z } from 'zod';

export const SHIFT_TYPES = ['MOSES', 'WEILER', 'IP CONSULT', 'NIGHT FLOAT', 'BACKUP'] as const;
export type ShiftType = (typeof SHIFT_TYPES)[number];
const SHIFT_TYPE_SET = new Set<ShiftType>(SHIFT_TYPES);

const isoStringSchema = z
  .string()
  .datetime({ offset: true, message: 'Value must be an ISO8601 string with timezone offset' });

export const ShiftTypeSchema = z.enum(SHIFT_TYPES, {
  errorMap: () => ({ message: `Shift type must be one of: ${SHIFT_TYPES.join(', ')}` }),
});

const isoDateStringSchema = z
  .string()
  .regex(/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/u, 'Vacation date must use YYYY-MM-DD format');

const BaseRotationAssignmentSchema = z
  .object({
    weekStartISO: isoStringSchema,
    rotation: z.string().min(1, 'Rotation name is required'),
    rawRotation: z.string().min(1, 'Rotation source is required'),
    vacationDates: z.array(isoDateStringSchema).default([]),
  })
  .strict();

const RotationAssignmentSchema = BaseRotationAssignmentSchema.superRefine(
  (assignment: z.infer<typeof BaseRotationAssignmentSchema>, ctx: z.RefinementCtx) => {
    const uniqueVacations = new Set(assignment.vacationDates);
    if (uniqueVacations.size !== assignment.vacationDates.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['vacationDates'],
        message: 'vacationDates must not contain duplicates',
      });
    }
  },
);

export type RotationAssignment = z.infer<typeof RotationAssignmentSchema>;

const ResidentAcademicYearAssignmentSchema = z
  .object({
    academicYearStartISO: isoStringSchema,
    label: z.string().min(1, 'Academic year label is required'),
  })
  .strict();

export type ResidentAcademicYearAssignment = z.infer<typeof ResidentAcademicYearAssignmentSchema>;

const BaseResidentSchema = z
  .object({
    id: z.string().min(1, 'Resident id is required'),
    name: z.string().min(1, 'Resident name is required'),
    eligibleShiftTypes: z
      .array(ShiftTypeSchema)
      .min(1, 'Resident must be eligible for at least one shift type'),
    rotations: z.array(RotationAssignmentSchema).default([]),
    academicYears: z.array(ResidentAcademicYearAssignmentSchema).default([]),
  })
  .strict();

export const ResidentSchema = BaseResidentSchema.superRefine(
  (resident: z.infer<typeof BaseResidentSchema>, ctx: z.RefinementCtx) => {
    const unique = new Set(resident.eligibleShiftTypes);
    if (unique.size !== resident.eligibleShiftTypes.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'eligibleShiftTypes must not contain duplicates',
        path: ['eligibleShiftTypes'],
      });
    }
  },
);

export type Resident = z.infer<typeof ResidentSchema>;

const BaseShiftSchema = z
  .object({
    id: z.string().min(1, 'Shift id is required'),
    residentId: z.string().min(1, 'Shift residentId is required'),
    startISO: isoStringSchema,
    endISO: isoStringSchema,
    type: ShiftTypeSchema,
    location: z.string().min(1).optional(),
    isHoliday: z.boolean().optional(),
  })
  .strict();

export const ShiftSchema = BaseShiftSchema.superRefine(
  (shift: z.infer<typeof BaseShiftSchema>, ctx: z.RefinementCtx) => {
    const start = Date.parse(shift.startISO);
    const end = Date.parse(shift.endISO);
    if (Number.isNaN(start)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'startISO must be a valid ISO date-time',
        path: ['startISO'],
      });
    }
    if (Number.isNaN(end)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'endISO must be a valid ISO date-time',
        path: ['endISO'],
      });
    }
    if (!Number.isNaN(start) && !Number.isNaN(end) && start >= end) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'startISO must be strictly before endISO',
        path: ['startISO'],
      });
    }
  },
);

export type Shift = z.infer<typeof ShiftSchema>;

const BaseDatasetSchema = z
  .object({
    residents: z.array(ResidentSchema),
    shifts: z.array(ShiftSchema),
  })
  .strict();

export const DatasetSchema = BaseDatasetSchema.superRefine(
  (dataset: z.infer<typeof BaseDatasetSchema>, ctx: z.RefinementCtx) => {
    const residentIds = new Map<string, Resident>();
    dataset.residents.forEach((resident: Resident, idx: number) => {
      if (residentIds.has(resident.id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Duplicate resident id "${resident.id}"`,
          path: ['residents', idx, 'id'],
        });
      } else {
        residentIds.set(resident.id, resident);
      }
    });

    const shiftIds = new Set<string>();
    dataset.shifts.forEach((shift: Shift, idx: number) => {
      if (shiftIds.has(shift.id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Duplicate shift id "${shift.id}"`,
          path: ['shifts', idx, 'id'],
        });
      } else {
        shiftIds.add(shift.id);
      }

      const owner = residentIds.get(shift.residentId);
      if (!owner) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Shift references unknown resident "${shift.residentId}"`,
          path: ['shifts', idx, 'residentId'],
        });
      } else if (!owner.eligibleShiftTypes.includes(shift.type)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Resident "${owner.id}" is not eligible for shift type ${shift.type}`,
          path: ['shifts', idx, 'type'],
        });
      }
    });
  },
);

export type Dataset = z.infer<typeof DatasetSchema>;

export type SwapAdvisoryCode = 'REST_WINDOW' | 'OVERLAP';

export type SwapAdvisory = {
  kind: 'backup-conflict';
  code: SwapAdvisoryCode;
  residentId: string;
  backupShiftId: string;
  otherShiftId: string;
  message: string;
  restHours?: number;
  minimumRestHours?: number;
};

export type SwapPressureCall = {
  shiftId: string;
  shiftType: ShiftType;
  startISO: string;
  endISO: string;
  weight: number;
  baseline: number;
  swapped: number;
  delta: number;
  calendarContext?: 'weekend' | 'holiday' | null;
  rotationLabel?: string | null;
};

export type SwapPressureSection = {
  residentId: string;
  focusShiftId: string;
  windowHours: number;
  calls: SwapPressureCall[];
  baselineTotal: number;
  swappedTotal: number;
  deltaTotal: number;
};

export type SwapPressureBreakdown = {
  score: number;
  baselineScore: number;
  swappedScore: number;
  original: SwapPressureSection;
  counterpart: SwapPressureSection;
};

export type SwapCandidate = {
  a: Shift; // target
  b: Shift; // counterparty
  score: number;
  pressure: SwapPressureBreakdown;
  reasons?: string[];
  advisories?: SwapAdvisory[];
};

export type RuleConfig = {
  restHoursMin: number; // e.g., 8
  typeWhitelist: ShiftType[];
};

export type Context = {
  ruleConfig: RuleConfig;
  residentsById: Map<string, Resident>;
  shiftsByResident: Map<string, Shift[]>;
  shabbosObservers: ReadonlySet<string>;
};

export class DatasetValidationError extends Error {
  constructor(public readonly issues: z.ZodIssue[]) {
    super('Dataset validation failed');
    this.name = 'DatasetValidationError';
  }
}

export function parseDataset(input: unknown): Dataset {
  const result = DatasetSchema.safeParse(input);
  if (!result.success) {
    throw new DatasetValidationError(result.error.issues);
  }
  return result.data;
}

export function isShiftType(value: string): value is ShiftType {
  return SHIFT_TYPE_SET.has(value as ShiftType);
}
