'use server';
import { revalidatePath } from 'next/cache';
import * as store from '@/lib/store.mjs';

function load({ slug, cid, bid }) {
  const project = store.getProject(slug);
  const commit = project && store.getCommit(slug, cid);
  const block = commit?.blocks.find((b) => b.id === bid);
  if (!block) throw new Error('블록을 찾을 수 없습니다');
  return { project, commit, block };
}

// "AI 작성": 에이전트에게 작성을 맡긴다. 에이전트가 hf apply 로 반영하고 hf done 으로 끝을 알리면
// 블록이 Done 으로 바뀐다. 그 사이에는 AI Writing.
function askAi(slug, commit, blocks) {
  // 받을 에이전트가 없으면 "AI Writing" 에 갇힌다 — 버튼도 막혀 있지만 서버에서도 거절
  if (!blocks.length || store.agentStatus(slug).state === 'off') return;
  for (const b of blocks) b.aiPending = true;
  store.saveCommit(slug, commit);
  store.appendInbox(slug, { from: 'user', type: 'ai-write', commit: commit.id, blocks: blocks.map((b) => b.id), files: blocks.map((b) => b.file) });
  revalidatePath(`/p/${slug}`);
}

export async function requestAiWrite(ids) {
  const { commit, block } = load(ids);
  askAi(ids.slug, commit, block.done || block.aiPending ? [] : [block]);
}

// "AI 전체 구현": 남은 블록(완료·작업 중·적용 불가 제외)을 한 번에 맡긴다
export async function requestAiWriteAll({ slug, cid }) {
  const project = store.getProject(slug);
  const commit = project && store.getCommit(slug, cid);
  if (!commit) throw new Error('커밋을 찾을 수 없습니다');
  askAi(slug, commit, commit.blocks.filter((b) => !b.done && !b.aiPending && !store.blockState(project.root, b).stale));
}

export async function toggleDone(ids) {
  const { commit, block } = load(ids);
  block.done = !block.done;
  block.aiPending = false; // 사람이 직접 완료를 정하면 AI 대기는 끝
  store.saveCommit(ids.slug, commit);
  store.appendInbox(ids.slug, { from: 'user', type: block.done ? 'done' : 'undone', commit: ids.cid, block: ids.bid, file: block.file });
  revalidatePath(`/p/${ids.slug}`);
}

// 수정 요청: 에이전트는 답글 대신 이 단계의 코드를 고쳐(hf post --amend) 화면에 바로 반영한다.
export async function sendRequest(ids, form) {
  const text = String(form.get('text') ?? '').trim();
  if (!text || !store.getProject(ids.slug)) return;
  store.appendInbox(ids.slug, { from: 'user', type: 'request', commit: ids.cid, text });
  revalidatePath(`/p/${ids.slug}`);
}
