import { prisma } from "../../db";
import { logger } from "../logger";
import type {
  ModelBudgetDomain,
  BudgetStatus,
  BudgetEnforcementResult,
  CreateBudgetAlert,
  BudgetAlertWebhook,
  BudgetPeriod,
} from "../../domain/budgets";
import {
  calculateBudgetPeriod,
  getAlertLevel,
  projectSpend,
} from "../../domain/budgets";
import Decimal from "decimal.js";

export class BudgetService {
  /**
   * Update budget spend for a specific model and check for threshold alerts
   */
  async updateBudgetSpend(params: {
    projectId: string;
    modelName: string;
    additionalCost: number;
    timestamp?: Date;
  }): Promise<void> {
    const {
      projectId,
      modelName,
      additionalCost,
      timestamp = new Date(),
    } = params;

    // Get all active budgets for this project that match the model
    const budgets = await this.getMatchingBudgets(projectId, modelName);

    for (const budget of budgets) {
      await this.updateBudgetSpendForBudget({
        budget,
        modelName,
        additionalCost,
        timestamp,
      });
    }
  }

  /**
   * Check if spending is allowed for a model based on budget enforcement
   */
  async checkBudgetEnforcement(params: {
    projectId: string;
    modelName: string;
    estimatedCost: number;
  }): Promise<BudgetEnforcementResult> {
    const { projectId, modelName, estimatedCost } = params;

    const budgets = await this.getMatchingBudgets(projectId, modelName);

    for (const budget of budgets) {
      if (!budget.enforceLimit) continue;

      const budgetStatus = await this.getBudgetStatus(budget.id);
      const projectedSpend = budgetStatus.currentSpend + estimatedCost;
      const projectedPercent = projectedSpend / budgetStatus.budgetAmount;

      if (projectedPercent > 1.0) {
        return {
          allowed: false,
          budgetId: budget.id,
          reason: `Would exceed budget ${budget.name} (${projectedPercent.toFixed(1)}% of $${budgetStatus.budgetAmount})`,
          currentSpend: budgetStatus.currentSpend,
          budgetAmount: budgetStatus.budgetAmount,
        };
      }
    }

    return { allowed: true };
  }

  /**
   * Get current budget status for a specific budget
   */
  async getBudgetStatus(budgetId: string): Promise<BudgetStatus> {
    const budget = await prisma.modelBudget.findUniqueOrThrow({
      where: { id: budgetId },
    });

    const { periodStart, periodEnd } = calculateBudgetPeriod(
      budget.budgetPeriod as BudgetPeriod,
      budget.startDate || undefined,
    );

    // Get current spend for this period
    const spendRecords = await prisma.budgetSpend.findMany({
      where: {
        budgetId,
        periodStart,
      },
    });

    const currentSpend = spendRecords.reduce(
      (sum, record) => sum + record.totalSpend.toNumber(),
      0,
    );

    const percentUsed = currentSpend / budget.budgetAmount.toNumber();
    const isOverBudget = percentUsed > 1.0;

    // Find next threshold that hasn't been triggered
    const triggeredThresholds = await prisma.budgetAlert.findMany({
      where: {
        budgetId,
        periodStart,
      },
      select: { thresholdPercent: true },
    });

    const triggeredThresholdSet = new Set(
      triggeredThresholds.map((t) => t.thresholdPercent.toNumber()),
    );

    const alertThresholds = budget.alertThresholds as number[];
    const nextThreshold = alertThresholds
      .filter((t) => t > percentUsed && !triggeredThresholdSet.has(t))
      .sort((a, b) => a - b)[0];

    const timeRemaining =
      Math.max(0, periodEnd.getTime() - Date.now()) / (1000 * 60 * 60 * 24);
    const projectedSpend = projectSpend(currentSpend, periodStart, periodEnd);

    return {
      budgetId,
      name: budget.name,
      modelPattern: budget.modelPattern,
      budgetAmount: budget.budgetAmount.toNumber(),
      currentSpend,
      percentUsed,
      periodStart,
      periodEnd,
      isOverBudget,
      nextThreshold,
      timeRemaining,
      projectedSpend,
    };
  }

  /**
   * Get all budget statuses for a project
   */
  async getProjectBudgetStatuses(projectId: string): Promise<BudgetStatus[]> {
    const budgets = await prisma.modelBudget.findMany({
      where: {
        projectId,
        isActive: true,
      },
    });

    const statuses = await Promise.all(
      budgets.map((budget) => this.getBudgetStatus(budget.id)),
    );

    return statuses;
  }

  /**
   * Create a new budget alert and potentially trigger webhook
   */
  async createBudgetAlert(params: CreateBudgetAlert): Promise<void> {
    const {
      budgetId,
      thresholdPercent,
      currentSpend,
      budgetAmount,
      periodStart,
      periodEnd,
    } = params;

    // Check if alert already exists for this threshold and period
    const existingAlert = await prisma.budgetAlert.findUnique({
      where: {
        budgetId_thresholdPercent_periodStart: {
          budgetId,
          thresholdPercent: new Decimal(thresholdPercent),
          periodStart,
        },
      },
    });

    if (existingAlert) {
      logger.debug(
        `Budget alert already exists for budget ${budgetId}, threshold ${thresholdPercent}`,
      );
      return;
    }

    // Create the alert
    const alert = await prisma.budgetAlert.create({
      data: {
        budgetId,
        thresholdPercent: new Decimal(thresholdPercent),
        triggeredAt: new Date(),
        currentSpend: new Decimal(currentSpend),
        budgetAmount: new Decimal(budgetAmount),
        periodStart,
        periodEnd,
        webhookSent: false,
        emailSent: false,
      },
      include: {
        budget: {
          include: {
            project: true,
          },
        },
      },
    });

    logger.info(
      `Budget alert created for budget ${budgetId} at ${thresholdPercent * 100}% threshold`,
    );

    // Trigger webhook for budget alert
    await this.triggerBudgetAlertWebhook(alert);
  }

  /**
   * Trigger webhook for budget alert
   */
  private async triggerBudgetAlertWebhook(alert: any): Promise<void> {
    try {
      const percentUsed =
        alert.currentSpend.toNumber() / alert.budgetAmount.toNumber();
      const timeRemaining =
        Math.max(0, alert.periodEnd.getTime() - Date.now()) /
        (1000 * 60 * 60 * 24);
      const projectedSpend = projectSpend(
        alert.currentSpend.toNumber(),
        alert.periodStart,
        alert.periodEnd,
      );

      const webhookPayload: BudgetAlertWebhook = {
        type: "budget_alert",
        budgetId: alert.budgetId,
        budgetName: alert.budget.name,
        modelPattern: alert.budget.modelPattern,
        thresholdPercent: alert.thresholdPercent.toNumber(),
        currentSpend: alert.currentSpend.toNumber(),
        budgetAmount: alert.budgetAmount.toNumber(),
        percentUsed,
        periodStart: alert.periodStart,
        periodEnd: alert.periodEnd,
        timeRemaining,
        projectedSpend,
        alertLevel: getAlertLevel(percentUsed),
      };

      // TODO: Implement webhook functionality
      // For now, just mark as processed
      await prisma.budgetAlert.update({
        where: { id: alert.id },
        data: { webhookSent: false }, // Will be true when webhook system is integrated
      });

      logger.info(
        `Budget alert created for budget ${alert.budgetId} (webhook pending integration)`,
      );
    } catch (error) {
      logger.error(`Failed to trigger budget alert webhook:`, error);
    }
  }

  /**
   * Get budgets that match a model name
   */
  private async getMatchingBudgets(
    projectId: string,
    modelName: string,
  ): Promise<ModelBudgetDomain[]> {
    const budgets = await prisma.modelBudget.findMany({
      where: {
        projectId,
        isActive: true,
        OR: [{ endDate: null }, { endDate: { gte: new Date() } }],
      },
    });

    // Filter budgets that match the model pattern
    return budgets
      .filter((budget) => {
        try {
          const regex = new RegExp(budget.modelPattern, "i");
          return regex.test(modelName);
        } catch (error) {
          logger.warn(
            `Invalid regex pattern in budget ${budget.id}: ${budget.modelPattern}`,
          );
          return false;
        }
      })
      .map((budget) => ({
        ...budget,
        alertThresholds: budget.alertThresholds as number[],
        notifyUsers: budget.notifyUsers as string[],
      }));
  }

  /**
   * Update spend for a specific budget
   */
  private async updateBudgetSpendForBudget(params: {
    budget: ModelBudgetDomain;
    modelName: string;
    additionalCost: number;
    timestamp: Date;
  }): Promise<void> {
    const { budget, modelName, additionalCost, timestamp } = params;

    const { periodStart, periodEnd } = calculateBudgetPeriod(
      budget.budgetPeriod as BudgetPeriod,
      budget.startDate || undefined,
    );

    // Update or create spend record
    const spendRecord = await prisma.budgetSpend.upsert({
      where: {
        budgetId_periodStart_modelName: {
          budgetId: budget.id,
          periodStart,
          modelName,
        },
      },
      update: {
        totalSpend: {
          increment: new Decimal(additionalCost),
        },
        lastUpdated: timestamp,
      },
      create: {
        budgetId: budget.id,
        periodStart,
        periodEnd,
        modelName,
        totalSpend: new Decimal(additionalCost),
        lastUpdated: timestamp,
      },
    });

    // Check if any alert thresholds have been reached
    await this.checkAndTriggerAlerts(budget, periodStart, periodEnd);

    logger.debug(
      `Updated budget spend for ${budget.name}: +$${additionalCost} for ${modelName}`,
    );
  }

  /**
   * Check if alert thresholds have been reached and trigger alerts
   */
  private async checkAndTriggerAlerts(
    budget: ModelBudgetDomain,
    periodStart: Date,
    periodEnd: Date,
  ): Promise<void> {
    // Get current total spend for this budget period
    const spendRecords = await prisma.budgetSpend.findMany({
      where: {
        budgetId: budget.id,
        periodStart,
      },
    });

    const currentSpend = spendRecords.reduce(
      (sum, record) => sum + record.totalSpend.toNumber(),
      0,
    );

    const budgetAmount = budget.budgetAmount.toNumber();
    const percentUsed = currentSpend / budgetAmount;

    // Get already triggered thresholds for this period
    const triggeredThresholds = await prisma.budgetAlert.findMany({
      where: {
        budgetId: budget.id,
        periodStart,
      },
      select: { thresholdPercent: true },
    });

    const triggeredThresholdSet = new Set(
      triggeredThresholds.map((t) => t.thresholdPercent.toNumber()),
    );

    // Check each threshold
    for (const threshold of budget.alertThresholds) {
      if (percentUsed >= threshold && !triggeredThresholdSet.has(threshold)) {
        await this.createBudgetAlert({
          budgetId: budget.id,
          thresholdPercent: threshold,
          currentSpend,
          budgetAmount,
          periodStart,
          periodEnd,
        });
      }
    }
  }

  /**
   * Clean up old budget data (for maintenance)
   */
  async cleanupOldBudgetData(retentionDays = 90): Promise<void> {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - retentionDays);

    const deletedAlerts = await prisma.budgetAlert.deleteMany({
      where: {
        createdAt: { lt: cutoffDate },
      },
    });

    const deletedSpends = await prisma.budgetSpend.deleteMany({
      where: {
        createdAt: { lt: cutoffDate },
      },
    });

    logger.info(
      `Cleaned up ${deletedAlerts.count} old budget alerts and ${deletedSpends.count} old spend records`,
    );
  }
}
