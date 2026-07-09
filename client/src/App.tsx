import { useCallback, useEffect, useRef, useState } from "react";
import { Navigate, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import {
  createConversation,
  deleteConversation,
  fetchMessages,
  fetchMe,
  listConversations,
  listDatabases,
  listAgents,
  login,
  logout,
  sendMessage,
  type ChatMessage,
  type Conversation,
  type User,
  type UserAgent,
  type UserDatabase,
} from "./api";
import type { AgentEvent } from "./types/agentEvents";
import {
  applyAgentEvent,
  initialStreamProgress,
  type StreamProgressState,
} from "./lib/agentStreamProgress";
import { AppShell, MainContent } from "./components/layout/AppShell";
import { AppLoadingSkeleton } from "./components/layout/AppLoadingSkeleton";
import { DbSubtitle, TopBar } from "./components/layout/TopBar";
import { ChatWindow } from "./components/ChatWindow";
import { DebugPanel } from "./components/DebugPanel";
import { LoginForm } from "./components/LoginForm";
import { SettingsPage } from "./components/SettingsPage";
import { WorkflowTestPage } from "./components/WorkflowTestPage";
import { WorkflowTestGlobalStatus } from "./components/workflow-test/WorkflowTestGlobalStatus";
import { Sidebar } from "./components/Sidebar";
import { WorkflowTestRunnerProvider } from "./context/WorkflowTestRunnerContext";
import { Alert } from "./components/ui/Alert";
import { Button } from "./components/ui/Button";
import { EmptyState } from "./components/ui/EmptyState";
import { useIsDesktop, useIsTabletUp } from "./lib/useMediaQuery";
import { useAbortOnPageLeave } from "./lib/useAbortOnPageLeave";
import { MessageSquarePlus } from "lucide-react";

function AuthenticatedApp({
  user,
  onLogout,
}: {
  user: User;
  onLogout: () => Promise<void>;
}) {
  const navigate = useNavigate();
  const location = useLocation();
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeConversationId, setActiveConversationId] = useState<
    string | null
  >(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [streamingContent, setStreamingContent] = useState("");
  const [streamProgress, setStreamProgress] = useState<StreamProgressState>(
    initialStreamProgress(),
  );
  const [liveStreamEvents, setLiveStreamEvents] = useState<AgentEvent[]>([]);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [activeDatabase, setActiveDatabase] = useState<UserDatabase | null>(
    null,
  );
  const [activeAgent, setActiveAgent] = useState<UserAgent | null>(null);
  const [lastDebug, setLastDebug] = useState<Record<string, unknown> | null>(
    null,
  );
  const [activeRequestId, setActiveRequestId] = useState<string | null>(null);
  const [showDebug, setShowDebug] = useState(true);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [debugSheetOpen, setDebugSheetOpen] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const isDesktop = useIsDesktop();
  const isTabletUp = useIsTabletUp();
  const isChat = location.pathname.startsWith("/chat");
  const isSettings = location.pathname.startsWith("/settings");
  const isTests = location.pathname.startsWith("/tests");
  const chatMatch = location.pathname.match(/^\/chat(?:\/([^/]+))?$/);
  const urlConversationId = chatMatch?.[1] ?? null;

  useAbortOnPageLeave(() => abortRef.current);

  const activeConversation =
    conversations.find((c) => c.id === activeConversationId) ?? null;

  const refreshConversations = useCallback(async () => {
    const list = await listConversations();
    setConversations(list);
    return list;
  }, []);

  const refreshDatabase = useCallback(async () => {
    try {
      const data = await listDatabases();
      const active =
        data.databases.find((d) => d.id === data.activeDatabaseId) ?? null;
      setActiveDatabase(active);
    } catch {
      setActiveDatabase(null);
    }
  }, []);

  const refreshAgent = useCallback(async () => {
    try {
      const data = await listAgents();
      const active =
        data.agents.find((a) => a.id === data.activeAgentId) ?? null;
      setActiveAgent(active);
    } catch {
      setActiveAgent(null);
    }
  }, []);

  const ensureActiveConversation = useCallback(
    async (list: Conversation[]) => {
      if (list.length === 0) {
        const conversation = await createConversation();
        setConversations([conversation]);
        setActiveConversationId(conversation.id);
        return conversation;
      }
      setActiveConversationId((current) => current ?? list[0].id);
      return list[0];
    },
    [],
  );

  useEffect(() => {
    if (location.pathname === "/") {
      navigate("/chat", { replace: true });
      return;
    }
    if (location.pathname === "/test" || location.pathname === "/workflow-test") {
      navigate("/tests", { replace: true });
      return;
    }
    if (location.pathname === "/settings") {
      navigate("/settings/database", { replace: true });
      return;
    }
    if (!isChat && !isSettings && !isTests) {
      navigate("/chat", { replace: true });
    }
  }, [location.pathname, navigate, isChat, isSettings, isTests]);

  useEffect(() => {
    if (urlConversationId && urlConversationId !== activeConversationId) {
      setActiveConversationId(urlConversationId);
    }
  }, [urlConversationId, activeConversationId]);

  useEffect(() => {
    if (location.pathname === "/chat" && activeConversationId && !urlConversationId) {
      navigate(`/chat/${activeConversationId}`, { replace: true });
    }
  }, [location.pathname, activeConversationId, urlConversationId, navigate]);

  useEffect(() => {
    let cancelled = false;

    async function initWorkspace() {
      try {
        await Promise.all([refreshDatabase(), refreshAgent()]);
        const list = await refreshConversations();
        await ensureActiveConversation(list);
      } catch (err) {
        if (!cancelled) {
          setError(
            err instanceof Error ? err.message : "Failed to load workspace.",
          );
        }
      }
    }

    void initWorkspace();
    return () => {
      cancelled = true;
    };
  }, [refreshConversations, refreshDatabase, refreshAgent, ensureActiveConversation]);

  useEffect(() => {
    if (!activeConversationId || !isChat) {
      return;
    }

    setLoadingMessages(true);
    setStreamingContent("");
    setStreamProgress(initialStreamProgress());
    setLiveStreamEvents([]);
    setError(null);
    setMessages([]);

    fetchMessages(activeConversationId)
      .then((loaded) => {
        setMessages(loaded);
        const lastAssistant = [...loaded]
          .reverse()
          .find((m) => m.role === "assistant" && m.debugData);
        if (lastAssistant?.debugData) {
          setLastDebug(lastAssistant.debugData as Record<string, unknown>);
        } else {
          setLastDebug(null);
          setActiveRequestId(null);
        }
      })
      .catch((err) =>
        setError(
          err instanceof Error ? err.message : "Failed to load messages.",
        ),
      )
      .finally(() => setLoadingMessages(false));
  }, [activeConversationId, isChat]);

  async function handleLogout() {
    await onLogout();
  }

  async function handleNewConversation() {
    const conversation = await createConversation();
    const withCount = {
      ...conversation,
      _count: conversation._count ?? { messages: 0 },
    };
    setConversations((prev) => [withCount, ...prev]);
    setActiveConversationId(withCount.id);
    setError(null);
    navigate(`/chat/${withCount.id}`);
    setSidebarOpen(false);
  }

  async function handleDeleteConversation(id: string) {
    await deleteConversation(id);
    const list = await refreshConversations();
    if (list.length === 0) {
      setActiveConversationId(null);
      setMessages([]);
      navigate("/chat");
      return;
    }
    if (activeConversationId === id) {
      setActiveConversationId(list[0].id);
      navigate(`/chat/${list[0].id}`);
    }
  }

  async function handleSend(query: string, dryRun: boolean) {
    if (!activeConversationId) return;
    if (!activeDatabase) {
      setError("Configure a database connection in Settings before chatting.");
      return;
    }

    setSending(true);
    setStreamingContent("");
    setStreamProgress(initialStreamProgress());
    setLiveStreamEvents([]);
    setError(null);

    const optimistic: ChatMessage = {
      id: `temp-${Date.now()}`,
      role: "user",
      content: query,
      generatedSql: null,
      createdAt: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, optimistic]);

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      await sendMessage(
        activeConversationId,
        query,
        dryRun,
        {
        onStatus: (meta) => {
          if (meta.requestId) setActiveRequestId(meta.requestId);
          if (meta.message) {
            setStreamProgress((prev) => ({
              ...prev,
              showProgress: true,
              currentLabel: meta.message,
              thinking: false,
            }));
          }
        },
        onAgentEvent: (event) => {
          setLiveStreamEvents((prev) => [...prev, event]);
          setStreamProgress((prev) => applyAgentEvent(prev, event));
        },
        onToken: (text) => {
          setStreamProgress((prev) =>
            applyAgentEvent(prev, { type: "token", content: text }),
          );
          setStreamingContent((prev) => prev + text);
        },
        onDone: async (meta) => {
          setStreamingContent("");
          setStreamProgress((prev) => ({ ...prev, streaming: false }));
          setActiveRequestId(meta.requestId ?? null);
          if (meta.debug) setLastDebug(meta.debug);
          const updated = await fetchMessages(activeConversationId);
          setMessages(updated);
          await refreshConversations();
        },
        onError: (message) => setError(message),
      },
        {
          debug: showDebug,
        },
        controller.signal,
      );
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") {
        setStreamingContent("");
        setStreamProgress(initialStreamProgress());
        setLiveStreamEvents([]);
        try {
          const updated = await fetchMessages(activeConversationId);
          setMessages(updated);
        } catch {
          // Keep optimistic user message if sync fails.
        }
      } else {
        setError(err instanceof Error ? err.message : "Failed to send message.");
        setMessages((prev) => prev.filter((m) => m.id !== optimistic.id));
      }
    } finally {
      setSending(false);
      setStreamingContent("");
      setStreamProgress((prev) => ({ ...prev, streaming: false }));
    }
  }

  function handleToggleDebug() {
    setShowDebug((current) => {
      const next = !current;
      if (next && !isDesktop) {
        setDebugSheetOpen(true);
      }
      if (!next) {
        setDebugSheetOpen(false);
      }
      return next;
    });
  }

  function handleSelectConversation(id: string) {
    setActiveConversationId(id);
    navigate(`/chat/${id}`);
    setSidebarOpen(false);
  }

  const openWorkflowTest = () => {
    navigate("/tests");
    setSidebarOpen(false);
  };

  const sidebarNode = (
    <Sidebar
      user={user}
      search={search}
      onSearchChange={setSearch}
      conversations={conversations}
      activeId={activeConversationId}
      onSelect={handleSelectConversation}
      onNew={handleNewConversation}
      onDelete={handleDeleteConversation}
      onLogout={handleLogout}
      onOpenSettings={() => {
        navigate("/settings/database");
        setSidebarOpen(false);
      }}
      onOpenWorkflowTest={openWorkflowTest}
    />
  );

  const debugNode = (
    <DebugPanel
      lastDebug={lastDebug}
      activeRequestId={activeRequestId}
      isRunning={sending}
      liveStreamEvents={liveStreamEvents}
      compact={!isDesktop}
    />
  );

  return (
    <WorkflowTestRunnerProvider dbConfigured={!!activeDatabase}>
      <Routes>
        <Route path="/" element={<Navigate to="/chat" replace />} />
        <Route path="/test" element={<Navigate to="/tests" replace />} />
        <Route path="/workflow-test" element={<Navigate to="/tests" replace />} />
        <Route path="/settings" element={<Navigate to="/settings/database" replace />} />
      </Routes>
      <AppShell
        sidebar={sidebarNode}
        showDebug={isChat && showDebug}
        debugPanel={isChat ? debugNode : undefined}
        sidebarOpen={sidebarOpen}
        onSidebarOpenChange={setSidebarOpen}
        debugSheetOpen={debugSheetOpen}
        onDebugSheetOpenChange={(open) => {
          setDebugSheetOpen(open);
          if (!open && !isDesktop) {
            setShowDebug(false);
          }
        }}
        main={
          <MainContent>
            <WorkflowTestGlobalStatus onOpenWorkflowTest={openWorkflowTest} />
            {isSettings ? (
            <SettingsPage
              user={user}
              onBack={() => navigate("/chat")}
              onDatabaseChange={refreshDatabase}
              onAgentChange={refreshAgent}
            />
          ) : isTests ? (
            <WorkflowTestPage
              onBack={() => navigate("/chat")}
              dbConfigured={!!activeDatabase}
              onOpenSettings={() => navigate("/settings/database")}
            />
          ) : (
            <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
              <TopBar
                title={activeConversation?.title ?? "Conversation"}
                subtitle={
                  <DbSubtitle
                    name={activeDatabase?.name}
                    dbType={activeDatabase?.dbType}
                    schemaSyncStatus={activeDatabase?.schemaSyncStatus}
                    schemaTableCount={activeDatabase?.schemaTableCount}
                    hasBusinessContext={activeDatabase?.hasBusinessContext}
                    activeAgentName={activeAgent?.name}
                    agentHasSystemPrompt={activeAgent?.hasSystemPrompt}
                    onConfigure={() => navigate("/settings/database")}
                  />
                }
                showMenuButton={!isTabletUp}
                onMenuClick={() => setSidebarOpen(true)}
                showDebug={isChat}
                onToggleDebug={handleToggleDebug}
                debugOpen={showDebug && (isDesktop || debugSheetOpen)}
              />

              {error && (
                <div className="shrink-0 px-4 pt-4 md:px-6">
                  <Alert variant="error" onDismiss={() => setError(null)}>
                    {error.includes("Configure a database") ? (
                      <>
                        Configure a database connection in{" "}
                        <button
                          type="button"
                          onClick={() => navigate("/settings/database")}
                          className="font-medium underline underline-offset-2 focus-ring rounded-sm"
                        >
                          Settings
                        </button>{" "}
                        before chatting.
                      </>
                    ) : (
                      error
                    )}
                  </Alert>
                </div>
              )}

              {activeConversation ? (
                <ChatWindow
                  messages={messages}
                  loadingMessages={loadingMessages}
                  onSend={handleSend}
                  sending={sending}
                  streamingContent={streamingContent}
                  streamProgress={streamProgress}
                  dbConfigured={!!activeDatabase}
                  onOpenSettings={() => navigate("/settings/database")}
                  onSelectDebug={(debug) => {
                    setLastDebug(debug);
                    setShowDebug(true);
                    if (!isDesktop) setDebugSheetOpen(true);
                  }}
                  selectedDebugRequestId={
                    typeof lastDebug?.requestId === "string"
                      ? lastDebug.requestId
                      : null
                  }
                />
              ) : (
                <EmptyState
                  icon={MessageSquarePlus}
                  title="Start a conversation"
                  description="Create a new conversation to begin querying your database with natural language."
                  action={
                    <Button type="button" onClick={handleNewConversation}>
                      New conversation
                    </Button>
                  }
                  className="flex-1"
                />
              )}
            </div>
          )}
          </MainContent>
        }
      />
    </WorkflowTestRunnerProvider>
  );
}

export default function App() {
  const navigate = useNavigate();
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function initSession() {
      try {
        const u = await fetchMe();
        if (!cancelled) setUser(u);
      } catch {
        if (!cancelled) setUser(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void initSession();
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleLogin(email: string, password: string) {
    const u = await login(email, password);
    setUser(u);
    navigate("/chat");
  }

  async function handleLogout() {
    await logout();
    setUser(null);
  }

  if (loading) {
    return <AppLoadingSkeleton />;
  }

  if (!user) {
    return <LoginForm onLogin={handleLogin} />;
  }

  return <AuthenticatedApp user={user} onLogout={handleLogout} />;
}
