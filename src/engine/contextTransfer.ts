import type { Context, Resident, Shift } from '@domain/types';

export type SerializableContext = {
  ruleConfig: Context['ruleConfig'];
  residentsById: Array<[string, Resident]>;
  shiftsByResident: Array<[string, Shift[]]>;
  shabbosObservers: string[];
};

export function serializeContext(ctx: Context): SerializableContext {
  return {
    ruleConfig: ctx.ruleConfig,
    residentsById: Array.from(ctx.residentsById.entries()),
    shiftsByResident: Array.from(ctx.shiftsByResident.entries()),
    shabbosObservers: Array.from(ctx.shabbosObservers),
  };
}

export function hydrateContext(data: SerializableContext): Context {
  return {
    ruleConfig: data.ruleConfig,
    residentsById: new Map(data.residentsById),
    shiftsByResident: new Map(data.shiftsByResident),
    shabbosObservers: new Set(data.shabbosObservers),
  };
}
