#!/usr/bin/env node
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as store from '../lib/store.mjs';

const APP = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const [cmd, ...args] = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : def;
};
const PORT = opt('port', process.env.HF_PORT || '4100');
const fail = (msg) => { console.error(`hfl: ${msg}`); process.exit(1); };
const git = (gitArgs, cwd) => {
  try { return execFileSync('git', gitArgs, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { return ''; }
};
const root = () => path.resolve(opt('root', git(['rev-parse', '--show-toplevel'], process.cwd()) || process.cwd()));
const NEXT = path.join(APP, 'node_modules', '.bin', 'next');
const next = (nextArgs) => {
  const r = spawnSync(NEXT, nextArgs, { cwd: APP, stdio: 'inherit' });
  if (r.status) process.exit(r.status);
};
const ensureBuilt = () => fs.existsSync(path.join(APP, '.next', 'BUILD_ID')) || next(['build']);
// 로컬 전용: 프로젝트 코드를 보여 주고 에이전트에 작성 요청을 보내므로 외부 바인딩 금지
const NEXT_START = ['start', '-H', '127.0.0.1', '-p', PORT];

async function post() {
  const parsed = store.parsePost(fs.readFileSync(0, 'utf8'));
  const dir = root();
  const project = store.ensureProject(dir);
  // --amend <커밋id>: 수정 요청은 새 단계를 만들지 않고 그 단계의 블록을 갈아끼운다
  const old = opt('amend') ? store.getCommit(project.slug, opt('amend')) : null;
  if (opt('amend') && !old) fail(`수정할 커밋이 없습니다: ${opt('amend')}`);
  const blocks = parsed.blocks.map((b, i) => {
    const abs = store.safePath(dir, b.file);
    const content = store.readFile(abs);
    let before = b.before ?? null, after = b.after, line = 1;
    if (before != null) {
      // 줄 번호는 에이전트가 아니라 실제 파일에서 계산. 못 찾으면 잘못 짚은 코드이므로 게시 거부.
      if (content == null) fail(`${b.file}: before 펜스가 있지만 파일이 없습니다`);
      const at = content.indexOf(before);
      if (at < 0) fail(`${b.file}: before 구간이 파일에 없습니다. 현재 파일 내용을 그대로 옮기세요`);
      if (content.indexOf(before, at + 1) >= 0) fail(`${b.file}: before 구간이 여러 번 나옵니다. 더 넓게 잡으세요`);
      // 마크다운은 Preview 가 그려지도록 표·문단·펜스 단위까지 넓힌다
      if (b.lang === 'markdown') ({ before, after } = store.widenMarkdown(content, { before, after }));
      line = store.lineOf(content, content.indexOf(before));
    } else if (content != null) {
      before = content.replace(/\n$/, ''); // before 생략 + 기존 파일 = 파일 전체 교체
    }
    const file = path.relative(dir, abs);
    // 코드가 그대로인 블록만 완료 상태를 유지
    const done = !!old?.blocks.some((o) => o.done && o.file === file && o.after === after);
    return { id: `b${i + 1}`, file, label: b.label, lang: b.lang, note: b.note, before, after, line, done };
  });
  const now = new Date().toISOString();
  const commit = old
    ? { ...old, title: parsed.title, summary: parsed.summary, updatedAt: now, blocks }
    : {
      id: Date.now().toString(36),
      branch: opt('branch') || git(['branch', '--show-current'], dir) || 'main',
      title: parsed.title,
      summary: parsed.summary,
      createdAt: now,
      blocks,
    };
  store.saveCommit(project.slug, commit);
  store.markAgent(project.slug, 'working');
  const url = `http://127.0.0.1:${PORT}/p/${project.slug}?c=${commit.id}`;
  console.log(`${old ? '수정됨' : '게시됨'}: ${commit.title} (${blocks.length}블록) → ${url}`);
  const up = await fetch(`http://127.0.0.1:${PORT}/`, { signal: AbortSignal.timeout(800) }).catch(() => null);
  if (!up) console.log('뷰어 서버가 꺼져 있습니다. `hfl start` 로 띄우세요.');
}

function fmt(slug, e) {
  if (e.type === 'request') {
    const head = `[request] commit=${e.commit ?? '-'}${e.blocks?.length ? ` blocks=${e.blocks.join(' ')}` : ''}\n${e.text.replace(/^/gm, '  ')}`;
    if (!e.blocks?.length) return head;
    // 사용자가 화면에서 선택한 코드 — 요청은 이 블록들에 대한 것
    const c = store.getCommit(slug, e.commit);
    const refs = e.blocks.map((id, i) => `    ${id} ${e.files[i]} [${c?.blocks.find((b) => b.id === id)?.label ?? '?'}]`).join('\n');
    return `${head}\n  대상 블록 (사용자가 선택한 코드):\n${refs}\n  → 이 블록을 중심으로 고쳐 hfl post --amend ${e.commit}`;
  }
  // 이벤트에 처리법을 같이 실어 보낸다 — 에이전트가 예전 스킬을 들고 있어도 따라올 수 있게
  if (e.type === 'ai-write') {
    const ids = (e.blocks ?? [e.block]).join(' ');
    const files = (e.files ?? [e.file]).map((f, i) => `  ${(e.blocks ?? [e.block])[i]} ${f}`).join('\n');
    return `[ai-write] commit=${e.commit} blocks=${ids}\n${files}\n  → hfl apply ${e.commit} ${ids} 로 반영하고, 필요하면 컴파일·테스트 확인 후 hfl done ${e.commit} ${ids}`;
  }
  const c = store.getCommit(slug, e.commit);
  const progress = c ? ` (완료 ${c.blocks.filter((b) => b.done).length}/${c.blocks.length})` : '';
  return `[${e.type}] commit=${e.commit} block=${e.block} ${e.file}${progress}`;
}

async function wait() {
  const { slug } = store.ensureProject(root());
  const deadline = Date.now() + Number(opt('timeout', 600)) * 1000;
  for (;;) {
    const all = store.readInbox(slug);
    const fresh = all.slice(store.getCursor(slug)).filter((e) => e.from === 'user');
    if (fresh.length || Date.now() >= deadline) {
      store.setCursor(slug, all.length);
      store.markAgent(slug, fresh.length ? 'working' : 'rewait');
      console.log(fresh.length ? fresh.map((e) => fmt(slug, e)).join('\n') : '(새 이벤트 없음, 시간 초과)');
      return;
    }
    store.markAgent(slug, 'waiting'); // 심장박동: 뷰어 왼쪽 아래 "에이전트 대기 중"
    await new Promise((r) => setTimeout(r, 1000)); // ponytail: 1초 폴링. 지연이 거슬리면 fs.watch
  }
}

// ── AI 작성: hfl apply / hfl done ──
// 위치 인자: --옵션 과 그 값을 뺀 나머지
const positional = () => args.filter((a, i) => !a.startsWith('--') && !args[i - 1]?.startsWith('--'));

// <커밋id> [블록id…] → 대상 블록 (블록 id 를 생략하면 그 커밋의 블록 전부)
function target() {
  const [cid, ...bids] = positional();
  if (!cid) fail(`커밋 id 가 필요합니다: hfl ${cmd} <커밋id> [블록id…]`);
  const project = store.ensureProject(root());
  const commit = store.getCommit(project.slug, cid);
  if (!commit) fail(`커밋이 없습니다: ${cid}`);
  const blocks = bids.length ? bids.map((id) => commit.blocks.find((b) => b.id === id) ?? fail(`블록이 없습니다: ${id}`)) : commit.blocks;
  return { project, commit, blocks };
}

// 게시된 블록을 글자 그대로 파일에 넣는다. 에이전트가 같은 코드를 다시 쓰지 않아도 되게.
function apply() {
  const { project, blocks } = target();
  store.markAgent(project.slug, 'working');
  for (const b of blocks) {
    const abs = store.safePath(project.root, b.file);
    const content = store.readFile(abs);
    if (store.isApplied(content, b)) {
      console.log(`${b.id} ${b.file}: 이미 반영됨`);
      continue;
    }
    try {
      const out = store.applyBlock(content, b);
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, out);
      console.log(`${b.id} ${b.file}: 반영함`);
    } catch (e) {
      fail(`${b.id} ${b.file}: ${e.message}\n  → Edit 로 블록과 같은 결과를 만든 뒤 hfl done 하세요`);
    }
  }
}

// AI 작성 끝 알림: 완료 처리하고 "AI 작업중" 을 푼다. 뷰어는 폴링으로 바로 "완료됨" 으로 바뀐다.
function done() {
  const { project, commit, blocks } = target();
  store.markAgent(project.slug, 'working');
  for (const b of blocks) Object.assign(b, { done: true, aiPending: false });
  store.saveCommit(project.slug, commit);
  console.log(`완료 처리: ${blocks.map((b) => b.id).join(', ')} (완료 ${commit.blocks.filter((b) => b.done).length}/${commit.blocks.length})`);
}

// ── 백그라운드 실행 ──
const PID_FILE = path.join(store.HOME, 'server.pid');
const LOG_FILE = path.join(store.HOME, 'server.log');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// ponytail: pid 생존만 본다. OS 가 pid 를 재사용하면 오판할 수 있음 — 문제되면 포트 응답까지 확인
const { alive } = store;
const killGroup = (pid, sig) => { try { process.kill(-pid, sig); } catch {} };
const responds = (port) => fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(800) }).then(() => true, () => false);
function running() {
  try {
    const s = JSON.parse(fs.readFileSync(PID_FILE, 'utf8'));
    return alive(s.pid) ? s : null;
  } catch { return null; }
}

async function start() {
  const cur = running();
  if (cur) return console.log(`이미 실행 중입니다 → http://127.0.0.1:${cur.port} (pid ${cur.pid})`);
  if (await responds(PORT)) fail(`포트 ${PORT} 를 다른 프로세스가 쓰고 있습니다. 그 프로세스를 끄거나 --port 로 바꾸세요`);
  ensureBuilt();
  fs.mkdirSync(store.HOME, { recursive: true });
  const log = fs.openSync(LOG_FILE, 'a');
  // detached: 자기 프로세스 그룹으로 떼어내 터미널을 닫아도 살아 있고, stop 때 그룹째 끈다
  const child = spawn(NEXT, NEXT_START, { cwd: APP, detached: true, stdio: ['ignore', log, log] });
  child.unref();
  fs.writeFileSync(PID_FILE, JSON.stringify({ pid: child.pid, port: PORT }));
  for (const deadline = Date.now() + 15000; Date.now() < deadline && alive(child.pid);) {
    if (await responds(PORT)) return console.log(`뷰어 시작 → http://127.0.0.1:${PORT} (pid ${child.pid})\n로그: ${LOG_FILE}`);
    await sleep(300);
  }
  killGroup(child.pid, 'SIGKILL');
  fs.rmSync(PID_FILE, { force: true });
  fail(`뷰어가 뜨지 않았습니다. 로그를 확인하세요: ${LOG_FILE}`);
}

async function stop() {
  const s = running();
  fs.rmSync(PID_FILE, { force: true });
  if (!s) return console.log('실행 중인 뷰어가 없습니다');
  killGroup(s.pid, 'SIGTERM');
  for (let i = 0; i < 20 && alive(s.pid); i++) await sleep(250);
  if (alive(s.pid)) killGroup(s.pid, 'SIGKILL');
  console.log(`뷰어를 종료했습니다 (pid ${s.pid})`);
}

try {
  switch (cmd) {
    case 'post': await post(); break;
    case 'wait': await wait(); break;
    case 'apply': apply(); break;
    case 'done': done(); break;
    case 'start': await start(); break;
    case 'stop': await stop(); break;
    case 'build': next(['build']); break;
    case 'serve': ensureBuilt(); next(NEXT_START); break;
    default:
      console.log(`사용법:
  hfl start [--port 4100]       뷰어를 백그라운드로 시작 (빌드 없으면 먼저 빌드)
  hfl stop                      백그라운드 뷰어 종료
  hfl serve [--port 4100]       뷰어를 포그라운드로 실행 (로그를 바로 볼 때)
  hfl build                     뷰어 재빌드
  hfl post [--branch 이름] < 게시.md   새 단계 게시 (stdin, 형식은 SKILL.md)
  hfl post --amend <커밋id> < 게시.md  기존 단계의 코드를 수정본으로 교체
  hfl wait [--timeout 600]      UI 이벤트(수정 요청·AI 작성 요청·완료)가 올 때까지 대기
  hfl apply <커밋id> [블록id…]   게시된 블록을 파일에 그대로 반영 (블록 생략 시 전부)
  hfl done <커밋id> [블록id…]    완료 처리. AI 작성 요청을 끝냈다는 알림
공통: --root <프로젝트 경로> (기본: git 루트 또는 현재 폴더)`);
  }
} catch (e) {
  fail(e.message);
}
