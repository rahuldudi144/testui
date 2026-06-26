import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { prisma } from "../db.js";
import { extractSqlFromMarkdown, toAgentMessages } from "../agent.js";
import type { StateHistoryEntry } from "../../../schemas/state.js";
import {
  buildAgentRunContext,
  buildFullDebugPayload,
  createAgentRequestIds,
  invokeResultDebugFields,
} from "../buildDebugPayload.js";
import { beginRequestDebug } from "../debugCapture.js";
import { loadEnv } from "../env.js";
import {
  invokeWithHistory,
  streamAgentEvents,
} from "../runAgentWithHistory.js";
import { isPublicStreamEvent } from "../streamEventFilter.js";
import { getActiveDatabaseForUser, parseDbHost, connectionAgentMetadata } from "../userDatabase.js";
import { getActiveAgentForUser, profileAgentConfig } from "../userAgent.js";
import { countTables } from "../syncConnectionSchema.js";
import {
  generateConversationTitle,
  isDefaultConversationTitle,
} from "../conversationTitle.js";
import { authMiddleware } from "./auth.js";

type AuthUser = { id: string; username: string; createdAt: Date };

type SseStream = {
  writeSSE: (message: { event: string; data: string }) => Promise<void>;
};

const STREAM_KEEPALIVE_MS = 5_000;

function startStreamKeepAlive(
  stream: SseStream,
): ReturnType<typeof setInterval> {
  return setInterval(() => {
    void stream.writeSSE({ event: "ping", data: "{}" });
  }, STREAM_KEEPALIVE_MS);
}

export const conversationRoutes = new Hono<{ Variables: { user: AuthUser } }>();

conversationRoutes.use("*", authMiddleware);

conversationRoutes.get("/", async (c) => {
  const user = c.get("user");
  const conversations = await prisma.conversation.findMany({
    where: { userId: user.id },
    orderBy: { updatedAt: "desc" },
    select: {
      id: true,
      title: true,
      createdAt: true,
      updatedAt: true,
      _count: { select: { messages: true } },
    },
  });
  return c.json({ conversations });
});

conversationRoutes.post("/", async (c) => {
  const user = c.get("user");
  const body: { title?: string } = await c.req
    .json<{ title?: string }>()
    .catch(() => ({}));
  const conversation = await prisma.conversation.create({
    data: {
      userId: user.id,
      title: body.title?.trim() || "New conversation",
    },
    select: {
      id: true,
      title: true,
      createdAt: true,
      updatedAt: true,
      _count: { select: { messages: true } },
    },
  });
  return c.json({ conversation });
});

conversationRoutes.patch("/:id", async (c) => {
  const user = c.get("user");
  const conversationId = c.req.param("id");
  const body = await c.req.json<{ title?: string }>();
  const title = body.title?.trim();

  if (!title) {
    return c.json({ error: "A non-empty title is required." }, 400);
  }

  const existing = await prisma.conversation.findFirst({
    where: { id: conversationId, userId: user.id },
  });
  if (!existing) return c.json({ error: "Conversation not found." }, 404);

  const conversation = await prisma.conversation.update({
    where: { id: conversationId },
    data: { title },
  });
  return c.json({ conversation });
});

conversationRoutes.delete("/:id", async (c) => {
  const user = c.get("user");
  const conversationId = c.req.param("id");

  const conversation = await prisma.conversation.findFirst({
    where: { id: conversationId, userId: user.id },
  });
  if (!conversation) return c.json({ error: "Conversation not found." }, 404);

  await prisma.conversation.delete({ where: { id: conversationId } });
  return c.json({ ok: true });
});

conversationRoutes.get("/:id/messages", async (c) => {
  const user = c.get("user");
  const conversationId = c.req.param("id");

  const conversation = await prisma.conversation.findFirst({
    where: { id: conversationId, userId: user.id },
  });
  if (!conversation) return c.json({ error: "Conversation not found." }, 404);

  const messages = await prisma.message.findMany({
    where: { conversationId },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      role: true,
      content: true,
      generatedSql: true,
      debugData: true,
      createdAt: true,
    },
  });

  return c.json({ messages });
});

conversationRoutes.post("/:id/messages", async (c) => {
  const user = c.get("user");
  const conversationId = c.req.param("id");
  const body = await c.req.json<{
    query?: string;
    dryRun?: boolean;
    streamEvents?: boolean;
    debug?: boolean;
    businessContext?: string;
  }>();
  const query = body.query?.trim();
  const dryRun = body.dryRun ?? false;
  const streamEvents = body.streamEvents ?? true;
  const streamDebug = body.debug ?? false;

  if (!query) {
    return c.json({ error: "A non-empty query is required." }, 400);
  }

  const conversation = await prisma.conversation.findFirst({
    where: { id: conversationId, userId: user.id },
  });
  if (!conversation) return c.json({ error: "Conversation not found." }, 404);

  const priorRows = await prisma.message.findMany({
    where: { conversationId },
    orderBy: { createdAt: "asc" },
    select: { role: true, content: true },
  });

  await prisma.message.create({
    data: { conversationId, role: "user", content: query },
  });

  const activeDb = await getActiveDatabaseForUser(user.id);
  if (!activeDb) {
    return c.json(
      {
        error:
          "No database configured. Add a PostgreSQL or MySQL connection in the Database panel.",
      },
      400,
    );
  }

  const activeAgent = await getActiveAgentForUser(user.id);
  const runnerOptions = profileAgentConfig(activeAgent);

  const messages = toAgentMessages(priorRows);
  const dbType = activeDb.dbType as "postgres" | "mysql";
  const { requestId, correlationId } = createAgentRequestIds(conversationId);
  beginRequestDebug(requestId, correlationId);

  const dbInfo = {
    dbType: activeDb.dbType,
    name: activeDb.name,
    host: parseDbHost(activeDb.dbUri),
  };

  const env = loadEnv();
  const effectiveProvider = runnerOptions.llmProvider ?? env.DB_AGENT_LLM_PROVIDER;
  const effectiveModel = runnerOptions.modelName ?? env.DB_AGENT_MODEL_NAME;
  const agentConfig = {
    provider: effectiveProvider,
    model: effectiveModel,
    readOnly: env.DB_AGENT_READ_ONLY,
    maxValidationRetries: env.DB_AGENT_MAX_VALIDATION_RETRIES,
  };

  const agentInputBase = {
    ...connectionAgentMetadata(activeDb),
  };

  if (!streamEvents && dryRun) {
    return streamSSE(c, async (stream) => {
      const keepAlive = startStreamKeepAlive(stream);

      try {
        await stream.writeSSE({
          event: "status",
          data: JSON.stringify({ message: "processing", requestId }),
        });

        const { result, stateHistory } = await invokeWithHistory(
          dbType,
          activeDb.dbUri,
          {
            query,
            messages,
            dryRun: true,
            requestId,
            correlationId,
            ...agentInputBase,
          },
          runnerOptions,
        );

        await stream.writeSSE({
          event: "token",
          data: JSON.stringify({ text: result.markdownResponse }),
        });

        const generatedSql =
          result.generatedSql ??
          extractSqlFromMarkdown(result.markdownResponse);

        const output = invokeResultDebugFields(result);
        const runContext = buildAgentRunContext(
          query,
          true,
          messages,
          agentConfig,
          output,
        );

        const debug = buildFullDebugPayload(
          requestId,
          correlationId,
          {
            ...dbInfo,
            schemaTableCount: activeDb.dbMetadata
              ? countTables(activeDb.dbMetadata)
              : 0,
            metadataSource: activeDb.dbMetadata ? "stored" : "live",
            hasBusinessContext: Boolean(activeDb.businessContext?.trim()),
          },
          runContext,
          { generatedSql, stateHistory },
        );

        await prisma.message.create({
          data: {
            conversationId,
            role: "assistant",
            content: result.markdownResponse,
            generatedSql,
            debugData: debug,
          },
        });

        const title = isDefaultConversationTitle(conversation.title)
          ? await generateConversationTitle(
              query,
              conversationId,
              dbType,
              runnerOptions,
            )
          : conversation.title;

        await prisma.conversation.update({
          where: { id: conversationId },
          data: {
            updatedAt: new Date(),
            title,
          },
        });

        await stream.writeSSE({
          event: "done",
          data: JSON.stringify({
            requestId,
            correlationId,
            generatedSql,
            validationPassed: result.validationPassed,
            debug,
          }),
        });
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Agent request failed.";
        await stream.writeSSE({
          event: "error",
          data: JSON.stringify({ message }),
        });
      } finally {
        clearInterval(keepAlive);
      }
    });
  }

  c.header("Cache-Control", "no-cache, no-transform");
  c.header("Connection", "keep-alive");
  c.header("X-Accel-Buffering", "no");

  return streamSSE(c, async (stream) => {
    let fullResponse = "";
    const keepAlive = startStreamKeepAlive(stream);
    const collectedEvents: Array<Record<string, unknown>> = [];

    try {
      await stream.writeSSE({
        event: "status",
        data: JSON.stringify({ message: "processing", requestId }),
      });

      let stateHistory: StateHistoryEntry[] = [];
      let generatedSqlFromStream: string | undefined;
      let tokenTotals: {
        totalPromptTokens?: number;
        totalCompletionTokens?: number;
        totalTokens?: number;
      } = {};

      for await (const event of streamAgentEvents(dbType, activeDb.dbUri, {
        query,
        messages,
        dryRun,
        requestId,
        correlationId,
        ...agentInputBase,
      }, runnerOptions)) {
        collectedEvents.push(event as Record<string, unknown>);

        if (isPublicStreamEvent(event, streamDebug)) {
          await stream.writeSSE({
            event: "agent",
            data: JSON.stringify(event),
          });
        }

        if (event.type === "token") {
          fullResponse += event.content;
        }
        if (event.type === "sql_generated") {
          generatedSqlFromStream = event.sql;
        }
        if (event.type === "done" && event.stateHistory) {
          stateHistory = event.stateHistory;
          tokenTotals = {
            totalPromptTokens: event.totalPromptTokens,
            totalCompletionTokens: event.totalCompletionTokens,
            totalTokens: event.totalTokens,
          };
        }
        if (event.type === "error") {
          await stream.writeSSE({
            event: "error",
            data: JSON.stringify({ message: event.message, code: event.code }),
          });
        }
      }

      const generatedSql =
        generatedSqlFromStream ?? extractSqlFromMarkdown(fullResponse);

      const output = {
        markdownResponse: fullResponse,
        generatedSql,
        validationPassed: undefined,
        validationErrors: undefined,
        executionResult: undefined,
      };

      const runContext = buildAgentRunContext(
        query,
        dryRun,
        messages,
        agentConfig,
        output,
      );

      const debugPayload = buildFullDebugPayload(
        requestId,
        correlationId,
        {
          ...dbInfo,
          schemaTableCount: activeDb.dbMetadata
            ? countTables(activeDb.dbMetadata)
            : 0,
          metadataSource: activeDb.dbMetadata ? "stored" : "live",
          hasBusinessContext: Boolean(activeDb.businessContext?.trim()),
        },
        runContext,
        { generatedSql, stateHistory, streamEvents: collectedEvents, ...tokenTotals },
      );

      await prisma.message.create({
        data: {
          conversationId,
          role: "assistant",
          content: fullResponse,
          generatedSql,
          debugData: debugPayload,
        },
      });

      const title = isDefaultConversationTitle(conversation.title)
        ? await generateConversationTitle(
            query,
            conversationId,
            dbType,
            runnerOptions,
          )
        : conversation.title;

      await prisma.conversation.update({
        where: { id: conversationId },
        data: {
          updatedAt: new Date(),
          title,
        },
      });

      await stream.writeSSE({
        event: "done",
        data: JSON.stringify({
          requestId,
          correlationId,
          generatedSql,
          debug: debugPayload,
          ...tokenTotals,
        }),
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Agent request failed.";
      await stream.writeSSE({
        event: "error",
        data: JSON.stringify({ message }),
      });
    } finally {
      clearInterval(keepAlive);
    }
  });
});
