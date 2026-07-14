import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { canonicalHash, createCanonRevisionStore } from './canon-revision.mjs';

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'canon-revision-smoke-'));
let tick = 0;
const clock = () => new Date(Date.UTC(2026, 6, 14, 0, 0, tick++));
const store = createCanonRevisionStore({ dataDir: root, clock, randomUUID: () => '11111111-2222-4333-8444-555555555555' });
const projectId = 'fixture-book';
const hashA = canonicalHash('chapter-4');
const hashB = canonicalHash('tracking-4');
const baseInput = {
  projectId,
  expectedParentRevisionId: null,
  chapter: 4,
  checkpointId: 'checkpoint-004',
  runId: 'run_20260714000000_abcdef1234567890',
  idempotencyKey: 'writeback:checkpoint-004',
  sourceHashes: [
    { path: '正文/第4章 山门来客.md', hash: hashA },
    { path: '追踪/上下文.md', hash: hashB },
  ],
  acceptedFactDiffs: [
    { operation: 'confirm', kind: 'chapter', subject: '第4章', predicate: '正式正文', after: '由作者确认候选晋升', sourceChapter: 4 },
    { operation: 'update', kind: 'character', subject: '林渊', predicate: '状态', before: '藏拙', after: '继续隐藏境界' },
  ],
  rejectedFactDiffs: [{ operation: 'confirm', kind: 'diagnostic', subject: '来客身份', predicate: '是否进入正式事实', after: '否', reason: '仍待作者裁决' }],
  affectedEntities: ['第4章', '林渊', '神秘来客'],
  metadata: { checkpointStatus: 'committed', formalWritePerformed: true },
};

assert.equal(await store.getHead(projectId), null);
await assert.rejects(() => fs.access(path.join(root, 'canon-revisions')), (error) => error?.code === 'ENOENT', '只读查询不得创建 Canon 目录');
const first = await store.commitRevision(baseInput);
assert.equal(first.idempotent, false);
assert.equal(first.revision.parentRevisionId, null);
assert.equal(first.revision.chapter, 4);
assert.equal(first.revision.sourceHashes.length, 2);
assert.equal(first.head.revisionId, first.revision.revisionId);
assert.match(first.revision.digest, /^[a-f0-9]{64}$/);

const loaded = await store.getRevision(projectId, first.revision.revisionId);
assert.deepEqual(loaded, first.revision);
assert.equal((await store.listRevisions(projectId)).length, 1);
assert.equal((await store.getHead(projectId)).revisionId, first.revision.revisionId);

const duplicate = await store.commitRevision(baseInput);
assert.equal(duplicate.idempotent, true);
assert.equal(duplicate.revision.revisionId, first.revision.revisionId);
assert.equal((await store.listRevisions(projectId)).length, 1, '重复 checkpoint 不应制造重复修订');

await assert.rejects(
  () => store.commitRevision({ ...baseInput, checkpointId: 'checkpoint-005', idempotencyKey: 'writeback:checkpoint-005', chapter: 5 }),
  (error) => error?.code === 'CANON_HEAD_CONFLICT' && error?.status === 409,
  '过期父版本必须被乐观锁阻塞',
);

const second = await store.commitRevision({
  ...baseInput,
  expectedParentRevisionId: first.revision.revisionId,
  checkpointId: 'checkpoint-005',
  idempotencyKey: 'writeback:checkpoint-005',
  chapter: 5,
  sourceHashes: [{ path: '正文/第5章.md', hash: canonicalHash('chapter-5') }],
  acceptedFactDiffs: [{ operation: 'add', kind: 'timeline', subject: '第5章', predicate: '事件', after: '来客第一次出手' }],
});
assert.equal(second.revision.parentRevisionId, first.revision.revisionId);
assert.equal((await store.listRevisions(projectId)).length, 2);

const revisionFile = path.join(root, 'canon-revisions', projectId, 'revisions', `${first.revision.revisionId}.json`);
await assert.rejects(() => fs.writeFile(revisionFile, '{}', { flag: 'wx' }), (error) => error?.code === 'EEXIST', 'revision 文件必须不可覆盖');
await assert.rejects(() => store.getHead('../escape'), (error) => error?.code === 'INVALID_PROJECT_ID');
await assert.rejects(
  () => store.commitRevision({ ...baseInput, projectId: 'other-book', sourceHashes: [{ path: '../secret', hash: hashA }] }),
  (error) => error?.code === 'CANON_SOURCE_HASHES_REQUIRED',
  '路径穿越不得进入来源哈希',
);

const orphanProject = 'orphan-book';
const orphanInput = { ...baseInput, projectId: orphanProject, checkpointId: 'checkpoint-orphan', idempotencyKey: 'writeback:orphan' };
const orphanFirst = await store.commitRevision(orphanInput);
await fs.unlink(path.join(root, 'canon-revisions', orphanProject, 'head.json'));
const recovered = await store.commitRevision(orphanInput);
assert.equal(recovered.idempotent, true);
assert.equal(recovered.recoveredOrphan, true);
assert.equal(recovered.revision.revisionId, orphanFirst.revision.revisionId);

await fs.rm(root, { recursive: true, force: true });
console.log('canon revision smoke passed');