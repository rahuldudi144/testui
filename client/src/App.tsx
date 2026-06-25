import { useCallback, useEffect, useState } from "react";
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
import { MessageSquarePlus } from "lucide-react";

type AppView = "chat" | "settings" | "workflowTest";

export default function App() {
  const [view, setView] = useState<AppView>("chat");
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
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

  const isDesktop = useIsDesktop();
  const isTabletUp = useIsTabletUp();

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
    let cancelled = false;

    async function initSession() {
      try {
        const u = await fetchMe();
        if (cancelled) return;
        setUser(u);
        if (!u) return;

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
  }, [refreshConversations, refreshDatabase, refreshAgent, ensureActiveConversation]);

  useEffect(() => {
    if (!activeConversationId || view !== "chat") {
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
  }, [activeConversationId, view]);

  async function handleLogin(email: string, password: string) {
    const u = await login(email, password);
    setUser(u);
    await refreshDatabase();
    const list = await refreshConversations();
    await ensureActiveConversation(list);
    setView("chat");
  }

  async function handleLogout() {
    await logout();
    setUser(null);
    setConversations([]);
    setActiveConversationId(null);
    setMessages([]);
    setSearch("");
    setActiveDatabase(null);
    setLastDebug(null);
    setView("chat");
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
    setView("chat");
    setSidebarOpen(false);
  }

  async function handleDeleteConversation(id: string) {
    await deleteConversation(id);
    const list = await refreshConversations();
    if (list.length === 0) {
      setActiveConversationId(null);
      setMessages([]);
      return;
    }
    if (activeConversationId === id) {
      setActiveConversationId(list[0].id);
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

    try {
      await sendMessage(activeConversationId, query, dryRun, {
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
      }, {
        debug: showDebug,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to send message.");
      setMessages((prev) => prev.filter((m) => m.id !== optimistic.id));
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
    setView("chat");
    setSidebarOpen(false);
  }

  if (loading) {
    return <AppLoadingSkeleton />;
  }

  if (!user) {
    return <LoginForm onLogin={handleLogin} />;
  }

  const openWorkflowTest = () => {
    setView("workflowTest");
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
        setView("settings");
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
      <AppShell
        sidebar={sidebarNode}
        showDebug={view === "chat" && showDebug}
        debugPanel={view === "chat" ? debugNode : undefined}
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
            {view === "settings" ? (
            <SettingsPage
              user={user}
              onBack={() => setView("chat")}
              onDatabaseChange={refreshDatabase}
              onAgentChange={refreshAgent}
            />
          ) : view === "workflowTest" ? (
            <WorkflowTestPage
              onBack={() => setView("chat")}
              dbConfigured={!!activeDatabase}
              onOpenSettings={() => setView("settings")}
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
                    onConfigure={() => setView("settings")}
                  />
                }
                showMenuButton={!isTabletUp}
                onMenuClick={() => setSidebarOpen(true)}
                showDebug={view === "chat"}
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
                          onClick={() => setView("settings")}
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
                  onOpenSettings={() => setView("settings")}
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
