import { z } from "zod";
import { ValidationTextSchema } from "./validation.js";

export const TODO_DIRECTORIES = ["pending", "backlog", "deferred", "done", "completed", "root"] as const;
export const TODO_IMPORTANCE = ["blocker", "critical", "high", "major", "medium", "low", "minor", "cosmetic", "warning", "security", "performance", "enhancement"] as const;

const CountSchema = z.number().int().nonnegative().max(100_000);
const DateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable();
const ProseSchema = ValidationTextSchema;
export const TodoItemSchema = z.object({
  directory: z.enum(TODO_DIRECTORIES),
  lifecycle: z.enum(["pending", "backlog", "completed", "root-unclassified"]),
  recordedStatus: z.enum(["open", "deferred", "risk-accepted", "done", "other"]).nullable(),
  statusConflict: z.boolean(),
  duplicateName: z.boolean(),
  title: ProseSchema(200).nullable(),
  summary: ProseSchema(320).nullable(),
  area: ProseSchema(64).nullable(),
  createdAt: DateSchema,
  completedAt: DateSchema,
  phaseId: z.string().regex(/^(?:0|[1-9]\d*)(?:\.(?:0|[1-9]\d*)){0,2}$/).max(64).nullable(),
  severity: z.enum(TODO_IMPORTANCE).nullable(),
  priority: z.enum(TODO_IMPORTANCE).nullable(),
}).strict();

export const BoardTodosSchema = z.object({
  availability: z.enum(["available", "unavailable"]),
  directoryState: z.enum(["observed", "absent", "unknown"]),
  items: z.array(TodoItemSchema).max(64),
  counts: z.object({
    pending: CountSchema, backlog: CountSchema, deferred: CountSchema, done: CountSchema, completed: CountSchema, root: CountSchema,
    totalFiles: CountSchema, distinctTasks: CountSchema, unavailable: CountSchema, duplicates: CountSchema, conflicts: CountSchema, displayed: CountSchema,
  }).strict(),
  countsComplete: z.boolean(),
  limited: z.boolean(),
}).strict();

export type TodoItem = z.infer<typeof TodoItemSchema>;
export type BoardTodos = z.infer<typeof BoardTodosSchema>;
export type TodoDirectory = TodoItem["directory"];
export type TodoImportance = typeof TODO_IMPORTANCE[number];
