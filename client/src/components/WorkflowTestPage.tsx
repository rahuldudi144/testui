import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Play, RotateCcw } from "lucide-react";
import {
  getWorkflowTest,
  listAgents,
  type UserAgent,
  type WorkflowTestCompletePayload,
  type WorkflowTestGroupRecord,
} from "../api";
import {
  useWorkflowTestRunner,
  type WorkflowTestRunConfig,
} from "../context/WorkflowTestRunnerContext";
import {
  toApiGroups,
  type StressTestGroupInput,
} from "../lib/parseQueryGroups";
import { groupsToFormInput, getFailuresGroup } from "../lib/workflowTestGroups";
import type { ParsedWorkflowTestImport } from "../lib/parseWorkflowTestJson";
import { PageHeader } from "./layout/PageHeader";
import { WorkflowTestForm } from "./workflow-test/WorkflowTestForm";
import { WorkflowTestJsonImport } from "./workflow-test/WorkflowTestJsonImport";
import { WorkflowTestProgress } from "./workflow-test/WorkflowTestProgress";
import { WorkflowTestReportPanel } from "./workflow-test/WorkflowTestReportPanel";
import { WorkflowTestCompare } from "./workflow-test/WorkflowTestCompare";
import { ObservabilityPage } from "./workflow-test/ObservabilityPage";
import { WorkflowTestSavedPanel } from "./workflow-test/WorkflowTestSavedPanel";
import { Alert } from "./ui/Alert";
import { Button } from "./ui/Button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./ui/Tabs";

type WorkflowTab = "tests" | "setup" | "report" | "compare" | "usage";

interface Props {
  onBack: () => void;
  dbConfigured: boolean;
  onOpenSettings: () => void;
}

export function WorkflowTestPage({ onBack, dbConfigured, onOpenSettings }: Props) {
  const navigate = useNavigate();
  const location = useLocation();
  const {
    running,
    progress,
    liveResults,
    activityLog,
    latestActivity,
    report,
    error: runnerError,
    savedRefreshToken,
    lastConfig,
    testName: runnerTestName,
    run,
    rerun,
    cancel,
    clearError,
    setReport,
    showCompletedBanner,
    dismissCompletedBanner,
  } = useWorkflowTestRunner();

  const [savedTestCount, setSavedTestCount] = useState(0);
  const [testName, setTestName] = useState("");
  const [groups, setGroups] = useState<StressTestGroupInput[]>([
    { name: "", queriesText: "" },
  ]);
  const [dryRun, setDryRun] = useState(false);
  const [delayMs, setDelayMs] = useState(0);
  const [agentProfileId, setAgentProfileId] = useState<string | null>(null);
  const [agents, setAgents] = useState<UserAgent[]>([]);
  const [failuresGroup, setFailuresGroup] = useState<WorkflowTestGroupRecord | null>(
    null,
  );
  const [localError, setLocalError] = useState<string | null>(null);

  const error = localError ?? runnerError;

  const tabFromPath = useMemo((): WorkflowTab => {
    const match = location.pathname.match(/^\/tests(?:\/([^/]+))?$/);
    const raw = match?.[1];
    if (
      raw === "setup" ||
      raw === "report" ||
      raw === "compare" ||
      raw === "usage"
    ) {
      return raw;
    }
    return "tests";
  }, [location.pathname]);

  const tab = tabFromPath;

  const setTab = useCallback(
    (next: WorkflowTab) => {
      navigate(next === "tests" ? "/tests" : `/tests/${next}`);
    },
    [navigate],
  );

  const syncFormFromConfig = useCallback((config: WorkflowTestRunConfig) => {
    setTestName(config.testName);
    setGroups(groupsToFormInput(config.groups));
    setDryRun(config.dryRun);
    setDelayMs(config.delayMs);
    setAgentProfileId(config.agentProfileId ?? null);
  }, []);

  useEffect(() => {
    void listAgents()
      .then((data) => setAgents(data.agents))
      .catch(() => setAgents([]));
  }, [savedRefreshToken]);

  useEffect(() => {
    if (lastConfig) {
      syncFormFromConfig(lastConfig);
    }
  }, [lastConfig, syncFormFromConfig]);

  useEffect(() => {
    const testId = report?.testId;
    if (!testId) return;
    let cancelled = false;
    void getWorkflowTest(testId)
      .then((test) => {
        if (!cancelled) {
          setFailuresGroup(getFailuresGroup(test.groups) ?? null);
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [report?.testId, savedRefreshToken]);

  useEffect(() => {
    if (!showCompletedBanner || !report) return;
    navigate("/tests/report");
    dismissCompletedBanner();
    if (report.testName && !testName.trim()) {
      setTestName(report.testName);
    }
    if (report.dryRun !== undefined) {
      setDryRun(report.dryRun);
    }
  }, [showCompletedBanner, report, dismissCompletedBanner, testName, navigate]);

  function resolveRunConfig(): WorkflowTestRunConfig | null {
    const apiGroups = toApiGroups(groups);
    const trimmedName = testName.trim();

    if (trimmedName && apiGroups.length > 0) {
      return {
        testName: trimmedName,
        groups: apiGroups,
        agentProfileId,
        dryRun,
        delayMs,
      };
    }

    if (lastConfig) {
      return lastConfig;
    }

    return null;
  }

  async function handleRun() {
    const config = resolveRunConfig();

    if (!config?.testName.trim()) {
      setLocalError("Enter a test name before running.");
      return;
    }
    if (config.groups.length === 0) {
      setLocalError("Add at least one group with a name and queries.");
      return;
    }
    if (!dbConfigured) {
      setLocalError("Configure a database connection before running workflow tests.");
      return;
    }
    if (!config.agentProfileId) {
      setLocalError("Select an agent for this test before running.");
      return;
    }

    syncFormFromConfig(config);
    setLocalError(null);
    clearError();

    await run(config);
  }

  async function handleRerun() {
    const config = resolveRunConfig();
    if (config && config.testName.trim() && config.groups.length > 0) {
      await run(config);
      return;
    }
    if (lastConfig) {
      await rerun();
      return;
    }
    setLocalError("No saved test configuration to rerun.");
  }

  function handleJsonImport(data: ParsedWorkflowTestImport) {
    setTestName(data.testName);
    setGroups(data.groups);
    setFailuresGroup(null);
    if (data.dryRun !== undefined) setDryRun(data.dryRun);
    if (data.delayMs !== undefined) setDelayMs(data.delayMs);
    setLocalError(null);
    clearError();
    setTab("setup");
  }

  function handleLoadSavedTest(data: {
    testName: string;
    groups: StressTestGroupInput[];
    failuresGroup: WorkflowTestGroupRecord | null;
    dryRun: boolean;
    delayMs: number;
    agentProfileId?: string | null;
  }) {
    setTestName(data.testName);
    setGroups(data.groups);
    setFailuresGroup(data.failuresGroup);
    setDryRun(data.dryRun);
    setDelayMs(data.delayMs);
    setAgentProfileId(data.agentProfileId ?? null);
    setLocalError(null);
    clearError();
    setTab("setup");
  }

  function handleLoadSavedReport(payload: WorkflowTestCompletePayload) {
    setReport(payload);
    navigate("/tests/report");
    setLocalError(null);
    clearError();
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-6 md:px-8 md:py-8">
      <div className="mx-auto max-w-5xl">
        <PageHeader
          title="Workflow Test"
          description="Batch-run natural language queries and inspect pass/fail by workflow node."
          breadcrumbs={[
            { label: "Conversations", onClick: onBack },
            { label: "Workflow Test" },
          ]}
          onBack={onBack}
          backLabel="Back to chat"
          actions={
            <div className="flex flex-wrap gap-2">
              {(report || lastConfig) && !running && (
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => void handleRerun()}
                >
                  <RotateCcw className="h-4 w-4" />
                  Rerun
                </Button>
              )}
              <Button
                type="button"
                onClick={() => void handleRun()}
                loading={running}
                disabled={running || !agentProfileId}
              >
                <Play className="h-4 w-4" />
                Run workflow test
              </Button>
            </div>
          }
        />

        {!dbConfigured && (
          <Alert variant="warning" className="mb-4">
            Configure a database in{" "}
            <button
              type="button"
              onClick={onOpenSettings}
              className="font-medium underline underline-offset-2 focus-ring rounded-sm"
            >
              Settings
            </button>{" "}
            before running tests.
          </Alert>
        )}

        {error && (
          <Alert
            variant="error"
            className="mb-4"
            onDismiss={() => {
              setLocalError(null);
              clearError();
            }}
          >
            {error}
          </Alert>
        )}

        {running && (
          <div className="mb-6">
            <WorkflowTestProgress
              testName={runnerTestName || testName || progress.groupName}
              groupName={progress.groupName}
              query={progress.query}
              queryIndex={progress.queryIndex}
              totalQueries={progress.totalQueries}
              completedQueries={Math.max(progress.completedQueries, liveResults.length)}
              latestActivity={latestActivity}
              activityLog={activityLog}
              liveResults={liveResults}
              onCancel={cancel}
            />
          </div>
        )}

        {!running && liveResults.length > 0 && !report && (
          <Alert variant="info" className="mb-4">
            {liveResults.length} result(s) collected before the run ended.
          </Alert>
        )}

        <Tabs
          value={tab}
          onValueChange={(value) => setTab(value as WorkflowTab)}
        >
          <TabsList aria-label="Workflow test sections">
            <TabsTrigger value="tests">
              Tests{savedTestCount > 0 ? ` (${savedTestCount})` : ""}
            </TabsTrigger>
            <TabsTrigger value="setup">Setup</TabsTrigger>
            <TabsTrigger value="report">
              Report{report ? ` (${report.results.length})` : ""}
            </TabsTrigger>
            <TabsTrigger value="compare">Compare</TabsTrigger>
            <TabsTrigger value="usage">Usage</TabsTrigger>
          </TabsList>

          <TabsContent value="tests">
            <WorkflowTestSavedPanel
              disabled={running}
              refreshToken={savedRefreshToken}
              onLoadTest={handleLoadSavedTest}
              onLoadReport={handleLoadSavedReport}
              onError={setLocalError}
              onTestsLoaded={setSavedTestCount}
            />
          </TabsContent>

          <TabsContent value="setup">
            <div className="space-y-6">
              <WorkflowTestJsonImport
                disabled={running}
                onImport={handleJsonImport}
                onError={setLocalError}
              />
              <WorkflowTestForm
                testName={testName}
                onTestNameChange={setTestName}
                groups={groups}
                onGroupsChange={setGroups}
                agents={agents}
                agentProfileId={agentProfileId}
                onAgentProfileIdChange={setAgentProfileId}
                dryRun={dryRun}
                onDryRunChange={setDryRun}
                delayMs={delayMs}
                onDelayMsChange={setDelayMs}
                failuresGroup={failuresGroup}
                disabled={running}
              />
            </div>
          </TabsContent>

          <TabsContent value="report">
            <WorkflowTestReportPanel
              contextReport={report}
              refreshToken={savedRefreshToken}
              onError={setLocalError}
              onReportChange={setReport}
            />
          </TabsContent>

          <TabsContent value="compare">
            <WorkflowTestCompare
              refreshToken={savedRefreshToken}
              onError={setLocalError}
            />
          </TabsContent>

          <TabsContent value="usage">
            <ObservabilityPage />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
