-- CreateEnum
CREATE TYPE "WorkflowTestGroupKind" AS ENUM ('manual', 'failures');

-- CreateTable
CREATE TABLE "WorkflowTestGroup" (
    "id" TEXT NOT NULL,
    "workflowTestId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "WorkflowTestGroupKind" NOT NULL DEFAULT 'manual',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkflowTestGroup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkflowTestQuery" (
    "id" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "query" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "sourceRunId" TEXT,
    "sourceGroupName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WorkflowTestQuery_pkey" PRIMARY KEY ("id")
);

-- Migrate legacy JSON groups into relational tables
DO $$
DECLARE
    test_row RECORD;
    group_item JSONB;
    group_name TEXT;
    group_queries JSONB;
    query_item JSONB;
    new_group_id TEXT;
    group_sort INTEGER;
    query_sort INTEGER;
BEGIN
    FOR test_row IN SELECT id, groups FROM "WorkflowTest" LOOP
        group_sort := 0;

        IF jsonb_typeof(test_row.groups) = 'array' THEN
            FOR group_item IN SELECT * FROM jsonb_array_elements(test_row.groups) LOOP
                group_name := COALESCE(group_item->>'name', '');
                group_queries := group_item->'queries';

                IF group_name <> '' AND jsonb_typeof(group_queries) = 'array' THEN
                    new_group_id := gen_random_uuid()::text;

                    INSERT INTO "WorkflowTestGroup" (
                        "id", "workflowTestId", "name", "kind", "sortOrder", "updatedAt"
                    ) VALUES (
                        new_group_id,
                        test_row.id,
                        group_name,
                        'manual',
                        group_sort,
                        CURRENT_TIMESTAMP
                    );

                    query_sort := 0;
                    FOR query_item IN SELECT * FROM jsonb_array_elements(group_queries) LOOP
                        IF jsonb_typeof(query_item) = 'string' AND length(query_item #>> '{}') > 0 THEN
                            INSERT INTO "WorkflowTestQuery" (
                                "id", "groupId", "query", "sortOrder"
                            ) VALUES (
                                gen_random_uuid()::text,
                                new_group_id,
                                query_item #>> '{}',
                                query_sort
                            );
                            query_sort := query_sort + 1;
                        END IF;
                    END LOOP;

                    group_sort := group_sort + 1;
                END IF;
            END LOOP;
        END IF;

        INSERT INTO "WorkflowTestGroup" (
            "id", "workflowTestId", "name", "kind", "sortOrder", "updatedAt"
        ) VALUES (
            gen_random_uuid()::text,
            test_row.id,
            'Failed queries',
            'failures',
            9999,
            CURRENT_TIMESTAMP
        );
    END LOOP;
END $$;

-- AlterTable
ALTER TABLE "WorkflowTest" DROP COLUMN "groups";

-- CreateIndex
CREATE INDEX "WorkflowTestGroup_workflowTestId_sortOrder_idx" ON "WorkflowTestGroup"("workflowTestId", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "WorkflowTestGroup_one_failures_per_test" ON "WorkflowTestGroup"("workflowTestId") WHERE "kind" = 'failures';

-- CreateIndex
CREATE INDEX "WorkflowTestQuery_groupId_sortOrder_idx" ON "WorkflowTestQuery"("groupId", "sortOrder");

-- AddForeignKey
ALTER TABLE "WorkflowTestGroup" ADD CONSTRAINT "WorkflowTestGroup_workflowTestId_fkey" FOREIGN KEY ("workflowTestId") REFERENCES "WorkflowTest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkflowTestQuery" ADD CONSTRAINT "WorkflowTestQuery_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "WorkflowTestGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkflowTestQuery" ADD CONSTRAINT "WorkflowTestQuery_sourceRunId_fkey" FOREIGN KEY ("sourceRunId") REFERENCES "WorkflowTestRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;
