import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { flushSync } from "react-dom";
import {
  cancelWorkflowTestRun,
  getWorkflowTest,
  getWorkflowTestRun,
  rerunWorkflowTestFailures,
  resumeWorkflowTestRun,
  runWorkflowTest,
  runWorkflowTestGroup,
  type QueryRunResult,
  type WorkflowTestCompletePayload,
} from "../api";

const ACTIVE_RUN_STORAGE_KEY = "workflowTestActiveRunId";

export interface WorkflowTestRunConfig {
  testName: string;
  groups: Array<{ name: string; queries: string[] }>;
  groupIds?: string[];
  testId?: string;
  agentProfileId?: string | null;
  dryRun: boolean;
  delayMs: number;
}

export interface WorkflowTestProgress {
  groupName: string;
  query: string;
  queryIndex: number;
  totalQueries: number;
  completedQueries: number;
}

interface WorkflowTestRunnerContextValue {
  running: boolean;
  testName: string;
  testId: string | null;
  progress: WorkflowTestProgress;
  liveResults: QueryRunResult[];
  activityLog: string[];
  latestActivity: string | null;
  report: WorkflowTestCompletePayload | null;
  error: string | null;
  lastConfig: WorkflowTestRunConfig | null;
  savedRefreshToken: number;
  showCompletedBanner: boolean;
  run: (config: WorkflowTestRunConfig) => Promise<void>;
  runGroup: (
    testId: string,
    groupId: string,
    options: { testName: string; dryRun: boolean; delayMs: number },
  ) => Promise<void>;
  rerun: () => Promise<void>;
  rerunFailuresInReport: (
    runId: string,
    options: { testName: string; dryRun: boolean; delayMs: number },
  ) => Promise<void>;
  resumeFromRun: (
    runId: string,
    options: { testName: string; dryRun: boolean; delayMs: number },
  ) => Promise<void>;
  cancel: () => void;
  clearError: () => void;
  dismissCompletedBanner: () => void;
  setReport: (report: WorkflowTestCompletePayload | null) => void;
}

const WorkflowTestRunnerContext =
  createContext<WorkflowTestRunnerContextValue | null>(null);

const initialProgress: WorkflowTestProgress = {
  groupName: "",
  query: "",
  queryIndex: 0,
  totalQueries: 0,
  completedQueries: 0,
};

function createStreamHandlers(
  isActiveRun: () => boolean,
  setTestId: (id: string | null) => void,
  setProgress: React.Dispatch<React.SetStateAction<WorkflowTestProgress>>,
  setLiveResults: React.Dispatch<React.SetStateAction<QueryRunResult[]>>,
  setReport: (r: WorkflowTestCompletePayload | null) => void,
  setShowCompletedBanner: (v: boolean) => void,
  setSavedRefreshToken: React.Dispatch<React.SetStateAction<number>>,
  setError: (msg: string) => void,
  appendActivity: (message: string) => void,
  streamCompletedRef: React.MutableRefObject<boolean>,
  setActiveRunId: (runId: string | null) => void,
) {
  return {
    onStart: ({
      totalQueries,
      testId: startedTestId,
      overallTotalQueries,
      completedQueries = 0,
      resume,
      runId: startedRunId,
      testName: startedTestName,
    }: {
      totalQueries: number;
      testId?: string;
      overallTotalQueries?: number;
      completedQueries?: number;
      resume?: boolean;
      runId?: string;
      testName?: string;
    }) => {
      if (!isActiveRun()) return;
      flushSync(() => {
        setTestId(startedTestId ?? null);
        if (startedTestName) {
          // testName set by caller when reconnecting
        }
        if (startedRunId) {
          setActiveRunId(startedRunId);
          sessionStorage.setItem(ACTIVE_RUN_STORAGE_KEY, startedRunId);
        }
        const plannedTotal = overallTotalQueries ?? totalQueries;
        setProgress({
          groupName: "",
          query: "",
          queryIndex: completedQueries,
          totalQueries: plannedTotal,
          completedQueries,
        });
        if (!resume) {
          setLiveResults([]);
        }
      });
    },
    onProgress: ({
      groupName,
      query,
      queryIndex,
      totalQueries,
    }: Omit<WorkflowTestProgress, "completedQueries"> & {
      completedQueries?: number;
    }) => {
      if (!isActiveRun()) return;
      flushSync(() => {
        setProgress((prev) => ({
          groupName,
          query,
          queryIndex,
          totalQueries,
          completedQueries: prev.completedQueries,
        }));
      });
    },
    onStatus: ({ message }: { message: string }) => {
      if (!isActiveRun() || !message.trim()) return;
      flushSync(() => {
        appendActivity(message.trim());
      });
    },
    onResult: (result: QueryRunResult) => {
      if (!isActiveRun()) return;
      flushSync(() => {
        setLiveResults((prev) => {
          const next = [...prev, result];
          setProgress((current) => ({
            ...current,
            completedQueries: next.length,
            queryIndex: Math.max(current.queryIndex, next.length),
          }));
          return next;
        });
      });
    },
    onComplete: (payload: WorkflowTestCompletePayload) => {
      if (!isActiveRun()) return;
      streamCompletedRef.current = true;
      setReport(payload);
      setTestId(payload.testId ?? null);
      const plannedTotal =
        payload.summary.plannedQueries ?? payload.results.length;
      setProgress((current) => ({
        ...current,
        completedQueries: payload.results.length,
        queryIndex: payload.results.length,
        totalQueries: Math.max(current.totalQueries, plannedTotal),
      }));
      setShowCompletedBanner(true);
      setSavedRefreshToken((token) => token + 1);
      setActiveRunId(null);
      sessionStorage.removeItem(ACTIVE_RUN_STORAGE_KEY);
    },
    onError: (message: string) => {
      if (!isActiveRun()) return;
      setError(message);
    },
  };
}

export function WorkflowTestRunnerProvider({
  children,
  dbConfigured,
}: {
  children: ReactNode;
  dbConfigured: boolean;
}) {
  const [running, setRunning] = useState(false);
  const [testName, setTestName] = useState("");
  const [testId, setTestId] = useState<string | null>(null);
  const [progress, setProgress] = useState<WorkflowTestProgress>(initialProgress);
  const [liveResults, setLiveResults] = useState<QueryRunResult[]>([]);
  const [activityLog, setActivityLog] = useState<string[]>([]);
  const [latestActivity, setLatestActivity] = useState<string | null>(null);
  const [report, setReport] = useState<WorkflowTestCompletePayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastConfig, setLastConfig] = useState<WorkflowTestRunConfig | null>(null);
  const [savedRefreshToken, setSavedRefreshToken] = useState(0);
  const [showCompletedBanner, setShowCompletedBanner] = useState(false);
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const runGenerationRef = useRef(0);
  const streamCompletedRef = useRef(false);

  const appendActivity = useCallback((message: string) => {
    setLatestActivity(message);
    setActivityLog((prev) => [...prev.slice(-49), message]);
  }, []);

  const beginRun = useCallback((options?: { keepReport?: boolean }) => {
    runGenerationRef.current += 1;
    streamCompletedRef.current = false;
    setError(null);
    setRunning(true);
    setShowCompletedBanner(false);
    setLiveResults([]);
    setActivityLog([]);
    setLatestActivity(null);
    if (!options?.keepReport) {
      setReport(null);
    }
    setProgress(initialProgress);

    const controller = new AbortController();
    abortRef.current = controller;
    return { controller, generation: runGenerationRef.current };
  }, []);

  const finishRun = useCallback((controller: AbortController) => {
    setRunning(false);
    abortRef.current = null;
    if (controller.signal.aborted && !streamCompletedRef.current) {
      setError("Workflow test cancelled.");
    }
  }, []);

  const run = useCallback(
    async (config: WorkflowTestRunConfig) => {
      if (running) {
        setError("A workflow test is already running.");
        return;
      }
      if (!dbConfigured) {
        setError("Configure a database connection before running workflow tests.");
        return;
      }
      if (!config.agentProfileId) {
        setError("Select an agent for this test before running.");
        return;
      }

      setLastConfig(config);
      setTestName(config.testName);

      const { controller, generation } = beginRun();
      const isActiveRun = () => generation === runGenerationRef.current;

      try {
        await runWorkflowTest(
          {
            testName: config.testName,
            groups: config.groups.length > 0 ? config.groups : undefined,
            groupIds: config.groupIds,
            agentProfileId: config.agentProfileId,
            dryRun: config.dryRun,
            delayMs: config.delayMs,
          },
          createStreamHandlers(
            isActiveRun,
            setTestId,
            setProgress,
            setLiveResults,
            setReport,
            setShowCompletedBanner,
            setSavedRefreshToken,
            setError,
            appendActivity,
            streamCompletedRef,
            setActiveRunId,
          ),
          controller.signal,
        );
      } catch (err) {
        if (!controller.signal.aborted && isActiveRun()) {
          setError(err instanceof Error ? err.message : "Workflow test failed.");
        }
      } finally {
        if (isActiveRun()) {
          finishRun(controller);
        }
      }
    },
    [beginRun, dbConfigured, finishRun, running],
  );

  const runGroup = useCallback(
    async (
      targetTestId: string,
      groupId: string,
      options: { testName: string; dryRun: boolean; delayMs: number },
    ) => {
      if (running) {
        setError("A workflow test is already running.");
        return;
      }
      if (!dbConfigured) {
        setError("Configure a database connection before running workflow tests.");
        return;
      }

      const test = await getWorkflowTest(targetTestId);
      if (!test.agentProfileId) {
        setError("Assign an agent to this saved test in Setup before running.");
        return;
      }

      const config: WorkflowTestRunConfig = {
        testName: options.testName,
        groups: [],
        groupIds: [groupId],
        testId: targetTestId,
        agentProfileId: test.agentProfileId,
        dryRun: options.dryRun,
        delayMs: options.delayMs,
      };

      setLastConfig(config);
      setTestName(options.testName);

      const { controller, generation } = beginRun();
      const isActiveRun = () => generation === runGenerationRef.current;

      try {
        await runWorkflowTestGroup(
          targetTestId,
          groupId,
          { dryRun: options.dryRun, delayMs: options.delayMs },
          createStreamHandlers(
            isActiveRun,
            setTestId,
            setProgress,
            setLiveResults,
            setReport,
            setShowCompletedBanner,
            setSavedRefreshToken,
            setError,
            appendActivity,
            streamCompletedRef,
            setActiveRunId,
          ),
          controller.signal,
        );
      } catch (err) {
        if (!controller.signal.aborted && isActiveRun()) {
          setError(err instanceof Error ? err.message : "Workflow test failed.");
        }
      } finally {
        if (isActiveRun()) {
          finishRun(controller);
        }
      }
    },
    [beginRun, dbConfigured, finishRun, running],
  );

  const rerun = useCallback(async () => {
    if (!lastConfig) return;
    await run(lastConfig);
  }, [lastConfig, run]);

  const rerunFailuresInReport = useCallback(
    async (
      runId: string,
      options: { testName: string; dryRun: boolean; delayMs: number },
    ) => {
      if (running) {
        setError("A workflow test is already running.");
        return;
      }
      if (!dbConfigured) {
        setError("Configure a database connection before running workflow tests.");
        return;
      }

      setTestName(options.testName);
      const { controller, generation } = beginRun({ keepReport: true });
      const isActiveRun = () => generation === runGenerationRef.current;

      try {
        await rerunWorkflowTestFailures(
          runId,
          { dryRun: options.dryRun, delayMs: options.delayMs },
          createStreamHandlers(
            isActiveRun,
            setTestId,
            setProgress,
            setLiveResults,
            setReport,
            setShowCompletedBanner,
            setSavedRefreshToken,
            setError,
            appendActivity,
            streamCompletedRef,
            setActiveRunId,
          ),
          controller.signal,
        );
      } catch (err) {
        if (!controller.signal.aborted && isActiveRun()) {
          setError(
            err instanceof Error ? err.message : "Failed to rerun failures in report.",
          );
        }
      } finally {
        if (isActiveRun()) {
          finishRun(controller);
        }
      }
    },
    [beginRun, dbConfigured, finishRun, running, streamCompletedRef],
  );

  const resumeFromRun = useCallback(
    async (
      runId: string,
      options: { testName: string; dryRun: boolean; delayMs: number },
    ) => {
      if (running) {
        setError("A workflow test is already running.");
        return;
      }
      if (!dbConfigured) {
        setError("Configure a database connection before running workflow tests.");
        return;
      }

      setTestName(options.testName);
      const { controller, generation } = beginRun({ keepReport: true });
      const isActiveRun = () => generation === runGenerationRef.current;

      try {
        const existing = await getWorkflowTestRun(runId);
        setReport(existing);
        setLiveResults(existing.results);
        const plannedTotal =
          existing.summary.plannedQueries ?? existing.results.length;
        setProgress({
          groupName: "",
          query: "",
          queryIndex: existing.results.length,
          totalQueries: plannedTotal,
          completedQueries: existing.results.length,
        });

        await resumeWorkflowTestRun(
          runId,
          { dryRun: options.dryRun, delayMs: options.delayMs },
          createStreamHandlers(
            isActiveRun,
            setTestId,
            setProgress,
            setLiveResults,
            setReport,
            setShowCompletedBanner,
            setSavedRefreshToken,
            setError,
            appendActivity,
            streamCompletedRef,
            setActiveRunId,
          ),
          controller.signal,
        );
      } catch (err) {
        if (!controller.signal.aborted && isActiveRun()) {
          setError(
            err instanceof Error ? err.message : "Failed to resume workflow test.",
          );
        }
      } finally {
        if (isActiveRun()) {
          finishRun(controller);
        }
      }
    },
    [appendActivity, beginRun, dbConfigured, finishRun, running],
  );

  const cancel = useCallback(() => {
    if (!abortRef.current) return;
    const runId = activeRunId ?? sessionStorage.getItem(ACTIVE_RUN_STORAGE_KEY);
    if (runId) {
      void cancelWorkflowTestRun(runId).catch(() => undefined);
    }
    abortRef.current.abort();
  }, [activeRunId]);

  // Do not auto-reconnect / resume workflow tests on app load or refresh.
  // Runs only continue when the user explicitly clicks Run / Resume.

  const clearError = useCallback(() => setError(null), []);

  const dismissCompletedBanner = useCallback(() => {
    setShowCompletedBanner(false);
  }, []);

  const value = useMemo(
    () => ({
      running,
      testName,
      testId,
      progress,
      liveResults,
      activityLog,
      latestActivity,
      report,
      error,
      lastConfig,
      savedRefreshToken,
      showCompletedBanner,
      run,
      runGroup,
      rerun,
      rerunFailuresInReport,
      resumeFromRun,
      cancel,
      clearError,
      dismissCompletedBanner,
      setReport,
    }),
    [
      running,
      testName,
      testId,
      progress,
      liveResults,
      activityLog,
      latestActivity,
      report,
      error,
      lastConfig,
      savedRefreshToken,
      showCompletedBanner,
      run,
      runGroup,
      rerun,
      rerunFailuresInReport,
      resumeFromRun,
      cancel,
      clearError,
      dismissCompletedBanner,
    ],
  );

  return (
    <WorkflowTestRunnerContext.Provider value={value}>
      {children}
    </WorkflowTestRunnerContext.Provider>
  );
}

export function useWorkflowTestRunner(): WorkflowTestRunnerContextValue {
  const ctx = useContext(WorkflowTestRunnerContext);
  if (!ctx) {
    throw new Error("useWorkflowTestRunner must be used within WorkflowTestRunnerProvider");
  }
  return ctx;
}
