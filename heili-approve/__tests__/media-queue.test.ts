import { beforeEach, expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({ owned: vi.fn(), upsert: vi.fn(), update: vi.fn(), pending: vi.fn(), failed: vi.fn(), attempts: vi.fn(), add: vi.fn(), options: vi.fn() }));
vi.mock("@/lib/db/client", () => ({ prisma: { mediaAsset: { findFirst: mock.owned }, mediaAnalysis: { upsert: mock.upsert, updateMany: mock.update, findMany: (args: { where: { status: string } }) => (args.where.status === "FAILED" ? mock.failed(args) : mock.pending(args)) }, mediaAnalysisAttempt: { count: mock.attempts } } }));
vi.mock("@/lib/queue/client", () => ({ getRedisConnection: () => ({}) }));
vi.mock("bullmq", () => ({ Queue: class { constructor(_name: string, options: unknown) { mock.options(options); } add = mock.add; } }));
import { MAX_PROVIDER_ATTEMPTS, queueAssetAnalysis, sweepPendingAnalyses } from "@/lib/media-analysis/queue";
import { ANALYSIS_REVISION } from "@/lib/media-analysis/spec";
beforeEach(() => { vi.clearAllMocks(); vi.stubEnv("MEDIA_ANALYSIS_ENABLED", "true"); vi.stubEnv("QWEN_API_KEY", "test"); mock.owned.mockResolvedValue({ id: "asset" }); mock.pending.mockResolvedValue([{ assetId: "asset", asset: { workspaceId: "work" } }]); mock.failed.mockResolvedValue([]); mock.attempts.mockResolvedValue(0); });
it("persists only authorized assets and resets obsolete revisions without Redis", async () => {
  await queueAssetAnalysis({ assetId: "asset", workspaceId: "work" });
  expect(mock.owned).toHaveBeenCalledWith({ where: { id: "asset", workspaceId: "work" }, select: { id: true } });
  expect(mock.update).toHaveBeenCalledWith(expect.objectContaining({ where: { assetId: "asset", revision: { not: ANALYSIS_REVISION }, status: { not: "PROCESSING" } }, data: expect.objectContaining({ revision: ANALYSIS_REVISION, status: "PENDING" }) }));
  expect(mock.add).not.toHaveBeenCalled();
  mock.owned.mockResolvedValue(null); mock.upsert.mockClear();
  await queueAssetAnalysis({ assetId: "asset", workspaceId: "other" }); expect(mock.upsert).not.toHaveBeenCalled();
});
it("recovers unclaimed jobs after Redis failures, without retrying uncertain processing outcomes", async () => {
  await sweepPendingAnalyses();
  expect(mock.options).toHaveBeenCalledWith(expect.objectContaining({ defaultJobOptions: { attempts: 1, removeOnComplete: true, removeOnFail: true } }));
  expect(mock.update).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ status: "PROCESSING" }), data: { status: "FAILED", failureCode: "interrupted" } }));
  expect(mock.add).toHaveBeenCalledWith("analyze", { assetId: "asset", workspaceId: "work" }, { jobId: `media_asset_${ANALYSIS_REVISION}` });
});
it("retries provider-side failures (retired model, outage) after a pause, at most a few billed attempts", async () => {
  mock.failed.mockResolvedValue([{ assetId: "retired-model" }, { assetId: "exhausted" }]);
  mock.attempts.mockImplementation(({ where }: { where: { assetId: string } }) => Promise.resolve(where.assetId === "exhausted" ? MAX_PROVIDER_ATTEMPTS : 1));
  await sweepPendingAnalyses();
  expect(mock.failed).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ status: "FAILED", failureCode: { in: expect.arrayContaining(["vision-http-404", "vision-http-503"]) } }) }));
  expect(mock.update).toHaveBeenCalledWith({ where: { assetId: "retired-model", status: "FAILED" }, data: { status: "PENDING", failureCode: null, startedAt: null } });
  expect(mock.update).not.toHaveBeenCalledWith(expect.objectContaining({ where: { assetId: "exhausted", status: "FAILED" } }));
});
