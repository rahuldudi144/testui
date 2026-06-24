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
  runWorkflowTest,
  type QueryRunResult,
  type WorkflowTestCompletePayload,
} from "../api";

export interface WorkflowTestRunConfig {
  testName: string;
  groups: Array<{ name: string; queries: string[] }>;
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
  rerun: () => Promise<void>;
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

      setError(null);
      setRunning(true);
      setShowCompletedBanner(false);
      setLiveResults([]);
      setReport(null);
      setLastConfig(config);
      setTestName(config.testName);
      setProgress(initialProgress);

      const controller = new AbortController();
      abortRef.current = controller;

      try {
        await runWorkflowTest(
          {
            testName: config.testName,
            groups: config.groups,
            dryRun: config.dryRun,
            delayMs: config.delayMs,
          },
          {
            onStart: ({ totalQueries, testId: startedTestId }) => {
              setTestId(startedTestId ?? null);
              setProgress({
                groupName: "",
                query: "",
                queryIndex: 0,
                totalQueries,
              });
            },
            onProgress: ({ groupName, query, queryIndex, totalQueries }) => {
              setProgress({ groupName, query, queryIndex, totalQueries });
            },
            onResult: (result) => {
              setLiveResults((prev) => [...prev, result]);
            },
            onComplete: (payload) => {
              setReport(payload);
              setTestId(payload.testId ?? null);
              setShowCompletedBanner(true);
              setSavedRefreshToken((token) => token + 1);
            },
            onError: (message) => setError(message),
          },
          controller.signal,
        );
      } catch (err) {
        if (controller.signal.aborted) {
          setError("Workflow test cancelled.");
        } else {
          setError(err instanceof Error ? err.message : "Workflow test failed.");
        }
      } finally {
        setRunning(false);
        abortRef.current = null;
      }
    },
    [dbConfigured, running],
  );

  const rerun = useCallback(async () => {
    if (!lastConfig) return;
    await run(lastConfig);
  }, [lastConfig, run]);

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
      rerun,
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
      rerun,
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
