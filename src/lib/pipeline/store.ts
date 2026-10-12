import type { pipelineDb } from "@/lib/db/pipelineDb";

/**
 * The slice of pipelineDb the per-VC task and orchestrator use. A type (not an import of values) so tests can pass an
 * in-memory fake, and so pipeline code depends on the narrow pipeline-only database surface.
 */
export type PipelineStore = Pick<
  typeof pipelineDb,
  | "listVcs" | "getCompanyProfile" | "getRun" | "startRun" | "finalizeRun" | "claimRunTasks" | "ensureTasks" | "taskCounts" | "taskStats"
  | "finishTask" | "knownCandidateUrls" | "upsertCandidate" | "updateCandidate" | "upsertSignal" | "signalsInWindow" | "insertRecommendation"
  | "applyAssessment" | "recordSourceHealth" | "llmTotals" | "findRunningRun" | "failExhaustedTasks" | "digestSnapshot" | "getDigestByKey" | "insertDigest" | "insertDigestItems" | "updateDigestStatus"
>;
