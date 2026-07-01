import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  rerunWorkflowTestFailures,
  runWorkflowTest,
  runWorkflowTestGroup,
  type QueryRunResult,
  type WorkflowTestCompletePayload,
} from "../api";

export interface WorkflowTestRunConfig {
  testName: string;
  groups: Array<{ name: string; queries: string[] }>;
  groupIds?: string[];
  testId?: string;
  dryRun: boolean;
  delayMs: number;
}

export interface WorkflowTestProgress {
  groupName: string;
  query: string;
  queryIndex: number;
  totalQueries: number;
}

interface WorkflowTestRunnerContextValue {
  running: boolean;
  testName: string;
  testId: string | null;
  progress: WorkflowTestProgress;
  liveResults: QueryRunResult[];
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
};

function createStreamHandlers(
  setTestId: (id: string | null) => void,
  setProgress: (p: WorkflowTestProgress) => void,
  setLiveResults: React.Dispatch<React.SetStateAction<QueryRunResult[]>>,
  setReport: (r: WorkflowTestCompletePayload | null) => void,
  setShowCompletedBanner: (v: boolean) => void,
  setSavedRefreshToken: React.Dispatch<React.SetStateAction<number>>,
  setError: (msg: string) => void,
) {
  return {
    onStart: ({
      totalQueries,
      testId: startedTestId,
    }: {
      totalQueries: number;
      testId?: string;
    }) => {
      setTestId(startedTestId ?? null);
      setProgress({
        groupName: "",
        query: "",
        queryIndex: 0,
        totalQueries,
      });
    },
    onProgress: ({
      groupName,
      query,
      queryIndex,
      totalQueries,
    }: WorkflowTestProgress) => {
      setProgress({ groupName, query, queryIndex, totalQueries });
    },
    onResult: (result: QueryRunResult) => {
      setLiveResults((prev) => [...prev, result]);
    },
    onComplete: (payload: WorkflowTestCompletePayload) => {
      setReport(payload);
      setTestId(payload.testId ?? null);
      setShowCompletedBanner(true);
      setSavedRefreshToken((token) => token + 1);
    },
    onError: (message: string) => setError(message),
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
  const [report, setReport] = useState<WorkflowTestCompletePayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastConfig, setLastConfig] = useState<WorkflowTestRunConfig | null>(null);
  const [savedRefreshToken, setSavedRefreshToken] = useState(0);
  const [showCompletedBanner, setShowCompletedBanner] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const beginRun = useCallback((options?: { keepReport?: boolean }) => {
    setError(null);
    setRunning(true);
    setShowCompletedBanner(false);
    setLiveResults([]);
    if (!options?.keepReport) {
      setReport(null);
    }
    setProgress(initialProgress);

    const controller = new AbortController();
    abortRef.current = controller;
    return controller;
  }, []);

  const finishRun = useCallback((controller: AbortController) => {
    setRunning(false);
    abortRef.current = null;
    if (controller.signal.aborted) {
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

      setLastConfig(config);
      setTestName(config.testName);

      const controller = beginRun();

      try {
        await runWorkflowTest(
          {
            testName: config.testName,
            groups: config.groups.length > 0 ? config.groups : undefined,
            groupIds: config.groupIds,
            dryRun: config.dryRun,
            delayMs: config.delayMs,
          },
          createStreamHandlers(
            setTestId,
            setProgress,
            setLiveResults,
            setReport,
            setShowCompletedBanner,
            setSavedRefreshToken,
            setError,
          ),
          controller.signal,
        );
      } catch (err) {
        if (!controller.signal.aborted) {
          setError(err instanceof Error ? err.message : "Workflow test failed.");
        }
      } finally {
        finishRun(controller);
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

      const config: WorkflowTestRunConfig = {
        testName: options.testName,
        groups: [],
        groupIds: [groupId],
        testId: targetTestId,
        dryRun: options.dryRun,
        delayMs: options.delayMs,
      };

      setLastConfig(config);
      setTestName(options.testName);

      const controller = beginRun();

      try {
        await runWorkflowTestGroup(
          targetTestId,
          groupId,
          { dryRun: options.dryRun, delayMs: options.delayMs },
          createStreamHandlers(
            setTestId,
            setProgress,
            setLiveResults,
            setReport,
            setShowCompletedBanner,
            setSavedRefreshToken,
            setError,
          ),
          controller.signal,
        );
      } catch (err) {
        if (!controller.signal.aborted) {
          setError(err instanceof Error ? err.message : "Workflow test failed.");
        }
      } finally {
        finishRun(controller);
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
      const controller = beginRun({ keepReport: true });

      try {
        await rerunWorkflowTestFailures(
          runId,
          { dryRun: options.dryRun, delayMs: options.delayMs },
          createStreamHandlers(
            setTestId,
            setProgress,
            setLiveResults,
            setReport,
            setShowCompletedBanner,
            setSavedRefreshToken,
            setError,
          ),
          controller.signal,
        );
      } catch (err) {
        if (!controller.signal.aborted) {
          setError(
            err instanceof Error ? err.message : "Failed to rerun failures in report.",
          );
        }
      } finally {
        finishRun(controller);
      }
    },
    [beginRun, dbConfigured, finishRun, running],
  );

  const cancel = useCallback(() => {
    abortRef.current?.abort();
  }, []);

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
      report,
      error,
      lastConfig,
      savedRefreshToken,
      showCompletedBanner,
      run,
      runGroup,
      rerun,
      rerunFailuresInReport,
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
      report,
      error,
      lastConfig,
      savedRefreshToken,
      showCompletedBanner,
      run,
      runGroup,
      rerun,
      rerunFailuresInReport,
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
