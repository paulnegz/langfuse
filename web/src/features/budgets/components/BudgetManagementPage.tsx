import { useState } from "react";
import { Button } from "@/src/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/src/components/ui/card";
import { Badge } from "@/src/components/ui/badge";
import { Progress } from "@/src/components/ui/progress";
import {
  AlertTriangle,
  Plus,
  TrendingUp,
  DollarSign,
  Clock,
  Settings,
} from "lucide-react";
import { api } from "@/src/utils/api";
import { usePostHogClientCapture } from "@/src/features/posthog-analytics/usePostHogClientCapture";
import { useRouter } from "next/router";
import { CreateBudgetDialog } from "./CreateBudgetDialog";
import { BudgetStatusCard } from "./BudgetStatusCard";
import { BudgetAlertsTable } from "./BudgetAlertsTable";
import { showSuccessToast } from "@/src/features/notifications/showSuccessToast";
import { showErrorToast } from "@/src/features/notifications/showErrorToast";

export const BudgetManagementPage = () => {
  const router = useRouter();
  const projectId = router.query.projectId as string;
  const capture = usePostHogClientCapture();

  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [showInactive, setShowInactive] = useState(false);

  // API queries
  const budgets = api.budgets.getAll.useQuery({
    projectId,
    includeInactive: showInactive,
  });

  const budgetStatuses = api.budgets.getStatuses.useQuery({
    projectId,
  });

  const budgetAlerts = api.budgets.getAlerts.useQuery({
    projectId,
    limit: 10,
  });

  // Mutations
  const deleteBudget = api.budgets.delete.useMutation({
    onSuccess: () => {
      showSuccessToast("Budget deleted successfully");
      budgets.refetch();
      budgetStatuses.refetch();
    },
    onError: (error) => {
      showErrorToast(error.message);
    },
  });

  const toggleBudgetStatus = api.budgets.update.useMutation({
    onSuccess: () => {
      showSuccessToast("Budget updated successfully");
      budgets.refetch();
      budgetStatuses.refetch();
    },
    onError: (error) => {
      showErrorToast(error.message);
    },
  });

  const handleDeleteBudget = async (budgetId: string, budgetName: string) => {
    if (
      confirm(
        `Are you sure you want to delete the budget "${budgetName}"? This action cannot be undone.`,
      )
    ) {
      deleteBudget.mutate({
        projectId,
        budgetId,
      });
      capture("budget:deleted", { budgetId });
    }
  };

  const handleToggleBudgetStatus = async (
    budgetId: string,
    isActive: boolean,
  ) => {
    toggleBudgetStatus.mutate({
      projectId,
      id: budgetId,
      isActive: !isActive,
    });
    capture("budget:toggled", { budgetId, newStatus: !isActive });
  };

  const getAlertLevel = (percentUsed: number) => {
    if (percentUsed >= 1.0) return { level: "danger", label: "Exceeded" };
    if (percentUsed >= 0.75) return { level: "warning", label: "Critical" };
    if (percentUsed >= 0.5) return { level: "info", label: "Warning" };
    return { level: "success", label: "On Track" };
  };

  const totalBudgetAmount =
    budgetStatuses.data?.reduce(
      (sum, status) => sum + status.budgetAmount,
      0,
    ) || 0;
  const totalCurrentSpend =
    budgetStatuses.data?.reduce(
      (sum, status) => sum + status.currentSpend,
      0,
    ) || 0;
  const overallUtilization =
    totalBudgetAmount > 0 ? (totalCurrentSpend / totalBudgetAmount) * 100 : 0;

  const activeBudgets = budgets.data?.filter((b) => b.isActive) || [];
  const budgetsAtRisk =
    budgetStatuses.data?.filter((status) => status.percentUsed >= 0.75) || [];
  const recentAlerts = budgetAlerts.data?.alerts.slice(0, 5) || [];

  return (
    <div className="space-y-6 p-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            Budget Management
          </h1>
          <p className="text-muted-foreground">
            Monitor and control your AI model spending with automated alerts and
            limits
          </p>
        </div>
        <Button
          onClick={() => {
            setIsCreateDialogOpen(true);
            capture("budget:create_dialog_opened");
          }}
          className="flex items-center gap-2"
        >
          <Plus className="h-4 w-4" />
          Create Budget
        </Button>
      </div>

      {/* Overview Cards */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Budget</CardTitle>
            <DollarSign className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              ${totalBudgetAmount.toFixed(2)}
            </div>
            <p className="text-xs text-muted-foreground">
              Across {activeBudgets.length} active budgets
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Current Spend</CardTitle>
            <TrendingUp className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              ${totalCurrentSpend.toFixed(2)}
            </div>
            <div className="mt-1 flex items-center gap-2">
              <Progress value={overallUtilization} className="h-2 flex-1" />
              <span className="text-xs text-muted-foreground">
                {overallUtilization.toFixed(1)}%
              </span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">At Risk</CardTitle>
            <AlertTriangle className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{budgetsAtRisk.length}</div>
            <p className="text-xs text-muted-foreground">
              Budgets over 75% utilized
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Recent Alerts</CardTitle>
            <Clock className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{recentAlerts.length}</div>
            <p className="text-xs text-muted-foreground">
              In the last 24 hours
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Budget Status Cards */}
      <div>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold">Budget Status</h2>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowInactive(!showInactive)}
          >
            {showInactive ? "Hide Inactive" : "Show Inactive"}
          </Button>
        </div>

        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {budgetStatuses.data?.map((status) => (
            <BudgetStatusCard
              key={status.budgetId}
              status={status}
              onEdit={(budgetId) => {
                router.push(
                  `/project/${projectId}/settings/budgets/${budgetId}`,
                );
                capture("budget:edit_clicked", { budgetId });
              }}
              onDelete={(budgetId, budgetName) =>
                handleDeleteBudget(budgetId, budgetName)
              }
              onToggleStatus={(budgetId, isActive) =>
                handleToggleBudgetStatus(budgetId, isActive)
              }
            />
          ))}
        </div>

        {budgetStatuses.data?.length === 0 && (
          <Card className="p-8 text-center">
            <CardContent>
              <DollarSign className="mx-auto mb-4 h-12 w-12 text-muted-foreground" />
              <h3 className="mb-2 text-lg font-semibold">
                No budgets configured
              </h3>
              <p className="mb-4 text-muted-foreground">
                Set up your first budget to start monitoring AI model costs and
                get alerts when spending thresholds are reached.
              </p>
              <Button onClick={() => setIsCreateDialogOpen(true)}>
                <Plus className="mr-2 h-4 w-4" />
                Create Your First Budget
              </Button>
            </CardContent>
          </Card>
        )}
      </div>

      {/* Recent Alerts */}
      {recentAlerts.length > 0 && (
        <div>
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-lg font-semibold">Recent Alerts</h2>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                router.push(`/project/${projectId}/settings/budgets/alerts`);
                capture("budget:view_all_alerts_clicked");
              }}
            >
              View All Alerts
            </Button>
          </div>

          <BudgetAlertsTable
            alerts={recentAlerts}
            isLoading={budgetAlerts.isLoading}
          />
        </div>
      )}

      {/* Create Budget Dialog */}
      <CreateBudgetDialog
        projectId={projectId}
        open={isCreateDialogOpen}
        onOpenChange={setIsCreateDialogOpen}
        onSuccess={() => {
          budgets.refetch();
          budgetStatuses.refetch();
          capture("budget:created");
        }}
      />
    </div>
  );
};
