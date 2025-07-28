/**
 * Langfuse Budget Management System Demo
 *
 * This example demonstrates how to use Langfuse's budget management system
 * to set spending limits, configure alerts, and monitor AI model costs.
 */

import { BudgetService } from "@langfuse/shared/src/server/services/BudgetService";
import { prisma } from "@langfuse/shared/src/db";

async function budgetManagementDemo() {
  const budgetService = new BudgetService();
  const projectId = "your-project-id";

  console.log("🔧 Langfuse Budget Management Demo\n");

  // 1. Create a budget for GPT-4 models
  console.log("1. Creating a monthly budget for GPT-4 models...");

  const gpt4Budget = await prisma.modelBudget.create({
    data: {
      projectId,
      name: "GPT-4 Monthly Budget",
      modelPattern: "gpt-4.*", // Regex pattern to match GPT-4 models
      budgetAmount: 100.0, // $100 per month
      budgetPeriod: "MONTHLY",
      alertThresholds: [0.5, 0.75, 1.0], // Alert at 50%, 75%, and 100%
      enforceLimit: false, // Don't block requests, just alert
      notifyUsers: ["user-id-1", "user-id-2"], // Users to notify
      isActive: true,
    },
  });

  console.log(`✅ Created budget: ${gpt4Budget.name} (ID: ${gpt4Budget.id})\n`);

  // 2. Create a stricter budget for expensive models with enforcement
  console.log("2. Creating a weekly budget for Claude-3 with enforcement...");

  const claudeBudget = await prisma.modelBudget.create({
    data: {
      projectId,
      name: "Claude-3 Weekly Budget",
      modelPattern: "claude-3.*",
      budgetAmount: 50.0, // $50 per week
      budgetPeriod: "WEEKLY",
      alertThresholds: [0.6, 0.8, 1.0],
      enforceLimit: true, // Block requests after budget exceeded
      notifyUsers: ["user-id-1"],
      isActive: true,
    },
  });

  console.log(
    `✅ Created enforced budget: ${claudeBudget.name} (ID: ${claudeBudget.id})\n`,
  );

  // 3. Simulate model usage and budget tracking
  console.log("3. Simulating model usage...");

  // Simulate GPT-4 usage
  await budgetService.updateBudgetSpend({
    projectId,
    modelName: "gpt-4-turbo",
    additionalCost: 15.5,
    timestamp: new Date(),
  });
  console.log("💸 Tracked $15.50 spend for gpt-4-turbo");

  // Simulate more GPT-4 usage
  await budgetService.updateBudgetSpend({
    projectId,
    modelName: "gpt-4o",
    additionalCost: 32.25,
    timestamp: new Date(),
  });
  console.log("💸 Tracked $32.25 spend for gpt-4o");

  // Simulate Claude usage
  await budgetService.updateBudgetSpend({
    projectId,
    modelName: "claude-3-opus-20240229",
    additionalCost: 28.75,
    timestamp: new Date(),
  });
  console.log("💸 Tracked $28.75 spend for claude-3-opus\n");

  // 4. Check budget statuses
  console.log("4. Checking budget statuses...");

  const budgetStatuses =
    await budgetService.getProjectBudgetStatuses(projectId);

  budgetStatuses.forEach((status) => {
    const utilizationPercent = (status.percentUsed * 100).toFixed(1);
    const remainingBudget = status.budgetAmount - status.currentSpend;

    console.log(`\n📊 ${status.name}:`);
    console.log(
      `   Current Spend: $${status.currentSpend.toFixed(2)} / $${status.budgetAmount.toFixed(2)}`,
    );
    console.log(`   Utilization: ${utilizationPercent}%`);
    console.log(`   Remaining: $${remainingBudget.toFixed(2)}`);
    console.log(
      `   Status: ${status.isOverBudget ? "❌ Over Budget" : "✅ Within Budget"}`,
    );

    if (status.projectedSpend) {
      console.log(`   Projected Spend: $${status.projectedSpend.toFixed(2)}`);
    }

    if (status.nextThreshold) {
      console.log(
        `   Next Alert: ${(status.nextThreshold * 100).toFixed(0)}% threshold`,
      );
    }
  });

  // 5. Test budget enforcement
  console.log("\n5. Testing budget enforcement...");

  const enforcementResult = await budgetService.checkBudgetEnforcement({
    projectId,
    modelName: "claude-3-opus-20240229",
    estimatedCost: 25.0, // Try to spend another $25
  });

  if (enforcementResult.allowed) {
    console.log("✅ Spending allowed - within budget limits");
  } else {
    console.log(`❌ Spending blocked: ${enforcementResult.reason}`);
    console.log(
      `   Current spend: $${enforcementResult.currentSpend?.toFixed(2)}`,
    );
    console.log(
      `   Budget amount: $${enforcementResult.budgetAmount?.toFixed(2)}`,
    );
  }

  // 6. Get recent alerts
  console.log("\n6. Checking recent budget alerts...");

  const alerts = await prisma.budgetAlert.findMany({
    where: {
      budget: { projectId },
    },
    include: {
      budget: {
        select: { name: true },
      },
    },
    orderBy: { triggeredAt: "desc" },
    take: 5,
  });

  if (alerts.length > 0) {
    console.log(`\n🚨 Recent Budget Alerts (${alerts.length}):`);
    alerts.forEach((alert) => {
      const percent = (alert.thresholdPercent.toNumber() * 100).toFixed(0);
      console.log(`   ${alert.budget.name}: ${percent}% threshold reached`);
      console.log(`   Triggered: ${alert.triggeredAt.toISOString()}`);
      console.log(
        `   Spend: $${alert.currentSpend.toNumber().toFixed(2)} / $${alert.budgetAmount.toNumber().toFixed(2)}\n`,
      );
    });
  } else {
    console.log("   No recent alerts found");
  }

  // 7. Webhook Event Example
  console.log("\n7. Example Webhook Payload:");
  console.log(
    "   When a budget threshold is reached, Langfuse sends webhooks like:",
  );

  const exampleWebhook = {
    id: "alert-123",
    timestamp: new Date().toISOString(),
    type: "budget_alert",
    apiVersion: "v1",
    action: "threshold_reached",
    budgetAlert: {
      budgetId: gpt4Budget.id,
      budgetName: "GPT-4 Monthly Budget",
      modelPattern: "gpt-4.*",
      thresholdPercent: 0.75,
      currentSpend: 75.0,
      budgetAmount: 100.0,
      percentUsed: 0.75,
      periodStart: new Date().toISOString(),
      periodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
      timeRemaining: 15.5, // days
      projectedSpend: 95.0,
      alertLevel: "critical",
    },
  };

  console.log(JSON.stringify(exampleWebhook, null, 2));

  console.log("\n🎉 Budget Management Demo Complete!");
  console.log("\nNext Steps:");
  console.log("1. Set up webhook endpoints to receive budget alerts");
  console.log("2. Configure notification channels (email, Slack, etc.)");
  console.log("3. Monitor the budget management dashboard");
  console.log("4. Adjust budgets and thresholds based on usage patterns");
}

// Configuration Examples
export const budgetExamples = {
  // Conservative budget with early warnings
  conservative: {
    name: "Production GPT-4 Conservative",
    modelPattern: "gpt-4.*",
    budgetAmount: 500.0,
    budgetPeriod: "MONTHLY" as const,
    alertThresholds: [0.25, 0.5, 0.75, 1.0], // Alert early and often
    enforceLimit: true, // Hard stop at 100%
  },

  // Development environment budget
  development: {
    name: "Dev Environment All Models",
    modelPattern: ".*", // Match all models
    budgetAmount: 50.0,
    budgetPeriod: "WEEKLY" as const,
    alertThresholds: [0.8, 1.0], // Only critical alerts
    enforceLimit: true,
  },

  // High-volume production with monitoring
  production: {
    name: "Production High Volume",
    modelPattern: "(gpt-3.5|gpt-4-mini).*", // Cheaper models only
    budgetAmount: 2000.0,
    budgetPeriod: "MONTHLY" as const,
    alertThresholds: [0.7, 0.85, 1.0],
    enforceLimit: false, // Don't block production traffic
  },

  // Experimental models with strict limits
  experimental: {
    name: "Experimental Models",
    modelPattern: "(claude-3|gemini|o1).*",
    budgetAmount: 100.0,
    budgetPeriod: "MONTHLY" as const,
    alertThresholds: [0.5, 0.75, 1.0],
    enforceLimit: true,
  },
};

// Usage tracking integration example
export const usageTrackingExample = `
// Automatic budget tracking happens during model inference:

import { Langfuse } from 'langfuse';

const langfuse = new Langfuse({
  projectId: "your-project-id",
  // Budget tracking is automatic when costs are calculated
});

// When you make model calls, costs are automatically tracked against budgets
const generation = langfuse.generation({
  name: "chat-completion",
  model: "gpt-4-turbo", // This will match "gpt-4.*" budget pattern
  input: "What is the capital of France?",
  output: "The capital of France is Paris.",
  usage: {
    input: 100,
    output: 50,
    total: 150
  }
  // Cost will be calculated and tracked against matching budgets
});
`;

if (require.main === module) {
  budgetManagementDemo().catch(console.error);
}
