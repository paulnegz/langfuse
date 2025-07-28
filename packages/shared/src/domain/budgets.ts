import { z } from "zod/v4";
import {
  type ModelBudget,
  type BudgetAlert,
  type BudgetSpend,
} from "@prisma/client";

// Use BudgetPeriod from Prisma client since it will be generated from schema
import { BudgetPeriod } from "@prisma/client";
export { BudgetPeriod };

// Budget Period enum schema
export const BudgetPeriodSchema = z.enum([
  "DAILY",
  "WEEKLY",
  "MONTHLY",
  "QUARTERLY",
  "YEARLY",
]);

// Budget creation and update schemas
export const CreateModelBudgetSchema = z.object({
  name: z.string().min(1).max(255),
  modelPattern: z.string().min(1), // Regex pattern for matching models
  budgetAmount: z.number().positive(),
  budgetPeriod: BudgetPeriodSchema,
  alertThresholds: z.array(z.number().min(0).max(1)).default([0.5, 0.75, 1.0]),
  startDate: z.date().optional(),
  endDate: z.date().optional(),
  enforceLimit: z.boolean().default(false),
  notifyUsers: z.array(z.string()).default([]), // User IDs
});

export const UpdateModelBudgetSchema = CreateModelBudgetSchema.partial().extend(
  {
    id: z.string(),
    isActive: z.boolean().optional(),
  },
);

// Budget spend tracking
export const BudgetSpendUpdateSchema = z.object({
  budgetId: z.string(),
  periodStart: z.date(),
  periodEnd: z.date(),
  modelName: z.string(),
  additionalSpend: z.number().nonnegative(), // Amount to add to current spend
});

// Budget alert creation
export const CreateBudgetAlertSchema = z.object({
  budgetId: z.string(),
  thresholdPercent: z.number().min(0),
  currentSpend: z.number().nonnegative(),
  budgetAmount: z.number().positive(),
  periodStart: z.date(),
  periodEnd: z.date(),
});

// Domain types
export type ModelBudgetDomain = Omit<
  ModelBudget,
  "alertThresholds" | "notifyUsers"
> & {
  alertThresholds: number[];
  notifyUsers: string[];
};

export type BudgetAlertDomain = BudgetAlert;
export type BudgetSpendDomain = BudgetSpend;

// Budget status calculation
export interface BudgetStatus {
  budgetId: string;
  name: string;
  modelPattern: string;
  budgetAmount: number;
  currentSpend: number;
  percentUsed: number;
  periodStart: Date;
  periodEnd: Date;
  isOverBudget: boolean;
  nextThreshold?: number; // Next alert threshold that hasn't been triggered
  timeRemaining: number; // Days/hours remaining in period
  projectedSpend?: number; // Based on current usage pattern
}

// Webhook payload for budget alerts
export const BudgetAlertWebhookSchema = z.object({
  type: z.literal("budget_alert"),
  budgetId: z.string(),
  budgetName: z.string(),
  modelPattern: z.string(),
  thresholdPercent: z.number(),
  currentSpend: z.number(),
  budgetAmount: z.number(),
  percentUsed: z.number(),
  periodStart: z.date(),
  periodEnd: z.date(),
  timeRemaining: z.number(),
  projectedSpend: z.number().optional(),
  alertLevel: z.enum(["warning", "critical", "exceeded"]),
});

// Budget enforcement result
export interface BudgetEnforcementResult {
  allowed: boolean;
  budgetId?: string;
  reason?: string;
  currentSpend?: number;
  budgetAmount?: number;
}

// Utility functions for budget calculations
export const calculateBudgetPeriod = (
  period: BudgetPeriod,
  startDate?: Date,
): { periodStart: Date; periodEnd: Date } => {
  const now = startDate || new Date();
  const periodStart = new Date(now);
  const periodEnd = new Date(now);

  switch (period) {
    case "DAILY":
      periodStart.setHours(0, 0, 0, 0);
      periodEnd.setDate(periodStart.getDate() + 1);
      periodEnd.setHours(0, 0, 0, 0);
      break;
    case "WEEKLY":
      const dayOfWeek = periodStart.getDay();
      periodStart.setDate(periodStart.getDate() - dayOfWeek);
      periodStart.setHours(0, 0, 0, 0);
      periodEnd.setDate(periodStart.getDate() + 7);
      periodEnd.setHours(0, 0, 0, 0);
      break;
    case "MONTHLY":
      periodStart.setDate(1);
      periodStart.setHours(0, 0, 0, 0);
      periodEnd.setMonth(periodStart.getMonth() + 1);
      periodEnd.setDate(1);
      periodEnd.setHours(0, 0, 0, 0);
      break;
    case "QUARTERLY":
      const quarterStart = Math.floor(periodStart.getMonth() / 3) * 3;
      periodStart.setMonth(quarterStart);
      periodStart.setDate(1);
      periodStart.setHours(0, 0, 0, 0);
      periodEnd.setMonth(quarterStart + 3);
      periodEnd.setDate(1);
      periodEnd.setHours(0, 0, 0, 0);
      break;
    case "YEARLY":
      periodStart.setMonth(0);
      periodStart.setDate(1);
      periodStart.setHours(0, 0, 0, 0);
      periodEnd.setFullYear(periodStart.getFullYear() + 1);
      periodEnd.setMonth(0);
      periodEnd.setDate(1);
      periodEnd.setHours(0, 0, 0, 0);
      break;
  }

  return { periodStart, periodEnd };
};

export const getAlertLevel = (
  percentUsed: number,
): "warning" | "critical" | "exceeded" => {
  if (percentUsed >= 1.0) return "exceeded";
  if (percentUsed >= 0.75) return "critical";
  return "warning";
};

export const projectSpend = (
  currentSpend: number,
  periodStart: Date,
  periodEnd: Date,
  currentDate = new Date(),
): number => {
  const totalPeriodMs = periodEnd.getTime() - periodStart.getTime();
  const elapsedMs = currentDate.getTime() - periodStart.getTime();
  const remainingMs = periodEnd.getTime() - currentDate.getTime();

  if (elapsedMs <= 0) return currentSpend;
  if (remainingMs <= 0) return currentSpend;

  const dailySpendRate = currentSpend / (elapsedMs / (1000 * 60 * 60 * 24));
  const remainingDays = remainingMs / (1000 * 60 * 60 * 24);

  return currentSpend + dailySpendRate * remainingDays;
};

// Type exports
export type CreateModelBudget = z.infer<typeof CreateModelBudgetSchema>;
export type UpdateModelBudget = z.infer<typeof UpdateModelBudgetSchema>;
export type BudgetSpendUpdate = z.infer<typeof BudgetSpendUpdateSchema>;
export type CreateBudgetAlert = z.infer<typeof CreateBudgetAlertSchema>;
export type BudgetAlertWebhook = z.infer<typeof BudgetAlertWebhookSchema>;
