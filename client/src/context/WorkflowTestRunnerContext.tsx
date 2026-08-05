import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type MutableRefObject,
  type ReactNode,
  type SetStateAction,
} from "react";
import {
  cancelWorkflowTestRun,
  getWorkflowTest,
  getWorkflowTestRun,
  isResumableWorkflowRun,
  isStreamDisconnectError,
  rerunWorkflowTestFailures,
  resumeWorkflowTestRun,
  runWorkflowTest,
  runWorkflowTestGroup,
  watchWorkflowTestRun,
  type QueryRunResult,
  type WorkflowTestCompletePayload,
  type WorkflowTestHandlers,
} from "../api";
import type {
  ExecutionPolicyOverrides,
  WorkflowTestCategoryType,
} from "../lib/workflowTestCategory";
import {
  liveResultKey,
  liveResultKeyAliases,
  resolveRunningProgressCounts,
  shouldSoftAbortOnWake,
} from "../lib/workflowTestGroups";
import { mergeQueryResultIntoReport } from "../lib/workflowTestReportHelpers";

const ACTIVE_RUN_STORAGE_KEY = "workflowTestActiveRunId";
const ACTIVITY_FLUSH_INTERVAL_MS = 500;
const LIVE_RESULTS_CAP = 20;
const MAX_STREAM_RECONNECT_ATTEMPTS = 30;

function sleepAbortable(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException("The operation was aborted.", "AbortError"));
      return;
    }
    const timer = window.setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      window.clearTimeout(timer);
      signal.removeEventListener("abort", onAbort);
      reject(new DOMException("The operation was aborted.", "AbortError"));
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

function positiveCount(...values: Array<number | null | undefined>): number {
  for (const value of values) {
    if (typeof value === "number" && value > 0) return value;
  }
  return 0;
}

export interface WorkflowTestRunConfig {
  testName: string;
  groups: Array<{
    name: string;
    queries: string[];
    categoryType?: WorkflowTestCategoryType;
    execution?: ExecutionPolicyOverrides;
  }>;
  groupIds?: string[];
  testId?: string;
  agentProfileId?: string | null;
  databaseConnectionId?: string | null;
  dryRun: boolean;
  delayMs: number;
}

export interface WorkflowTestProgress {
  groupName: string;
  query: string;
  queryIndex: number;
  totalQueries: number;
  completedQueries: number;
  estimatedRemainingMs?: number;
  estimatedTotalMs?: number;
  categoryType?: WorkflowTestCategoryType | string;
  expectedOutcome?: string;
}

export interface WorkflowTestRunStateContextValue {
  running: boolean;
  reconnecting: boolean;
  testName: string;
  testId: string | null;
  report: WorkflowTestCompletePayload | null;
  error: string | null;
  lastConfig: WorkflowTestRunConfig | null;
  savedRefreshToken: number;
  setupGroupsRefreshToken: number;
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
    options: {
      testName: string;
      dryRun: boolean;
      delayMs: number;
      agentProfileId?: string | null;
      categoryType?: string;
      execution?: import("../lib/workflowTestCategory").ExecutionPolicyOverrides | null;
      groups?: Array<{
        name: string;
        queries: string[];
        categoryType?: string;
        execution?: import("../lib/workflowTestCategory").ExecutionPolicyOverrides;
      }>;
    },
  ) => Promise<void>;
  resumeFromRun: (
    runId: string,
    options: { testName: string; dryRun: boolean; delayMs: number },
  ) => Promise<void>;
  cancel: () => Promise<void>;
  clearError: () => void;
  dismissCompletedBanner: () => void;
  notifySavedGroupsChanged: () => void;
  setReport: (report: WorkflowTestCompletePayload | null) => void;
}

export interface WorkflowTestLiveProgressContextValue {
  progress: WorkflowTestProgress;
  liveResults: QueryRunResult[];
  activityLog: string[];
  latestActivity: string | null;
}

export type WorkflowTestRunnerContextValue = WorkflowTestRunStateContextValue &
  WorkflowTestLiveProgressContextValue;

const WorkflowTestRunStateContext =
  createContext<WorkflowTestRunStateContextValue | null>(null);
const WorkflowTestLiveProgressContext =
  createContext<WorkflowTestLiveProgressContextValue | null>(null);

const initialProgress: WorkflowTestProgress = {
  groupName: "",
  query: "",
  queryIndex: 0,
  totalQueries: 0,
  completedQueries: 0,
};

function capLiveResults(results: QueryRunResult[]): QueryRunResult[] {
  return results.length > LIVE_RESULTS_CAP
    ? results.slice(results.length - LIVE_RESULTS_CAP)
    : results;
}

function seedSeenResultKeys(
  seenResultKeysRef: MutableRefObject<Set<string>>,
  results: QueryRunResult[],
): void {
  const next = new Set<string>();
  for (const result of results) {
    for (const alias of liveResultKeyAliases(result)) {
      next.add(alias);
    }
  }
  seenResultKeysRef.current = next;
}

function createStreamHandlers(
  isActiveRun: () => boolean,
  setTestName: (name: string) => void,
  setTestId: (id: string | null) => void,
  setProgress: Dispatch<SetStateAction<WorkflowTestProgress>>,
  setLiveResults: Dispatch<SetStateAction<QueryRunResult[]>>,
  setReport: Dispatch<SetStateAction<WorkflowTestCompletePayload | null>>,
  setShowCompletedBanner: (visible: boolean) => void,
  setSavedRefreshToken: Dispatch<SetStateAction<number>>,
  setError: (message: string) => void,
  appendActivity: (message: string) => void,
  streamCompletedRef: MutableRefObject<boolean>,
  setActiveRunId: (runId: string | null) => void,
  seenResultKeysRef: MutableRefObject<Set<string>>,
  isRerunRef: MutableRefObject<boolean>,
  lastProgressAtRef: MutableRefObject<number | null>,
): WorkflowTestHandlers {
  const touchProgress = () => {
    lastProgressAtRef.current = Date.now();
  };

  return {
    onStart: ({
      totalQueries,
      testId: startedTestId,
      overallTotalQueries,
      completedQueries = 0,
      resume,
      runId: startedRunId,
      testName: startedTestName,
      estimatedTotalMs,
    }) => {
      if (!isActiveRun()) return;
      touchProgress();
      setTestId(startedTestId ?? null);
      if (startedTestName) setTestName(startedTestName);
      if (startedRunId) {
        setActiveRunId(startedRunId);
        sessionStorage.setItem(ACTIVE_RUN_STORAGE_KEY, startedRunId);
      }
      setProgress((prev) => {
        const reportedBatch = positiveCount(totalQueries);
        const reportedOverall = positiveCount(overallTotalQueries);
        // Never fall back to completedQueries as the plan (that yields N/N).
        const total = isRerunRef.current
          ? positiveCount(reportedBatch, prev.totalQueries)
          : positiveCount(reportedOverall, reportedBatch, prev.totalQueries);
        const completedRaw = Math.max(0, completedQueries);
        const completed =
          total > 0 ? Math.min(completedRaw, total) : completedRaw;
        return {
          groupName: "",
          query: "",
          queryIndex: completed,
          totalQueries: total,
          completedQueries: completed,
          estimatedTotalMs: estimatedTotalMs ?? prev.estimatedTotalMs,
        };
      });
      if (!resume && !isRerunRef.current) {
        seenResultKeysRef.current = new Set();
        setLiveResults([]);
      }
    },
    onProgress: ({
      groupName,
      query,
      queryIndex,
      totalQueries,
      estimatedRemainingMs,
      estimatedTotalMs,
      categoryType,
      expectedOutcome,
    }) => {
      if (!isActiveRun()) return;
      touchProgress();
      setProgress((prev) => {
        const total = positiveCount(prev.totalQueries, totalQueries);
        const completed =
          total > 0
            ? Math.min(prev.completedQueries, total)
            : prev.completedQueries;
        const clampedIndex =
          total > 0
            ? Math.min(Math.max(queryIndex, completed), total)
            : Math.max(queryIndex, completed);
        return {
          ...prev,
          groupName,
          query,
          queryIndex: clampedIndex,
          totalQueries: total,
          completedQueries: completed,
          estimatedRemainingMs,
          estimatedTotalMs: estimatedTotalMs ?? prev.estimatedTotalMs,
          categoryType,
          expectedOutcome,
        };
      });
    },
    onStatus: ({ message }) => {
      if (!isActiveRun() || !message.trim()) return;
      touchProgress();
      appendActivity(message.trim());
    },
    onResult: (result) => {
      if (!isActiveRun()) return;
      touchProgress();
      const aliases = liveResultKeyAliases(result);
      const isNew = aliases.every(
        (alias) => !seenResultKeysRef.current.has(alias),
      );
      for (const alias of aliases) {
        seenResultKeysRef.current.add(alias);
      }

      setLiveResults((prev) => {
        const existingIndex = prev.findIndex((row) =>
          liveResultKeyAliases(row).some((alias) => aliases.includes(alias)),
        );
        const next =
          existingIndex >= 0
            ? prev.map((row, index) => (index === existingIndex ? result : row))
            : [...prev, result];
        return capLiveResults(next);
      });

      setReport((prev) =>
        prev
          ? mergeQueryResultIntoReport(prev, result, liveResultKey)
          : prev,
      );

      // Watch replay / upsert of known keys must not inflate the counter.
      if (!isNew && !isRerunRef.current) return;
      // Rerun updates of already-seen failure keys still count as progress.
      if (!isNew && isRerunRef.current) {
        setProgress((current) => {
          const total = positiveCount(current.totalQueries);
          if (total <= 0) return current;
          const completed = Math.min(current.completedQueries + 1, total);
          return {
            ...current,
            completedQueries: completed,
            queryIndex: Math.max(current.queryIndex, completed),
          };
        });
        return;
      }

      if (!isNew) return;

      setProgress((current) => {
        const total = positiveCount(current.totalQueries);
        // Without a known total, keep the server/hydrate completed count — never
        // unboundedly increment (this caused "1152 of 0" after reconnect replay).
        if (total <= 0) return current;
        const completed = Math.min(current.completedQueries + 1, total);
        return {
          ...current,
          completedQueries: completed,
          queryIndex: Math.max(current.queryIndex, completed),
        };
      });
    },
    onComplete: (payload) => {
      if (!isActiveRun()) return;
      streamCompletedRef.current = true;
      isRerunRef.current = false;
      setReport(payload);
      setTestId(payload.testId ?? null);
      const plannedTotal = positiveCount(
        payload.summary.plannedQueries,
        payload.summary.total,
        payload.results.length,
      );
      const completed = Math.min(
        payload.results.length,
        plannedTotal || payload.results.length,
      );
      seedSeenResultKeys(seenResultKeysRef, payload.results);
      setProgress((current) => ({
        ...current,
        completedQueries: completed,
        queryIndex: completed,
        totalQueries: Math.max(current.totalQueries, plannedTotal),
      }));
      setLiveResults(capLiveResults(payload.results));
      setShowCompletedBanner(true);
      setSavedRefreshToken((token) => token + 1);
      setActiveRunId(null);
      sessionStorage.removeItem(ACTIVE_RUN_STORAGE_KEY);
    },
    onError: (message) => {
      if (isActiveRun()) setError(message);
    },
  };
}

function isNotFoundError(error: unknown): boolean {
  return error instanceof Error && /404|not found/i.test(error.message);
}

export function WorkflowTestRunnerProvider({
  children,
  dbConfigured,
}: {
  children: ReactNode;
  dbConfigured: boolean;
}) {
  const [running, setRunning] = useState(false);
  const [reconnecting, setReconnecting] = useState(false);
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
  const [setupGroupsRefreshToken, setSetupGroupsRefreshToken] = useState(0);
  const [showCompletedBanner, setShowCompletedBanner] = useState(false);
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const softStreamAbortRef = useRef<AbortController | null>(null);
  const activeRunIdRef = useRef<string | null>(null);
  const runGenerationRef = useRef(0);
  const streamCompletedRef = useRef(false);
  const cancelFailedRef = useRef(false);
  const reconnectStartedRef = useRef(false);
  const wakeAttachInFlightRef = useRef(false);
  const lastProgressAtRef = useRef<number | null>(null);
  const activityBufferRef = useRef<string[]>([]);
  const activityFlushTimerRef = useRef<number | null>(null);
  const seenResultKeysRef = useRef<Set<string>>(new Set());
  const isRerunRef = useRef(false);

  const setActiveRunIdTracked = useCallback((runId: string | null) => {
    activeRunIdRef.current = runId;
    setActiveRunId(runId);
  }, []);

  const flushActivity = useCallback(() => {
    activityFlushTimerRef.current = null;
    const messages = activityBufferRef.current;
    if (messages.length === 0) return;
    activityBufferRef.current = [];
    setActivityLog((prev) => [...prev, ...messages].slice(-50));
  }, []);

  const appendActivity = useCallback(
    (message: string) => {
      setLatestActivity(message);
      activityBufferRef.current.push(message);
      if (activityFlushTimerRef.current === null) {
        activityFlushTimerRef.current = window.setTimeout(
          flushActivity,
          ACTIVITY_FLUSH_INTERVAL_MS,
        );
      }
    },
    [flushActivity],
  );

  const beginRun = useCallback((options?: { keepReport?: boolean }) => {
    runGenerationRef.current += 1;
    streamCompletedRef.current = false;
    cancelFailedRef.current = false;
    setError(null);
    setRunning(true);
    setShowCompletedBanner(false);
    setLiveResults([]);
    seenResultKeysRef.current = new Set();
    if (!options?.keepReport) isRerunRef.current = false;
    activityBufferRef.current = [];
    if (activityFlushTimerRef.current !== null) {
      window.clearTimeout(activityFlushTimerRef.current);
      activityFlushTimerRef.current = null;
    }
    setActivityLog([]);
    setLatestActivity(null);
    if (!options?.keepReport) setReport(null);
    setProgress(initialProgress);

    const controller = new AbortController();
    abortRef.current = controller;
    lastProgressAtRef.current = Date.now();
    return { controller, generation: runGenerationRef.current };
  }, []);

  const finishRun = useCallback((controller: AbortController) => {
    setRunning(false);
    if (abortRef.current === controller) abortRef.current = null;
    if (
      controller.signal.aborted &&
      !streamCompletedRef.current &&
      !cancelFailedRef.current
    ) {
      setError("Workflow test cancelled.");
    }
  }, []);

  const handlersFor = useCallback(
    (generation: number) =>
      createStreamHandlers(
        () => generation === runGenerationRef.current,
        setTestName,
        setTestId,
        setProgress,
        setLiveResults,
        setReport,
        setShowCompletedBanner,
        setSavedRefreshToken,
        setError,
        appendActivity,
        streamCompletedRef,
        setActiveRunIdTracked,
        seenResultKeysRef,
        isRerunRef,
        lastProgressAtRef,
      ),
    [appendActivity, setActiveRunIdTracked],
  );

  const hydrateFromRunSnapshot = useCallback(
    (existing: WorkflowTestCompletePayload) => {
      setReport(existing);
      setTestName(existing.testName);
      setTestId(existing.testId ?? null);
      seedSeenResultKeys(seenResultKeysRef, existing.results);
      setLiveResults(capLiveResults(existing.results));
      setProgress((prev) => {
        const plannedItemsLength = Array.isArray(existing.summary.plannedItems)
          ? existing.summary.plannedItems.length
          : 0;
        const { completed, total } = resolveRunningProgressCounts({
          plannedQueries: existing.summary.plannedQueries,
          plannedItemsLength,
          previousTotal: prev.totalQueries,
          resultsLength: existing.results.length,
          runStatus: existing.summary.runStatus,
        });
        return {
          groupName: "",
          query: "",
          queryIndex: completed,
          totalQueries: total,
          completedQueries: completed,
        };
      });
    },
    [],
  );

  /**
   * Keep the SSE session alive across laptop sleep / network blips.
   * First attempt uses `initialStream`; later attempts always /watch the same runId.
   */
  const pumpUntilComplete = useCallback(
    async (
      initialStream: (
        handlers: WorkflowTestHandlers,
        signal: AbortSignal,
      ) => Promise<void>,
      generation: number,
      runController: AbortController,
    ) => {
      const isActiveRun = () => generation === runGenerationRef.current;
      let streamFn = initialStream;
      let attempt = 0;

      while (isActiveRun() && !streamCompletedRef.current) {
        if (runController.signal.aborted) return;

        const streamController = new AbortController();
        softStreamAbortRef.current = streamController;
        const onParentAbort = () => streamController.abort();
        runController.signal.addEventListener("abort", onParentAbort);

        try {
          await streamFn(handlersFor(generation), streamController.signal);
          if (streamCompletedRef.current || !isActiveRun()) return;
          // Clean EOF without a complete event — usually a dropped connection.
          throw new Error("Stream closed unexpectedly");
        } catch (err) {
          if (runController.signal.aborted || !isActiveRun()) return;
          if (streamCompletedRef.current) return;

          const softAborted =
            streamController.signal.aborted && !runController.signal.aborted;
          if (!softAborted && !isStreamDisconnectError(err)) {
            throw err;
          }

          const runId =
            activeRunIdRef.current ??
            sessionStorage.getItem(ACTIVE_RUN_STORAGE_KEY);
          if (!runId) throw err;

          attempt += 1;
          if (attempt > MAX_STREAM_RECONNECT_ATTEMPTS) {
            throw new Error(
              "Lost connection to the workflow test and could not reconnect.",
            );
          }

          setReconnecting(true);
          setError(null);
          appendActivity(
            attempt === 1
              ? "Connection lost — reconnecting to the running test…"
              : `Still reconnecting (attempt ${attempt})…`,
          );

          const backoffMs = Math.min(1000 * attempt, 5000);
          try {
            await sleepAbortable(backoffMs, runController.signal);
          } catch {
            return;
          }

          const existing = await getWorkflowTestRun(runId);
          if (!isActiveRun() || runController.signal.aborted) return;

          if (existing.summary.runStatus !== "running") {
            hydrateFromRunSnapshot(existing);
            streamCompletedRef.current = true;
            if (
              existing.summary.runStatus === "completed" ||
              isResumableWorkflowRun(existing)
            ) {
              setShowCompletedBanner(true);
              setSavedRefreshToken((token) => token + 1);
            }
            setActiveRunIdTracked(null);
            sessionStorage.removeItem(ACTIVE_RUN_STORAGE_KEY);
            return;
          }

          hydrateFromRunSnapshot(existing);
          setActiveRunIdTracked(runId);
          sessionStorage.setItem(ACTIVE_RUN_STORAGE_KEY, runId);
          streamFn = (handlers, signal) =>
            watchWorkflowTestRun(runId, handlers, signal);
        } finally {
          runController.signal.removeEventListener("abort", onParentAbort);
          if (softStreamAbortRef.current === streamController) {
            softStreamAbortRef.current = null;
          }
          setReconnecting(false);
        }
      }
    },
    [
      appendActivity,
      handlersFor,
      hydrateFromRunSnapshot,
      setActiveRunIdTracked,
    ],
  );

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
        await pumpUntilComplete(
          (handlers, signal) =>
            runWorkflowTest(
              {
                testName: config.testName,
                groups: config.groups.length > 0 ? config.groups : undefined,
                groupIds: config.groupIds,
                agentProfileId: config.agentProfileId,
                dryRun: config.dryRun,
                delayMs: config.delayMs,
                databaseConnectionId: config.databaseConnectionId,
              },
              handlers,
              signal,
            ),
          generation,
          controller,
        );
      } catch (err) {
        if (!controller.signal.aborted && isActiveRun()) {
          setError(err instanceof Error ? err.message : "Workflow test failed.");
        }
      } finally {
        if (isActiveRun()) finishRun(controller);
      }
    },
    [beginRun, dbConfigured, finishRun, pumpUntilComplete, running],
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
        databaseConnectionId: test.databaseConnectionId,
        dryRun: options.dryRun,
        delayMs: options.delayMs,
      };
      setLastConfig(config);
      setTestName(options.testName);
      const { controller, generation } = beginRun();
      const isActiveRun = () => generation === runGenerationRef.current;

      try {
        await pumpUntilComplete(
          (handlers, signal) =>
            runWorkflowTestGroup(
              targetTestId,
              groupId,
              { dryRun: options.dryRun, delayMs: options.delayMs },
              handlers,
              signal,
            ),
          generation,
          controller,
        );
      } catch (err) {
        if (!controller.signal.aborted && isActiveRun()) {
          setError(err instanceof Error ? err.message : "Workflow test failed.");
        }
      } finally {
        if (isActiveRun()) finishRun(controller);
      }
    },
    [beginRun, dbConfigured, finishRun, pumpUntilComplete, running],
  );

  const rerun = useCallback(async () => {
    if (lastConfig) await run(lastConfig);
  }, [lastConfig, run]);

  const rerunFailuresInReport = useCallback(
    async (
      runId: string,
      options: {
        testName: string;
        dryRun: boolean;
        delayMs: number;
        agentProfileId?: string | null;
        categoryType?: string;
        execution?: import("../lib/workflowTestCategory").ExecutionPolicyOverrides | null;
        groups?: Array<{
          name: string;
          queries: string[];
          categoryType?: string;
          execution?: import("../lib/workflowTestCategory").ExecutionPolicyOverrides;
        }>;
      },
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
      isRerunRef.current = true;
      const { controller, generation } = beginRun({ keepReport: true });
      const isActiveRun = () => generation === runGenerationRef.current;

      try {
        const existing = await getWorkflowTestRun(runId);
        hydrateFromRunSnapshot(existing);
        const setupQueryCount =
          options.groups?.reduce((sum, group) => sum + group.queries.length, 0) ??
          0;
        const failedCount =
          setupQueryCount > 0
            ? setupQueryCount
            : existing.results.filter(
                (row) => row.status === "fail" || row.status === "error",
              ).length;
        setProgress({
          groupName: "",
          query: "",
          queryIndex: 0,
          totalQueries: failedCount,
          completedQueries: 0,
        });
        setActiveRunIdTracked(runId);
        sessionStorage.setItem(ACTIVE_RUN_STORAGE_KEY, runId);
        await pumpUntilComplete(
          (handlers, signal) =>
            rerunWorkflowTestFailures(
              runId,
              {
                dryRun: options.dryRun,
                delayMs: options.delayMs,
                agentProfileId: options.agentProfileId,
                categoryType: options.categoryType,
                execution: options.execution,
                groups: options.groups,
              },
              handlers,
              signal,
            ),
          generation,
          controller,
        );
      } catch (err) {
        if (!controller.signal.aborted && isActiveRun()) {
          setError(
            err instanceof Error
              ? err.message
              : "Failed to rerun failures in report.",
          );
        }
      } finally {
        isRerunRef.current = false;
        if (isActiveRun()) finishRun(controller);
      }
    },
    [
      beginRun,
      dbConfigured,
      finishRun,
      hydrateFromRunSnapshot,
      pumpUntilComplete,
      running,
      setActiveRunIdTracked,
    ],
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
        hydrateFromRunSnapshot(existing);
        setActiveRunIdTracked(runId);
        sessionStorage.setItem(ACTIVE_RUN_STORAGE_KEY, runId);
        await pumpUntilComplete(
          (handlers, signal) =>
            resumeWorkflowTestRun(
              runId,
              { dryRun: options.dryRun, delayMs: options.delayMs },
              handlers,
              signal,
            ),
          generation,
          controller,
        );
      } catch (err) {
        if (!controller.signal.aborted && isActiveRun()) {
          setError(
            err instanceof Error ? err.message : "Failed to resume workflow test.",
          );
        }
      } finally {
        if (isActiveRun()) finishRun(controller);
      }
    },
    [
      beginRun,
      dbConfigured,
      finishRun,
      hydrateFromRunSnapshot,
      pumpUntilComplete,
      running,
      setActiveRunIdTracked,
    ],
  );

  const cancel = useCallback(async () => {
    const controller = abortRef.current;
    const runId = activeRunId ?? sessionStorage.getItem(ACTIVE_RUN_STORAGE_KEY);

    if (runId) {
      let cancelError: unknown;
      for (let attempt = 1; attempt <= 3; attempt += 1) {
        try {
          await cancelWorkflowTestRun(runId);
          cancelError = undefined;
          break;
        } catch (err) {
          cancelError = err;
          if (attempt < 3) {
            await new Promise((resolve) =>
              window.setTimeout(resolve, 150 * attempt),
            );
          }
        }
      }
      if (cancelError) {
        cancelFailedRef.current = true;
        setError(
          cancelError instanceof Error
            ? `Failed to cancel workflow test: ${cancelError.message}`
            : "Failed to cancel workflow test.",
        );
      } else {
        setActiveRunIdTracked(null);
        sessionStorage.removeItem(ACTIVE_RUN_STORAGE_KEY);
        try {
          let existing = await getWorkflowTestRun(runId);
          // Rerun checkpoints asynchronously; retry briefly so newly passed
          // queries are visible after cancel.
          for (let attempt = 0; attempt < 5; attempt += 1) {
            if (existing.summary.runStatus !== "running") break;
            await new Promise((resolve) =>
              window.setTimeout(resolve, 100 * (attempt + 1)),
            );
            existing = await getWorkflowTestRun(runId);
          }
          hydrateFromRunSnapshot(existing);
          setShowCompletedBanner(true);
          setSavedRefreshToken((token) => token + 1);
        } catch {
          // Report may still arrive via SSE complete.
        }
      }
    }

    softStreamAbortRef.current?.abort();
    if (controller) {
      controller.abort();
    } else {
      setRunning(false);
      setReconnecting(false);
    }
  }, [activeRunId, hydrateFromRunSnapshot, setActiveRunIdTracked]);

  useEffect(() => {
    if (!dbConfigured || reconnectStartedRef.current) return;
    const runId = sessionStorage.getItem(ACTIVE_RUN_STORAGE_KEY);
    if (!runId) return;

    let disposed = false;
    let reconnectController: AbortController | null = null;
    const startTimer = window.setTimeout(() => {
      if (disposed) return;
      reconnectStartedRef.current = true;
      setReconnecting(true);

      void (async () => {
        try {
          const existing = await getWorkflowTestRun(runId);
          if (disposed) return;
          const runStatus = existing.summary.runStatus;

          if (runStatus === "running") {
            setActiveRunIdTracked(runId);
            const { controller, generation } = beginRun({ keepReport: true });
            reconnectController = controller;
            hydrateFromRunSnapshot(existing);

            try {
              await pumpUntilComplete(
                (handlers, signal) =>
                  watchWorkflowTestRun(runId, handlers, signal),
                generation,
                controller,
              );
            } catch (err) {
              if (
                !controller.signal.aborted &&
                generation === runGenerationRef.current
              ) {
                setError(
                  err instanceof Error
                    ? err.message
                    : "Failed to reconnect to workflow test.",
                );
              }
            } finally {
              if (generation === runGenerationRef.current) {
                finishRun(controller);
              }
            }
            return;
          }

          if (runStatus === "completed" || isResumableWorkflowRun(existing)) {
            hydrateFromRunSnapshot(existing);
            setShowCompletedBanner(true);
          }
          setActiveRunIdTracked(null);
          sessionStorage.removeItem(ACTIVE_RUN_STORAGE_KEY);
        } catch (err) {
          if (disposed) return;
          if (isNotFoundError(err)) {
            setActiveRunIdTracked(null);
            sessionStorage.removeItem(ACTIVE_RUN_STORAGE_KEY);
          } else {
            setError(
              err instanceof Error
                ? err.message
                : "Failed to restore workflow test.",
            );
          }
        } finally {
          if (!disposed) setReconnecting(false);
        }
      })();
    }, 0);

    return () => {
      disposed = true;
      window.clearTimeout(startTimer);
      if (reconnectController) {
        runGenerationRef.current += 1;
        reconnectController.abort();
      }
    };
  }, [
    beginRun,
    dbConfigured,
    finishRun,
    hydrateFromRunSnapshot,
    pumpUntilComplete,
    setActiveRunIdTracked,
  ]);

  // After laptop sleep / tab freeze: soft-abort a hung SSE reader so pumpUntilComplete
  // can reattach via /watch without cancelling the backend run.
  useEffect(() => {
    if (!dbConfigured) return;

    const onWake = () => {
      if (document.visibilityState === "hidden") return;

      const runId =
        activeRunIdRef.current ?? sessionStorage.getItem(ACTIVE_RUN_STORAGE_KEY);
      if (!runId) return;

      // Soft-abort only when the SSE reader looks hung after sleep/freeze —
      // a normal tab focus must not tear down a healthy stream.
      if (
        shouldSoftAbortOnWake({
          hasActiveRunController: Boolean(abortRef.current),
          hasSoftStreamController: Boolean(softStreamAbortRef.current),
          lastProgressAtMs: lastProgressAtRef.current,
          nowMs: Date.now(),
        })
      ) {
        softStreamAbortRef.current?.abort();
        return;
      }

      // UI already looks stopped but backend may still be running — reattach.
      if (wakeAttachInFlightRef.current || abortRef.current) return;

      wakeAttachInFlightRef.current = true;
      void (async () => {
        try {
          const existing = await getWorkflowTestRun(runId);
          if (existing.summary.runStatus !== "running") {
            hydrateFromRunSnapshot(existing);
            if (
              existing.summary.runStatus === "completed" ||
              isResumableWorkflowRun(existing)
            ) {
              setShowCompletedBanner(true);
            }
            setActiveRunIdTracked(null);
            sessionStorage.removeItem(ACTIVE_RUN_STORAGE_KEY);
            return;
          }

          if (abortRef.current) return;

          setReconnecting(true);
          setError(null);
          appendActivity("Reconnected after sleep — watching the running test…");
          const { controller, generation } = beginRun({ keepReport: true });
          hydrateFromRunSnapshot(existing);
          setActiveRunIdTracked(runId);
          sessionStorage.setItem(ACTIVE_RUN_STORAGE_KEY, runId);

          try {
            await pumpUntilComplete(
              (handlers, signal) =>
                watchWorkflowTestRun(runId, handlers, signal),
              generation,
              controller,
            );
          } catch (err) {
            if (
              !controller.signal.aborted &&
              generation === runGenerationRef.current
            ) {
              setError(
                err instanceof Error
                  ? err.message
                  : "Failed to reconnect to workflow test.",
              );
            }
          } finally {
            if (generation === runGenerationRef.current) {
              finishRun(controller);
            }
          }
        } catch {
          // Ignore wake probe failures; user can reload.
        } finally {
          wakeAttachInFlightRef.current = false;
          setReconnecting(false);
        }
      })();
    };

    document.addEventListener("visibilitychange", onWake);
    window.addEventListener("online", onWake);
    return () => {
      document.removeEventListener("visibilitychange", onWake);
      window.removeEventListener("online", onWake);
    };
  }, [
    appendActivity,
    beginRun,
    dbConfigured,
    finishRun,
    hydrateFromRunSnapshot,
    pumpUntilComplete,
    setActiveRunIdTracked,
  ]);
  useEffect(
    () => () => {
      if (activityFlushTimerRef.current !== null) {
        window.clearTimeout(activityFlushTimerRef.current);
      }
    },
    [],
  );

  const clearError = useCallback(() => setError(null), []);
  const dismissCompletedBanner = useCallback(
    () => setShowCompletedBanner(false),
    [],
  );
  const notifySavedGroupsChanged = useCallback(() => {
    setSavedRefreshToken((token) => token + 1);
    setSetupGroupsRefreshToken((token) => token + 1);
  }, []);

  const runStateValue = useMemo<WorkflowTestRunStateContextValue>(
    () => ({
      running,
      reconnecting,
      testName,
      testId,
      report,
      error,
      lastConfig,
      savedRefreshToken,
      setupGroupsRefreshToken,
      showCompletedBanner,
      run,
      runGroup,
      rerun,
      rerunFailuresInReport,
      resumeFromRun,
      cancel,
      clearError,
      dismissCompletedBanner,
      notifySavedGroupsChanged,
      setReport,
    }),
    [
      running,
      reconnecting,
      testName,
      testId,
      report,
      error,
      lastConfig,
      savedRefreshToken,
      setupGroupsRefreshToken,
      showCompletedBanner,
      run,
      runGroup,
      rerun,
      rerunFailuresInReport,
      resumeFromRun,
      cancel,
      clearError,
      dismissCompletedBanner,
      notifySavedGroupsChanged,
    ],
  );

  const liveProgressValue = useMemo<WorkflowTestLiveProgressContextValue>(
    () => ({ progress, liveResults, activityLog, latestActivity }),
    [progress, liveResults, activityLog, latestActivity],
  );

  return (
    <WorkflowTestRunStateContext.Provider value={runStateValue}>
      <WorkflowTestLiveProgressContext.Provider value={liveProgressValue}>
        {children}
      </WorkflowTestLiveProgressContext.Provider>
    </WorkflowTestRunStateContext.Provider>
  );
}

export function useWorkflowTestRunState(): WorkflowTestRunStateContextValue {
  const context = useContext(WorkflowTestRunStateContext);
  if (!context) {
    throw new Error(
      "useWorkflowTestRunState must be used within WorkflowTestRunnerProvider",
    );
  }
  return context;
}

export function useWorkflowTestLiveProgress(): WorkflowTestLiveProgressContextValue {
  const context = useContext(WorkflowTestLiveProgressContext);
  if (!context) {
    throw new Error(
      "useWorkflowTestLiveProgress must be used within WorkflowTestRunnerProvider",
    );
  }
  return context;
}

export function useWorkflowTestRunner(): WorkflowTestRunnerContextValue {
  const runState = useWorkflowTestRunState();
  const liveProgress = useWorkflowTestLiveProgress();
  return useMemo(
    () => ({ ...runState, ...liveProgress }),
    [runState, liveProgress],
  );
}
