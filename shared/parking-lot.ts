import { z } from "zod";
import { PathFreeTextSchema } from "./validation.js";

const CountSchema = z.number().int().nonnegative().max(262_144);
const ProseSchema = PathFreeTextSchema;

export const ParkingLotItemSchema = z.object({
  id: z.string().regex(/^999\.\d+(?:\.\d+)?$/).max(64),
  title: ProseSchema(200).nullable(),
  disposition: z.enum(["parked", "absorbed", "promoted", "reconciliation", "other"]),
  recordedLabel: ProseSchema(120).nullable(),
  goal: ProseSchema(640).nullable(),
  requirements: ProseSchema(240).nullable(),
  plans: ProseSchema(160).nullable(),
  checklist: z.object({ checked: CountSchema, total: CountSchema }).strict().nullable(),
  laterNote: ProseSchema(240).nullable(),
  excerptsLimited: z.boolean(),
}).strict();

export const BoardParkingLotSchema = z.object({
  availability: z.enum(["available", "unavailable"]),
  section: z.enum(["observed", "absent", "unavailable"]),
  items: z.array(ParkingLotItemSchema).max(64),
  counts: z.object({
    recorded: CountSchema, parked: CountSchema, absorbed: CountSchema,
    promoted: CountSchema, reconciliation: CountSchema, other: CountSchema,
    displayed: CountSchema,
  }).strict(),
  limited: z.boolean(),
}).strict();

export type BoardParkingLot = z.infer<typeof BoardParkingLotSchema>;
export type ParkingLotItem = z.infer<typeof ParkingLotItemSchema>;
