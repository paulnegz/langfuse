import { z } from "zod/v4";
import { jsonSchema } from "../utils/zod";
import { EventActionSchema } from "./automations";

export const WebhookDefaultHeaders = {
  "content-type": "application/json",
  "user-agent": "Langfuse/1.0",
};

export const WebhookOutboundBaseSchema = z.object({
  id: z.string(),
  timestamp: z.coerce.date(),
  type: z.literal("prompt-version"),
  apiVersion: z.literal("v1"),
  action: EventActionSchema,
});

export const BudgetAlertWebhookBaseSchema = z.object({
  id: z.string(),
  timestamp: z.coerce.date(),
  type: z.literal("budget-alert"),
  apiVersion: z.literal("v1"),
  action: z.enum(["threshold_reached", "budget_exceeded"]),
});

export const PromptWebhookOutboundSchema = z
  .object({
    prompt: z.object({
      id: z.string(),
      name: z.string(),
      version: z.number(),
      projectId: z.string(),
      labels: z.array(z.string()),
      prompt: jsonSchema.nullable(),
      type: z.string(),
      config: z.record(z.string(), z.any()),
      commitMessage: z.string().nullable(),
      tags: z.array(z.string()),
      createdAt: z.coerce.date(),
      updatedAt: z.coerce.date(),
    }),
  })
  .and(WebhookOutboundBaseSchema);

export type PromptWebhookOutput = z.infer<typeof PromptWebhookOutboundSchema>;

export const BudgetAlertWebhookOutboundSchema = z
  .object({
    budgetAlert: z.object({
      budgetId: z.string(),
      budgetName: z.string(),
      modelPattern: z.string(),
      thresholdPercent: z.number(),
      currentSpend: z.number(),
      budgetAmount: z.number(),
      percentUsed: z.number(),
      periodStart: z.coerce.date(),
      periodEnd: z.coerce.date(),
      timeRemaining: z.number(),
      projectedSpend: z.number().optional(),
      alertLevel: z.enum(["warning", "critical", "exceeded"]),
    }),
  })
  .and(BudgetAlertWebhookBaseSchema);

export type BudgetAlertWebhookOutput = z.infer<
  typeof BudgetAlertWebhookOutboundSchema
>;
