import { describe, expect, test } from "bun:test";
import {
  parseEntitiesFromDebug,
  parseJoinPathsFromDebug,
  parseOperationsFromDebug,
} from "../client/src/components/debug/nodeDebugState";
import {
  flattenRelationshipGraph,
  isRelationshipGraph,
  parseRelationshipGraphFromDebug,
  relationshipGraphStats,
} from "../client/src/components/debug/relationshipGraph";
import { layoutRelationshipGraph } from "../client/src/components/debug/relationshipGraphLayout";

const sampleGraph = {
  Enrollment: [
    {
      fromTable: "Enrollment",
      fromColumn: "courseId",
      toTable: "Course",
      toColumn: "id",
    },
  ],
  Course: [
    {
      fromTable: "Course",
      fromColumn: "instructorId",
      toTable: "User",
      toColumn: "id",
    },
  ],
};

describe("relationshipGraph debug helpers", () => {
  test("isRelationshipGraph accepts adjacency lists", () => {
    expect(isRelationshipGraph(sampleGraph)).toBe(true);
    expect(isRelationshipGraph({})).toBe(false);
    expect(isRelationshipGraph(null)).toBe(false);
  });

  test("flattenRelationshipGraph returns sorted edges", () => {
    const edges = flattenRelationshipGraph(sampleGraph);
    expect(edges).toHaveLength(2);
    expect(edges[0]?.fromTable).toBe("Course");
    expect(edges[1]?.toTable).toBe("Course");
  });

  test("relationshipGraphStats counts tables and edges", () => {
    expect(relationshipGraphStats(sampleGraph)).toEqual({
      tableCount: 3,
      edgeCount: 2,
    });
  });

  test("parseRelationshipGraphFromDebug reads graphBuilder stateHistory", () => {
    const graph = parseRelationshipGraphFromDebug({
      stateHistory: [
        { step: 1, node: "planner", changes: {} },
        { step: 2, node: "graphBuilder", changes: { graph: sampleGraph } },
      ],
    });
    expect(graph).toEqual(sampleGraph);
  });

  test("parseJoinPathsFromDebug reads pathFinder stateHistory", () => {
    const joinPaths = [
      {
        leftTable: "Enrollment",
        leftColumn: "courseId",
        rightTable: "Course",
        rightColumn: "id",
      },
    ];
    expect(
      parseJoinPathsFromDebug({
        stateHistory: [{ step: 3, node: "pathFinder", changes: { joinPaths } }],
      }),
    ).toEqual(joinPaths);
  });

  test("parseOperationsFromDebug reads operationPlanner stateHistory", () => {
    const operations = ["JOIN", "GROUP_BY", "ORDER_BY"];
    expect(
      parseOperationsFromDebug({
        stateHistory: [{ step: 4, node: "operationPlanner", changes: { operations } }],
      }),
    ).toEqual(operations);
  });

  test("parseEntitiesFromDebug reads entityExtractor stateHistory", () => {
    const entities = ["Enrollment", "Course"];
    expect(
      parseEntitiesFromDebug({
        stateHistory: [{ step: 2, node: "entityExtractor", changes: { entities } }],
      }),
    ).toEqual(entities);
  });

  test("layoutRelationshipGraph produces positioned nodes and edges", () => {
    const layout = layoutRelationshipGraph(sampleGraph);
    expect(layout.nodes).toHaveLength(3);
    expect(layout.edges).toHaveLength(2);
    expect(layout.width).toBeGreaterThan(0);
    expect(layout.height).toBeGreaterThan(0);
    for (const node of layout.nodes) {
      expect(node.width).toBeGreaterThan(0);
      expect(node.x).toBeGreaterThanOrEqual(0);
      expect(node.y).toBeGreaterThanOrEqual(0);
    }

    const byLayer = new Map<number, typeof layout.nodes>();
    for (const node of layout.nodes) {
      const list = byLayer.get(node.layer) ?? [];
      list.push(node);
      byLayer.set(node.layer, list);
    }
    for (const layerNodes of byLayer.values()) {
      const sorted = [...layerNodes].sort((a, b) => a.x - b.x);
      for (let i = 1; i < sorted.length; i++) {
        const prev = sorted[i - 1]!;
        const current = sorted[i]!;
        expect(current.x).toBeGreaterThanOrEqual(prev.x + prev.width + 8);
      }
    }
  });
});
