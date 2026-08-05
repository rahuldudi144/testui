import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Play, RotateCcw } from "lucide-react";
import {
  getWorkflowTest,
  listAgents,
  listDatabases,
  updateWorkflowTestFailuresPolicy,
  type UserAgent,
  type UserDatabase,
  type WorkflowTestCompletePayload,
  type WorkflowTestGroupRecord,
} from "../api";
import {
  useWorkflowTestRunner,
  type WorkflowTestRunConfig,
} from "../context/WorkflowTestRunnerContext";
import {
  countQueriesInGroups,
  toApiGroups,
  type StressTestGroupInput,
} from "../lib/parseQueryGroups";
import {
  clampProgressCounts,
  failureResultsToFormGroups,
  getFailuresGroup,
  groupsToFormInput,
  isEphemeralFailuresGroup,
  resolveFailuresRunAction,
} from "../lib/workflowTestGroups";
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
    setupGroupsRefreshToken,
    lastConfig,
    testName: runnerTestName,
    run,
    runGroup,
    rerun,
    rerunFailuresInReport,
    cancel,
    clearError,
    setReport,
    showCompletedBanner,
    dismissCompletedBanner,
  } = useWorkflowTestRunner();

  const [savedTestCount, setSavedTestCount] = useState(0);
  const [savedRunCount, setSavedRunCount] = useState(0);
  const [loadedTestId, setLoadedTestId] = useState<string | null>(null);
  const [linkedRunId, setLinkedRunId] = useState<string | null>(null);
  const [testName, setTestName] = useState("");
  const [groups, setGroups] = useState<StressTestGroupInput[]>([
    { name: "", queriesText: "" },
  ]);
  const [dryRun, setDryRun] = useState(false);
  const [delayMs, setDelayMs] = useState(0);
  const [agentProfileId, setAgentProfileId] = useState<string | null>(null);
  const [agents, setAgents] = useState<UserAgent[]>([]);
  const [databaseConnectionId, setDatabaseConnectionId] = useState<string | null>(
    null,
  );
  const [databases, setDatabases] = useState<UserDatabase[]>([]);
  const [failuresGroup, setFailuresGroup] = useState<WorkflowTestGroupRecord | null>(
    null,
  );
  /** Setup groups came from Load failures in setup — Run writes back to linked report. */
  const [sameReportFailureMode, setSameReportFailureMode] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  const totalQueries = countQueriesInGroups(groups);
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
    setGroups(
      config.groups.map((group) => ({
        name: group.name,
        queriesText: group.queries.join("\n"),
        categoryType: group.categoryType,
        execution: group.execution,
      })),
    );
    setDryRun(config.dryRun);
    setDelayMs(config.delayMs);
    setAgentProfileId(config.agentProfileId ?? null);
    setDatabaseConnectionId(config.databaseConnectionId ?? null);
  }, []);

  useEffect(() => {
    void listAgents()
      .then((data) => setAgents(data.agents))
      .catch(() => setAgents([]));
  }, [savedRefreshToken]);

  useEffect(() => {
    void listDatabases()
      .then((data) => setDatabases(data.databases))
      .catch(() => setDatabases([]));
  }, [savedRefreshToken]);

  useEffect(() => {
    if (lastConfig) {
      syncFormFromConfig(lastConfig);
    }
  }, [lastConfig, syncFormFromConfig]);

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
        databaseConnectionId,
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
    if (totalQueries === 0) {
      setLocalError("Add at least one query before running.");
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

    if (sameReportFailureMode && linkedRunId) {
      await rerunFailuresInReport(linkedRunId, {
        testName: config.testName,
        dryRun: config.dryRun,
        delayMs: config.delayMs,
        agentProfileId: config.agentProfileId,
        groups: config.groups,
      });
      return;
    }

    await run(config);
  }

  async function handleRerun() {
    const config = resolveRunConfig();
    if (
      config &&
      config.testName.trim() &&
      config.groups.length > 0 &&
      countQueriesInGroups(
        config.groups.map((group) => ({
          name: group.name,
          queriesText: group.queries.join("\n"),
        })),
      ) > 0
    ) {
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
    setLoadedTestId(null);
    setLinkedRunId(null);
    setSameReportFailureMode(false);
    if (data.dryRun !== undefined) setDryRun(data.dryRun);
    if (data.delayMs !== undefined) setDelayMs(data.delayMs);
    if (data.databaseConnectionId !== undefined) {
      setDatabaseConnectionId(data.databaseConnectionId);
    }
    setLocalError(null);
    clearError();
    setTab("setup");
  }

  function handleLoadSavedTest(data: {
    testId: string;
    linkedRunId: string | null;
    testName: string;
    groups: StressTestGroupInput[];
    failuresGroup: WorkflowTestGroupRecord | null;
    dryRun: boolean;
    delayMs: number;
    agentProfileId?: string | null;
    databaseConnectionId?: string | null;
  }) {
    setLoadedTestId(data.testId);
    setLinkedRunId(data.linkedRunId);
    setSameReportFailureMode(false);
    setTestName(data.testName);
    setGroups(data.groups);
    setFailuresGroup(data.failuresGroup);
    setDryRun(data.dryRun);
    setDelayMs(data.delayMs);
    setAgentProfileId(data.agentProfileId ?? null);
    setDatabaseConnectionId(data.databaseConnectionId ?? null);
    setLocalError(null);
    clearError();
    setTab("setup");
  }

  function handleLoadSavedReport(payload: WorkflowTestCompletePayload) {
    setReport(payload);
    setLoadedTestId(payload.testId ?? null);
    setLinkedRunId(payload.runId ?? null);
    setSameReportFailureMode(false);
    navigate("/tests/report");
    setLocalError(null);
    clearError();
  }

  function handleLoadFailuresInSetup(payload: WorkflowTestCompletePayload) {
    const formGroups = failureResultsToFormGroups(payload.results);
    if (formGroups.length === 0) {
      setLocalError("No failed or error queries to load into Setup.");
      return;
    }

    setReport(payload);
    setLoadedTestId(payload.testId ?? null);
    setLinkedRunId(payload.runId ?? null);
    setSameReportFailureMode(true);
    setTestName(payload.testName || testName);
    setGroups(formGroups);
    setFailuresGroup(null);
    if (typeof payload.dryRun === "boolean") setDryRun(payload.dryRun);
    if (typeof payload.delayMs === "number") setDelayMs(payload.delayMs);
    if (payload.agent?.id) setAgentProfileId(payload.agent.id);
    setLocalError(null);
    clearError();
    setTab("setup");
  }

  useEffect(() => {
    // Don't overwrite Setup groups loaded from a report's failures.
    if (sameReportFailureMode) return;
    const testId = loadedTestId ?? report?.testId ?? null;
    if (!testId || setupGroupsRefreshToken === 0) return;
    let cancelled = false;
    void getWorkflowTest(testId)
      .then((test) => {
        if (cancelled) return;
        setLoadedTestId((prev) => prev ?? testId);
        setGroups(groupsToFormInput(test.groups));
        setFailuresGroup(getFailuresGroup(test.groups) ?? null);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [setupGroupsRefreshToken, loadedTestId, report?.testId, sameReportFailureMode]);

  useEffect(() => {
    const testId = report?.testId;
    if (!testId) return;
    if (sameReportFailureMode) return;
    if (loadedTestId && loadedTestId !== testId) return;
    let cancelled = false;
    void getWorkflowTest(testId)
      .then((test) => {
        if (cancelled) return;
        setLoadedTestId((prev) => prev ?? testId);
        setGroups(groupsToFormInput(test.groups));
        setFailuresGroup(getFailuresGroup(test.groups) ?? null);
        if (test.name) setTestName(test.name);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [report?.testId, savedRefreshToken, loadedTestId, sameReportFailureMode]);

  function applyImportedGroups(
    testId: string,
    importedGroups: WorkflowTestGroupRecord[],
    options?: { switchToSetup?: boolean; testName?: string },
  ) {
    // Always point Setup at the target test (new failures suite), not the parent.
    setLoadedTestId(testId);
    setLinkedRunId(null);
    setGroups(groupsToFormInput(importedGroups));
    setFailuresGroup(getFailuresGroup(importedGroups) ?? null);
    if (options?.testName) setTestName(options.testName);
    if (options?.switchToSetup) setTab("setup");
    void getWorkflowTest(testId)
      .then((test) => {
        setTestName(test.name);
        setGroups(groupsToFormInput(test.groups));
        setFailuresGroup(getFailuresGroup(test.groups) ?? null);
        setAgentProfileId(test.agentProfileId);
        setDatabaseConnectionId(test.databaseConnectionId ?? null);
        setDryRun(test.dryRun);
        setDelayMs(test.delayMs);
      })
      .catch(() => undefined);
  }

  function handleFailuresGroupChange(next: WorkflowTestGroupRecord | null) {
    setFailuresGroup(next);
    const testId = loadedTestId ?? report?.testId ?? null;
    if (!testId || !next || isEphemeralFailuresGroup(next)) return;
    void updateWorkflowTestFailuresPolicy(testId, {
      categoryType: next.categoryType,
      executionOverrides: next.executionOverrides ?? null,
    }).catch(() => undefined);
  }

  async function handleRunFailuresFromSetup() {
    const action = resolveFailuresRunAction({
      linkedRunId,
      loadedTestId,
      failuresGroupId: failuresGroup?.id,
    });
    if (!action) {
      setLocalError("Load a saved test (or report) before running failures.");
      return;
    }
    const options = {
      testName: testName.trim() || "Workflow test",
      dryRun,
      delayMs,
      ...(failuresGroup
        ? {
            categoryType: failuresGroup.categoryType,
            execution: failuresGroup.executionOverrides ?? null,
          }
        : {}),
    };

    const persistTestId = loadedTestId ?? report?.testId ?? null;
    if (
      persistTestId &&
      failuresGroup &&
      !isEphemeralFailuresGroup(failuresGroup)
    ) {
      try {
        await updateWorkflowTestFailuresPolicy(persistTestId, {
          categoryType: failuresGroup.categoryType,
          executionOverrides: failuresGroup.executionOverrides ?? null,
        });
      } catch {
        // Run anyway with request-body overrides on rerun path.
      }
    }

    if (action.type === "rerun-report") {
      await rerunFailuresInReport(action.runId, options);
      return;
    }
    await runGroup(action.testId, action.groupId, options);
  }

  const progressCounts = clampProgressCounts({
    completed: progress.completedQueries,
    total: progress.totalQueries,
    queryIndex: progress.queryIndex,
  });

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
                disabled={running || !agentProfileId || totalQueries === 0}
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
              queryIndex={progressCounts.queryIndex}
              totalQueries={progressCounts.total}
              completedQueries={progressCounts.completed}
              estimatedRemainingMs={progress.estimatedRemainingMs}
              categoryType={progress.categoryType}
              expectedOutcome={progress.expectedOutcome}
              latestActivity={latestActivity}
              activityLog={activityLog}
              liveResults={liveResults}
              onCancel={cancel}
            />
          </div>
        )}

        {!running && liveResults.length > 0 && !report && (
          <Alert variant="info" className="mb-4">
            {progress.completedQueries || liveResults.length} result(s) collected
            before the run ended.
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
              Report{savedRunCount > 0 ? ` (${savedRunCount})` : ""}
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
              onTestsLoaded={({ testCount, runCount }) => {
                setSavedTestCount(testCount);
                setSavedRunCount(runCount);
              }}
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
                databases={databases}
                databaseConnectionId={databaseConnectionId}
                onDatabaseConnectionIdChange={setDatabaseConnectionId}
                dryRun={dryRun}
                onDryRunChange={setDryRun}
                delayMs={delayMs}
                onDelayMsChange={setDelayMs}
                failuresGroup={failuresGroup}
                onFailuresGroupChange={handleFailuresGroupChange}
                onRunFailures={() => void handleRunFailuresFromSetup()}
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
              onLoadFailuresInSetup={handleLoadFailuresInSetup}
              onFailuresImported={() => {
                // Stay out of Setup — just surface the new test under Tests.
                setTab("tests");
              }}
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
