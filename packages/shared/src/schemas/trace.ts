import { z } from 'zod';

export const traceItemSchema = z.object({
  ts: z.string().datetime(),
  lat: z.number(),
  lng: z.number(),
  accuracy: z.number().nullable().optional(),
  alarmId: z.string().nullable().optional(),
  alarmTitle: z.string().nullable().optional(),
  alarmEvent: z.enum(['enter', 'exit', 'nearby']).nullable().optional(),
  alarmRepeat: z.enum(['once', 'always']).nullable().optional(),
  outerRadius: z.number().int().nullable().optional(),
  distance: z.number().nullable().optional(),
  insideOuter: z.boolean().nullable().optional(),
  lastDistance: z.number().nullable().optional(),
  outsideStreak: z.number().int().nullable().optional(),
  didFire: z.boolean().default(false),
  source: z.string().max(40).nullable().optional(),
  note: z.string().max(200).nullable().optional(),
});

export const tracesBatchSchema = z.object({
  traces: z.array(traceItemSchema).min(1).max(500),
});

export type TraceItemInput = z.infer<typeof traceItemSchema>;
export type TracesBatchInput = z.infer<typeof tracesBatchSchema>;
