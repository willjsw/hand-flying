// CLI(bin/hf.mjs)와 Next 서버가 함께 쓰는 저장소. 데이터는 $HF_HOME(기본 ~/.hand-flying)/projects/<slug>/ 아래.
//   project.json        { name, root, createdAt }
//   commits/<id>.json   { id, branch, title, summary, createdAt, blocks: [...] }
//   inbox.jsonl         UI ↔ 에이전트 이벤트 로그 (append-only)
//   cursor.json         에이전트가 읽은 inbox 줄 수
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const HOME = process.env.HF_HOME || path.join(os.homedir(), '.hand-flying');

const SLUG = /^[a-z0-9][a-z0-9._-]*$/;
const ID = /^[a-z0-9]+$/;
function pdir(slug) {
  if (!SLUG.test(slug)) throw new Error(`잘못된 프로젝트: ${slug}`);
  return path.join(HOME, 'projects', slug);
}
function commitPath(slug, id) {
  if (!ID.test(id)) throw new Error(`잘못된 커밋 id: ${id}`);
  return path.join(pdir(slug), 'commits', `${id}.json`);
}
const inboxPath = (slug) => path.join(pdir(slug), 'inbox.jsonl');
const cursorPath = (slug) => path.join(pdir(slug), 'cursor.json');

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}
function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, file); // 원자적 교체 — 읽는 쪽이 반쯤 쓰인 파일을 보지 않게
}
export function readFile(file) {
  try { return fs.readFileSync(file, 'utf8'); } catch { return null; }
}

// 프로젝트 루트 밖으로 나가는 경로(../, 절대경로)는 거부. 파일을 읽고 쓰는(hf apply) 경계라 필수.
export function safePath(root, file) {
  const abs = path.resolve(root, file);
  if (!abs.startsWith(root + path.sep)) throw new Error(`프로젝트 밖 경로: ${file}`);
  return abs;
}

// ── 프로젝트 ──
export function listProjects() {
  const dir = path.join(HOME, 'projects');
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((s) => SLUG.test(s)).map(getProject).filter(Boolean);
}
export function getProject(slug) {
  if (!SLUG.test(slug)) return null;
  const p = readJson(path.join(pdir(slug), 'project.json'), null);
  return p && { ...p, slug };
}
export function ensureProject(root) {
  const found = listProjects().find((p) => p.root === root);
  if (found) return found;
  const base = path.basename(root).toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^[._-]+/, '') || 'project';
  let slug = base;
  for (let n = 2; fs.existsSync(pdir(slug)); n++) slug = `${base}-${n}`;
  const p = { name: path.basename(root), root, createdAt: new Date().toISOString() };
  writeJson(path.join(pdir(slug), 'project.json'), p);
  return { ...p, slug };
}

// ── 커밋 ──
export function listCommits(slug) {
  const dir = path.join(pdir(slug), 'commits');
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => readJson(path.join(dir, f), null))
    .filter(Boolean)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}
export const getCommit = (slug, id) => readJson(commitPath(slug, id), null);
// ponytail: 커밋 파일 단위 last-write-wins. 에이전트 게시와 UI 체크가 같은 커밋을 동시에 쓰는 일은 드묾. 문제되면 파일 락.
export const saveCommit = (slug, commit) => writeJson(commitPath(slug, commit.id), commit);

// ── inbox ──
export function appendInbox(slug, entry) {
  fs.mkdirSync(pdir(slug), { recursive: true });
  fs.appendFileSync(inboxPath(slug), JSON.stringify({ at: new Date().toISOString(), ...entry }) + '\n');
}
export function readInbox(slug) {
  const text = readFile(inboxPath(slug));
  return text ? text.split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];
}
export const getCursor = (slug) => readJson(cursorPath(slug), 0);
export const setCursor = (slug, n) => writeJson(cursorPath(slug), n);

// ── 에이전트 연결 ──
// hf wait 가 폴링마다 심장박동을 남기고, 뷰어는 그것으로 대기 / 작업 / 끊김 을 가른다.
//   waiting  hf wait 가 살아서 대기 중 (박동 15초 이내 + 프로세스 생존)
//   rewait   wait 가 시간 초과로 끝남. 에이전트가 곧 다시 wait 할 것으로 보고 1분 유예
//   working  이벤트를 넘겨받아 처리 중. 15분 안에 다시 wait 하지 않으면 끊긴 것으로 본다
const agentPath = (slug) => path.join(pdir(slug), 'agent.json');
const GRACE = { waiting: 15_000, rewait: 60_000, working: 15 * 60_000 };
export const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
export const markAgent = (slug, state) => writeJson(agentPath(slug), { pid: process.pid, state, at: Date.now() });
export function agentStatus(slug) {
  const a = readJson(agentPath(slug), null);
  if (!a) return { state: 'off', at: null };
  const fresh = Date.now() - a.at < (GRACE[a.state] ?? 0);
  if (fresh && a.state === 'waiting' && alive(a.pid)) return { state: 'waiting', at: a.at };
  if (fresh && a.state === 'rewait') return { state: 'waiting', at: a.at };
  if (fresh && a.state === 'working') return { state: 'working', at: a.at };
  return { state: 'off', at: a.at };
}

// UI 폴링용. 커밋·inbox·반영 대상 파일 중 하나라도 바뀌면 값이 바뀐다.
export function version(slug, commit) {
  const project = getProject(slug);
  const mtime = (f) => { try { return fs.statSync(f).mtimeMs; } catch { return 0; } };
  const files = commit && project ? commit.blocks.map((b) => safePath(project.root, b.file)) : [];
  return [path.join(pdir(slug), 'commits'), inboxPath(slug), cursorPath(slug), ...files].map(mtime).join(':');
}

// ── 게시 형식 파싱 ──
// # 커밋 제목
// ### 맥락 / ### 목적 / ### 순서 …   ← 요약 절 (맥락·목적 필수)
// ## 파일경로#라벨
// 설명: 무엇을, 어떤 목표를 위해, 어떤 방향으로 바꾸는지
// ```lang before      ← 기존 코드(선택). 생략하면 새 파일 또는 파일 전체 교체
// ```lang             ← 새 코드
export function parsePost(md) {
  const post = { title: '', summary: [], blocks: [] };
  let block = null, fence = null, buf = [];
  for (const line of md.replace(/\r\n/g, '\n').split('\n')) {
    let m;
    if (fence) {
      m = line.match(/^\s*(`{3,})\s*$/);
      if (m && m[1].length >= fence.len) {
        if (!block) throw new Error('코드 펜스는 "## 파일경로" 블록 아래에 있어야 합니다');
        block[fence.before ? 'before' : 'after'] = buf.join('\n');
        block.lang ||= fence.lang;
        fence = null;
        buf = [];
      } else buf.push(line);
      continue;
    }
    if ((m = line.match(/^(`{3,})(.*)$/))) {
      const words = m[2].trim().split(/\s+/).filter(Boolean);
      fence = { len: m[1].length, before: words.includes('before'), lang: words.find((w) => w !== 'before' && w !== 'after') };
    } else if ((m = line.match(/^## (.+)$/))) {
      const [file, ...label] = m[1].trim().split('#');
      block = { file: file.trim(), label: label.join('#').trim(), note: [] };
      post.blocks.push(block);
    } else if (!post.title && !block && (m = line.match(/^# (.+)$/))) {
      post.title = m[1].trim();
    } else {
      (block ? block.note : post.summary).push(line);
    }
  }
  if (fence) throw new Error('닫히지 않은 코드 펜스가 있습니다');
  if (!post.title) throw new Error('"# 커밋 제목" 줄이 필요합니다');
  if (!post.blocks.length) throw new Error('"## 파일경로" 블록이 하나 이상 필요합니다');
  for (const b of post.blocks) {
    if (b.after == null) throw new Error(`블록 ${b.file}에 새 코드 펜스가 없습니다`);
    const lang = resolveLang(b.lang, b.file);
    if (!lang) throw new Error(`블록 ${b.file}: 코드 언어 "${b.lang}" 를 모릅니다. 지원: ${Object.keys(LANGS).join(', ')}`);
    b.lang = lang;
    if (!parseLabel(b.label).kind) {
      throw new Error(`블록 ${b.file}: "## 경로#종류 [이름]" 형식의 라벨이 필요합니다. 종류: ${Object.keys(KINDS).join(', ')}`);
    }
    b.note = b.note.join('\n').trim();
  }
  post.summary = post.summary.join('\n').trim();
  const titles = sections(post.summary).map((x) => x.title);
  const missing = REQUIRED_SECTIONS.filter((t) => !titles.includes(t));
  if (missing.length) throw new Error(`요약에 ${missing.map((t) => `"### ${t}"`).join(', ')} 절이 필요합니다`);
  return post;
}

// 이 작업을 왜 하는지 모르면 따라 칠 이유도 모른다 — 맥락·목적은 게시 필수
export const REQUIRED_SECTIONS = ['맥락', '목적'];

// 요약을 "### 소제목" 단위로 나눈다. 첫 소제목 앞의 글은 제목 없는 절.
export function sections(summary) {
  const out = [];
  for (const line of (summary ?? '').split('\n')) {
    const m = line.match(/^### (.+)$/);
    if (m) out.push({ title: m[1].trim(), body: [] });
    else (out.at(-1) ?? (out.push({ title: '', body: [] }), out.at(-1))).body.push(line);
  }
  return out.map((x) => ({ title: x.title, body: x.body.join('\n').trim() })).filter((x) => x.title || x.body);
}

// "1. …", "- …" 줄을 항목으로, 들여쓴 이어지는 줄은 앞 항목에 붙인다. 항목이 없으면 빈 배열.
export function listItems(body) {
  const items = [];
  for (const line of body.split('\n')) {
    const m = line.match(/^\s*(?:\d+[.)]|[-*])\s+(.*)$/);
    if (m) items.push(m[1].trim());
    else if (items.length && line.trim()) items[items.length - 1] += ' ' + line.trim();
  }
  return items;
}

// ── 블록 라벨: "## 경로#종류 [이름]" ──
// 언어·파일 형식과 무관한 고정 범주. 이름(메서드명 등)은 선택이며 화면에 보조로만 보인다.
export const KINDS = {
  imports: 'import·include·require·use 묶음',
  field: '필드·속성·상수·전역 변수 선언',
  constructor: '생성자·초기화 함수(__init__ 등)',
  method: '메서드·함수',
  type: 'class·interface·enum·record·struct 선언 전체',
  test: '테스트 케이스·픽스처',
  block: '메서드 안 일부 등 그 밖의 코드 조각',
  query: 'SQL 문·DDL',
  key: '설정 키·섹션(yaml·properties·json·toml·xml·env)',
  section: '문서의 절(md·txt·adoc)',
  file: '파일 전체(새 파일·전체 교체)',
};
export function parseLabel(label) {
  const [first = '', ...rest] = (label ?? '').trim().split(/\s+/);
  return Object.hasOwn(KINDS, first) ? { kind: first, name: rest.join(' ') } : { kind: null, name: (label ?? '').trim() };
}

// ── 코드 언어: 하이라이트용 고정 목록 ──
// 게시 때 펜스 언어(```java)나 파일 확장자로 정해 블록 메타데이터 lang 에 정식 id 로 기록한다.
// 값은 그 언어로 보는 확장자. id 는 하이라이터(shiki) 언어 id 와 같다.
export const LANGS = {
  java: ['java'], kotlin: ['kt', 'kts'], groovy: ['groovy', 'gradle'], scala: ['scala'],
  c: ['c', 'h'], cpp: ['cpp', 'cc', 'cxx', 'hpp', 'hh'], csharp: ['cs'], go: ['go'], rust: ['rs'],
  python: ['py'], ruby: ['rb'], php: ['php'], swift: ['swift'],
  javascript: ['js', 'mjs', 'cjs'], typescript: ['ts', 'mts', 'cts'], jsx: ['jsx'], tsx: ['tsx'],
  html: ['html', 'htm'], css: ['css'], scss: ['scss'], vue: ['vue'],
  json: ['json'], yaml: ['yml', 'yaml'], toml: ['toml'], ini: ['ini', 'cfg', 'conf'], properties: ['properties'], xml: ['xml'],
  sql: ['sql'], bash: ['sh', 'bash', 'zsh'], dockerfile: [], markdown: ['md', 'markdown'], diff: ['diff', 'patch'],
  text: ['txt'],
};
const LANG_ALIAS = {
  js: 'javascript', ts: 'typescript', py: 'python', rb: 'ruby', sh: 'bash', shell: 'bash', zsh: 'bash', yml: 'yaml',
  kt: 'kotlin', 'c++': 'cpp', 'c#': 'csharp', cs: 'csharp', golang: 'go', rs: 'rust', md: 'markdown',
  docker: 'dockerfile', gradle: 'groovy', plaintext: 'text', txt: 'text',
};
const LANG_BY_EXT = Object.fromEntries(Object.entries(LANGS).flatMap(([id, exts]) => exts.map((e) => [e, id])));
// 펜스 언어가 있으면 그것을(목록 밖이면 null), 없으면 파일 확장자로. 모르는 확장자는 text.
export function resolveLang(name, file) {
  const n = (name ?? '').toLowerCase();
  if (n) return Object.hasOwn(LANGS, n) ? n : Object.hasOwn(LANG_ALIAS, n) ? LANG_ALIAS[n] : null;
  const base = path.basename(file ?? '').toLowerCase();
  if (base === 'dockerfile' || base.startsWith('dockerfile.')) return 'dockerfile';
  return LANG_BY_EXT[path.extname(base).slice(1)] ?? 'text';
}

// 블록과 현재 파일의 관계: 반영됨 / 원본이 사라져 적용 불가 / 새 파일인데 이미 내용이 있음
export function blockState(root, b) {
  const content = readFile(safePath(root, b.file));
  const applied = isApplied(content, b);
  return {
    applied,
    stale: !applied && b.before != null && !content?.includes(b.before),
    overwrite: b.before == null && !applied && !!content?.trim(),
    creatable: b.before == null && content == null, // 아직 없는 새 파일 → "파일 생성" 버튼
  };
}

// ── 새 파일의 뼈대: "파일 생성" 이 만든다. 사용자는 파일 만들기가 아니라 본문 타이핑부터 시작한다 ──
// 중괄호 언어는 첫 최상위 선언(C·C++ 은 main 이 있으면 main)을 여는 줄까지 + 닫는 }, 그 밖은 빈 파일.
// ponytail: 줄 단위로 { } 를 센다 — 주석·문자열 속 중괄호는 가리지 않는다. 틀리면 직접 고치거나 AI 작성으로.
const BRACE_LANGS = new Set(['java', 'kotlin', 'groovy', 'scala', 'c', 'cpp', 'csharp', 'go', 'rust', 'php', 'swift', 'javascript', 'typescript', 'jsx', 'tsx']);
const count = (s, ch) => s.split(ch).length - 1;

export function skeleton(code, lang) {
  if (!BRACE_LANGS.has(lang)) return '';
  const lines = code.split('\n');
  const main = lang === 'c' || lang === 'cpp' ? lines.findIndex((l) => /\bmain\s*\(/.test(l)) : -1;
  let depth = 0;
  for (let i = Math.max(main, 0); i < lines.length; i++) {
    depth += count(lines[i], '{') - count(lines[i], '}');
    if (depth <= 0) continue;
    // main 을 골랐으면 그 앞의 다른 함수는 빼고 #include 같은 전처리 줄만 남긴다
    const pre = main < 0 ? lines.slice(0, i + 1) : lines.slice(0, main).filter((l) => l.trimStart().startsWith('#'));
    const head = main < 0 ? pre : [...pre, ...(pre.length ? [''] : []), ...lines.slice(main, i + 1)];
    return `${head.join('\n')}\n${lines[i].match(/^\s*/)[0]}${'}'.repeat(depth)}\n`;
  }
  return '';
}

export function createSkeleton(root, b) {
  const file = safePath(root, b.file);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, skeleton(b.after, resolveLang(b.lang, b.file)), { flag: 'wx' }); // 이미 있으면 덮지 않는다
}

// ── 반영 ──
const norm = (s) => s.replace(/\s+/g, ' ').trim();

// 공백·들여쓰기 차이는 무시하고 파일에 새 코드가 들어갔는지 본다(직접 타이핑 검증용).
export function isApplied(content, block) {
  if (content == null) return false;
  const c = norm(content), after = norm(block.after);
  if (block.before == null) return c.includes(after);
  const before = norm(block.before);
  // 삭제형 수정(after ⊂ before)은 원본이 사라졌는지까지 확인
  return c.includes(after) && (after.includes(before) || !c.includes(before));
}

export function applyBlock(content, block) {
  if (block.before == null) return block.after + '\n';
  if (content == null) throw new Error(`${block.file} 파일이 없습니다`);
  const i = content.indexOf(block.before);
  if (i < 0 || content.indexOf(block.before, i + 1) >= 0) {
    throw new Error('원본 구간을 파일에서 정확히 한 번 찾지 못했습니다. 파일이 바뀌었으면 에이전트에게 다시 게시를 요청하세요.');
  }
  return content.slice(0, i) + block.after + content.slice(i + block.before.length);
}

export const lineOf = (content, index) => content.slice(0, index).split('\n').length;

// ── 마크다운 블록은 렌더링되는 단위까지 넓힌다 ──
// 표 행 몇 줄만 게시하면 Preview 가 표를 그리지 못한다. 빈 줄로 나뉜 덩어리(문단·표·목록)와 코드 펜스 전체가
// 들어가도록 앞뒤 줄을 붙인다. 붙인 줄은 before·after 에 똑같이 붙으므로 바뀌는 내용은 그대로다.
// 파일에 반영 전이면 before 를, 반영 뒤면 after 를 찾아 그 둘레를 본다. 못 찾으면 그대로 둔다.
export function widenMarkdown(content, b) {
  const anchor = isApplied(content, b) ? b.after : b.before;
  const at = anchor ? content.indexOf(anchor) : -1;
  if (at < 0) return b;
  const lines = content.split('\n');
  const inside = []; // inside[i]: i 줄이 코드 펜스 안(본문·닫는 줄)
  let open = false;
  for (const l of lines) {
    inside.push(open);
    if (/^\s*(```|~~~)/.test(l)) open = !open;
  }
  const blank = (i) => !lines[i].trim();
  const openAfter = (i) => (i + 1 < lines.length ? inside[i + 1] : open);
  let s = lineOf(content, at) - 1, e = lineOf(content, at + anchor.length - 1) - 1;
  while (s > 0 && (inside[s] || (!blank(s) && !blank(s - 1)))) s--;
  while (e < lines.length - 1 && (openAfter(e) || (!blank(e) && !blank(e + 1)))) e++;
  const start = lines.slice(0, s).reduce((n, l) => n + l.length + 1, 0);
  const end = lines.slice(0, e + 1).reduce((n, l) => n + l.length + 1, 0) - 1;
  const prefix = content.slice(start, at), suffix = content.slice(at + anchor.length, end);
  if (!prefix && !suffix) return b;
  return { ...b, before: prefix + b.before + suffix, after: prefix + b.after + suffix };
}
