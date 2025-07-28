import { z } from "zod";
import {
  createTRPCRouter,
  protectedProjectProcedure,
} from "@/src/server/api/trpc";
import { prisma } from "@langfuse/shared/src/db";
import {
  CreateModelBudgetSchema,
  UpdateModelBudgetSchema,
  BudgetPeriodSchema,
  type BudgetStatus,
} from "@langfuse/shared/src/domain/budgets";
import { BudgetService } from "@langfuse/shared/src/server/services/BudgetService";
import { TRPCError } from "@trpc/server";
import { hasEntitlement } from "@/src/features/entitlements/server/hasEntitlement";
import { Decimal } from "decimal.js";

const budgetService = new BudgetService();

export const budgetsRouter = createTRPCRouter({
  /**
   * Get all budgets for a project
   */
  getAll: protectedProjectProcedure
    .input(
      z.object({
        projectId: z.string(),
        includeInactive: z.boolean().default(false),
      }),
    )
    .query(async ({ input, ctx }) => {
      const { projectId, includeInactive } = input;

      const budgets = await prisma.modelBudget.findMany({
        where: {
          projectId,
          ...(includeInactive ? {} : { isActive: true }),
        },
        include: {
          budgetAlerts: {
            orderBy: { triggeredAt: "desc" },
            take: 5, // Last 5 alerts
          },
          budgetSpends: {
            orderBy: { lastUpdated: "desc" },
          },
          _count: {
            select: {
              budgetAlerts: true,
              budgetSpends: true,
            },
          },
        },
        orderBy: { createdAt: "desc" },
      });

      return budgets.map((budget) => ({
        ...budget,
        alertThresholds: budget.alertThresholds as number[],
        notifyUsers: budget.notifyUsers as string[],
        budgetAmount: budget.budgetAmount.toNumber(),
        budgetAlerts: budget.budgetAlerts.map((alert) => ({
          ...alert,
          thresholdPercent: alert.thresholdPercent.toNumber(),
          currentSpend: alert.currentSpend.toNumber(),
          budgetAmount: alert.budgetAmount.toNumber(),
        })),
        budgetSpends: budget.budgetSpends.map((spend) => ({
          ...spend,
          totalSpend: spend.totalSpend.toNumber(),
        })),
      }));
    }),

  /**
   * Get budget status for all project budgets
   */
  getStatuses: protectedProjectProcedure
    .input(z.object({ projectId: z.string() }))
    .query(async ({ input }) => {
      const { projectId } = input;
      return await budgetService.getProjectBudgetStatuses(projectId);
    }),

  /**
   * Get detailed budget status for a specific budget
   */
  getStatus: protectedProjectProcedure
    .input(
      z.object({
        projectId: z.string(),
        budgetId: z.string(),
      }),
    )
    .query(async ({ input }) => {
      const { projectId, budgetId } = input;

      // Verify budget belongs to project
      const budget = await prisma.modelBudget.findFirst({
        where: { id: budgetId, projectId },
      });

      if (!budget) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Budget not found",
        });
      }

      return await budgetService.getBudgetStatus(budgetId);
    }),

  /**
   * Create a new budget
   */
  create: protectedProjectProcedure
    .input(
      z
        .object({
          projectId: z.string(),
        })
        .merge(CreateModelBudgetSchema),
    )
    .mutation(async ({ input, ctx }) => {
      const { projectId, ...budgetData } = input;

      // Check if user has access to budget management
      if (!hasEntitlement("cloud-billing", ctx.session.user.organizations)) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Budget management requires a paid plan",
        });
      }

      // Check for duplicate budget name
      const existingBudget = await prisma.modelBudget.findFirst({
        where: { projectId, name: budgetData.name },
      });

      if (existingBudget) {
        throw new TRPCError({
          code: "CONFLICT",
          message: "A budget with this name already exists",
        });
      }

      const budget = await prisma.modelBudget.create({
        data: {
          projectId,
          name: budgetData.name,
          modelPattern: budgetData.modelPattern,
          budgetAmount: new Decimal(budgetData.budgetAmount),
          budgetPeriod: budgetData.budgetPeriod,
          alertThresholds: budgetData.alertThresholds,
          startDate: budgetData.startDate,
          endDate: budgetData.endDate,
          enforceLimit: budgetData.enforceLimit,
          notifyUsers: budgetData.notifyUsers,
        },
      });

      return {
        ...budget,
        budgetAmount: budget.budgetAmount.toNumber(),
        alertThresholds: budget.alertThresholds as number[],
        notifyUsers: budget.notifyUsers as string[],
      };
    }),

  /**
   * Update an existing budget
   */
  update: protectedProjectProcedure
    .input(
      z
        .object({
          projectId: z.string(),
        })
        .merge(UpdateModelBudgetSchema),
    )
    .mutation(async ({ input, ctx }) => {
      const { projectId, id, ...updateData } = input;

      // Check if user has access to budget management
      if (!hasEntitlement("cloud-billing", ctx.session.user.organizations)) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Budget management requires a paid plan",
        });
      }

      // Verify budget exists and belongs to project
      const existingBudget = await prisma.modelBudget.findFirst({
        where: { id, projectId },
      });

      if (!existingBudget) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Budget not found",
        });
      }

      // Check for duplicate name if name is being updated
      if (updateData.name && updateData.name !== existingBudget.name) {
        const duplicateBudget = await prisma.modelBudget.findFirst({
          where: {
            projectId,
            name: updateData.name,
            id: { not: id },
          },
        });

        if (duplicateBudget) {
          throw new TRPCError({
            code: "CONFLICT",
            message: "A budget with this name already exists",
          });
        }
      }

      const updatePayload: any = {};
      if (updateData.name !== undefined) updatePayload.name = updateData.name;
      if (updateData.modelPattern !== undefined)
        updatePayload.modelPattern = updateData.modelPattern;
      if (updateData.budgetAmount !== undefined)
        updatePayload.budgetAmount = new Decimal(updateData.budgetAmount);
      if (updateData.budgetPeriod !== undefined)
        updatePayload.budgetPeriod = updateData.budgetPeriod;
      if (updateData.alertThresholds !== undefined)
        updatePayload.alertThresholds = updateData.alertThresholds;
      if (updateData.startDate !== undefined)
        updatePayload.startDate = updateData.startDate;
      if (updateData.endDate !== undefined)
        updatePayload.endDate = updateData.endDate;
      if (updateData.enforceLimit !== undefined)
        updatePayload.enforceLimit = updateData.enforceLimit;
      if (updateData.notifyUsers !== undefined)
        updatePayload.notifyUsers = updateData.notifyUsers;
      if (updateData.isActive !== undefined)
        updatePayload.isActive = updateData.isActive;

      const budget = await prisma.modelBudget.update({
        where: { id },
        data: updatePayload,
      });

      return {
        ...budget,
        budgetAmount: budget.budgetAmount.toNumber(),
        alertThresholds: budget.alertThresholds as number[],
        notifyUsers: budget.notifyUsers as string[],
      };
    }),

  /**
   * Delete a budget
   */
  delete: protectedProjectProcedure
    .input(
      z.object({
        projectId: z.string(),
        budgetId: z.string(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const { projectId, budgetId } = input;

      // Check if user has access to budget management
      if (!hasEntitlement("cloud-billing", ctx.session.user.organizations)) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Budget management requires a paid plan",
        });
      }

      // Verify budget exists and belongs to project
      const budget = await prisma.modelBudget.findFirst({
        where: { id: budgetId, projectId },
      });

      if (!budget) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Budget not found",
        });
      }

      await prisma.modelBudget.delete({
        where: { id: budgetId },
      });

      return { success: true };
    }),

  /**
   * Test budget enforcement for a model
   */
  testEnforcement: protectedProjectProcedure
    .input(
      z.object({
        projectId: z.string(),
        modelName: z.string(),
        estimatedCost: z.number().positive(),
      }),
    )
    .query(async ({ input }) => {
      const { projectId, modelName, estimatedCost } = input;

      return await budgetService.checkBudgetEnforcement({
        projectId,
        modelName,
        estimatedCost,
      });
    }),

  /**
   * Get budget alerts for a project
   */
  getAlerts: protectedProjectProcedure
    .input(
      z.object({
        projectId: z.string(),
        budgetId: z.string().optional(),
        limit: z.number().min(1).max(100).default(50),
        offset: z.number().min(0).default(0),
      }),
    )
    .query(async ({ input }) => {
      const { projectId, budgetId, limit, offset } = input;

      const alerts = await prisma.budgetAlert.findMany({
        where: {
          budget: {
            projectId,
            ...(budgetId ? { id: budgetId } : {}),
          },
        },
        include: {
          budget: {
            select: {
              id: true,
              name: true,
              modelPattern: true,
            },
          },
        },
        orderBy: { triggeredAt: "desc" },
        take: limit,
        skip: offset,
      });

      const totalCount = await prisma.budgetAlert.count({
        where: {
          budget: {
            projectId,
            ...(budgetId ? { id: budgetId } : {}),
          },
        },
      });

      return {
        alerts: alerts.map((alert) => ({
          ...alert,
          thresholdPercent: alert.thresholdPercent.toNumber(),
          currentSpend: alert.currentSpend.toNumber(),
          budgetAmount: alert.budgetAmount.toNumber(),
        })),
        totalCount,
        hasMore: offset + limit < totalCount,
      };
    }),
});
