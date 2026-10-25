import path from 'node:path';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { structuredPatch } from 'diff';
import { Marked } from 'marked';
import { codeToHtml } from 'shiki';
import {
  CaretDown, CaretRight, Check, CheckCircle, Circle, CircleHalf, Clock, Code, FileText, FolderSimple, Gear, GitBranch, GitDiff,
  ListChecks, SquaresFour,
} from '@phosphor-icons/react/ssr';
import * as store from '@/lib/store.mjs';
import { AgentDot, AgentProvider, AgentReconnect, AiAllButton, AiStars, BlockActions, LiveRefresh, PaneToggle, RequestBar, Resizer } from './client';

export const dynamic = 'force-dynamic';

// 마크다운 블록의 Preview. 게시된 문서가 화면에 스크립트를 넣지 못하게 원시 HTML 은 글자로 보이고(주석은 숨김),
// javascript: 같은 링크는 글자만 남긴다(false 를 돌려주면 marked 기본 렌더러가 그린다)
const escapeHtml = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const md = new Marked({
  renderer: {
    html: ({ text }) => (/^\s*<!--[\s\S]*-->\s*$/.test(text) ? '' : escapeHtml(text)), // 주석은 GitHub 처럼 숨김
    link(t) { return /^\s*(javascript|vbscript|data):/i.test(t.href) ? this.parser.parseInline(t.tokens) : false; },
  },
});

// light-plus / dark-plus(VS Code 기본 테마): 타입·키워드·문자열 등을 고루 칠한다(GitHub 테마는 Java 타입을 안 칠함)
const THEMES = { light: 'light-plus', dark: 'dark-plus' };

// 언어는 블록 메타데이터(lang, 게시 때 정식 id 로 기록)를 따른다.
// 메서드 일부·레코드 컴포넌트 같은 조각도 제대로 칠하도록, 실제 파일에서 블록 앞부분(최대 200줄)을 문법 맥락으로 먼저 읽힌다.
async function highlight(b, root) {
  const lang = store.resolveLang(b.lang, b.file) ?? 'text';
  const content = b.before != null ? store.readFile(store.safePath(root, b.file)) : null;
  const ctx = content?.split('\n').slice(Math.max(0, b.line - 201), b.line - 1).join('\n');
  try {
    return await codeToHtml(b.after, { lang, themes: THEMES, ...(ctx && lang !== 'text' ? { grammarContextCode: `${ctx}\n` } : {}) });
  } catch {
    return codeToHtml(b.after, { lang: 'text', themes: THEMES }); // 혹시 실패하면 하이라이트 없이
  }
}

// 블록 단위 diff를 실제 파일 줄 번호로 환산
function diffOf(b) {
  const { hunks } = structuredPatch('', '', b.before + '\n', b.after + '\n', '', '', { context: 3 });
  const rows = [];
  let add = 0, del = 0;
  for (const h of hunks) {
    let o = h.oldStart + b.line - 1, n = h.newStart + b.line - 1;
    rows.push({ kind: 'hunk', text: `@@ -${o},${h.oldLines} +${n},${h.newLines} @@` });
    for (const l of h.lines) {
      const text = l.slice(1);
      if (l[0] === '-') rows.push({ kind: 'del', o: o++, text }), del++;
      else if (l[0] === '+') rows.push({ kind: 'add', n: n++, text }), add++;
      else if (l[0] === ' ') rows.push({ kind: 'ctx', o: o++, n: n++, text });
    }
  }
  return { rows, add, del };
}

const time = (iso) => new Date(iso).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
const sign = { add: '+', del: '-', ctx: ' ' };

// 파일 종류 아이콘 3가지(복사 버튼과 같은 선 아이콘): 문서 / 설정 / 그 밖은 코드
const DOC_EXT = new Set(['md', 'markdown', 'txt', 'adoc', 'rst']);
const CONFIG_EXT = new Set(['yml', 'yaml', 'json', 'toml', 'ini', 'properties', 'env', 'xml', 'conf', 'cfg', 'lock']);
const CONFIG_NAME = new Set(['dockerfile', '.gitignore', '.editorconfig', '.dockerignore']);
function FileKind({ file }) {
  const base = path.basename(file).toLowerCase();
  const ext = path.extname(base).slice(1);
  const [Icon, t] = DOC_EXT.has(ext) ? [FileText, '문서']
    : CONFIG_EXT.has(ext) || CONFIG_NAME.has(base) || base.startsWith('.env') ? [Gear, '설정'] : [Code, '코드'];
  return <Icon size={14} weight="bold" className="ficon" aria-label={t} />;
}

// 라벨: 고정 범주 pill 만 보인다(이름은 숨김). 범주가 없는 예전 자유 라벨은 표시하지 않는다.
function KindTag({ label }) {
  const { kind } = store.parseLabel(label);
  return kind ? <span className={`tag k-${kind}`} title={store.KINDS[kind]}>{kind}</span> : null;
}

// 상태색 규칙(Linear 방식): 완료 = blue(GitLab), 파일 일치 = green, 진행 중 = yellow, 시작 전·미반영 = gray
function StepIcon({ done, total }) {
  if (total && done === total) return <CheckCircle size={15} weight="fill" className="ic-done" aria-label="완료" />;
  if (done > 0) return <CircleHalf size={15} weight="fill" className="ic-progress" aria-label="진행 중" />;
  return <Circle size={15} weight="bold" className="ic-none" aria-label="시작 전" />;
}

function FileIcon({ b }) {
  if (b.done) return <CheckCircle size={15} weight="fill" className="ic-done" aria-label="Done" />;
  if (b.aiPending) return <span className="ic-progress" title="AI Writing"><AiStars size={15} /></span>;
  if (b.applied) return <CheckCircle size={15} weight="bold" className="ic-match" aria-label="Applied" />;
  return <Circle size={15} weight="bold" className="ic-none" aria-label="Todo" />;
}

// 상태 라벨(영문): Done 완료 / AI Writing 에이전트 작성 중 / Applied 파일과 일치 / Outdated 이후 단계로 원본이 바뀜 / Todo 아직
function BlockStatus({ b }) {
  if (b.done) return <span className="chip done"><Check size={11} weight="bold" />Done</span>;
  if (b.aiPending) return <span className="chip ai"><AiStars size={12} />AI Writing</span>;
  if (b.applied) return <span className="chip match" title="파일 내용과 일치합니다"><Check size={11} weight="bold" />Applied</span>;
  if (b.stale) return <span className="chip" title="파일이 이후 단계에서 바뀌어 이 블록은 적용할 수 없습니다">Outdated</span>;
  return <span className="chip" title="아직 파일에 반영되지 않았습니다">Todo</span>;
}

function Stat({ diff }) {
  if (!diff) return <span className="stat">새 파일</span>;
  return <span className="stat"><i className="add">+{diff.add}</i><i className="del">−{diff.del}</i></span>;
}

function FileList({ blocks }) {
  return (
    <ul className="filelist">
      {blocks.map((b) => (
        <li key={b.id}>
          <a href={`#${b.id}`}>
            <FileIcon b={b} />
            <span className="f" title={b.file}>
              <FileKind file={b.file} />
              <span className="fn">{b.name}</span>
              <KindTag label={b.label} />
            </span>
            <Stat diff={b.diff} />
          </a>
        </li>
      ))}
    </ul>
  );
}

// 설명 글은 문장마다 줄을 바꾼다. "다. " 처럼 마침표 뒤에 공백이 올 때만 끊어 코드(a.b) 는 건드리지 않는다.
const bySentence = (text) => text.replace(/([.!?])[ \t]+(?=\S)/g, '$1\n');
// `식별자` 는 코드 글꼴로
const rich = (text) => bySentence(text).split(/`([^`\n]+)`/).map((t, i) => (i % 2 ? <code key={i}>{t}</code> : t));
// 요약 절 제목은 화면에서 영문으로
const SECTION = { 맥락: 'Context', 목적: 'Purpose', 순서: 'Procedure' };

// 순서 항목 → 블록. 스킬이 항목을 블록 순서와 맞추게 하므로 개수가 같으면 순번대로 잇는다.
// 개수가 다르면 항목에 나온 파일명(확장자 제외)이나 블록 이름으로 찾는다. 직전에 이은 블록부터 찾아
// 같은 파일 블록이 여럿이어도 순서대로 맞춘다.
function linkProcedure(items, blocks) {
  if (items.length === blocks.length) return blocks.map((b) => b.id);
  const keys = blocks.map((b) => [path.basename(b.file, path.extname(b.file)), store.parseLabel(b.label).name]
    .filter((k) => k && k.length > 2).map((k) => k.toLowerCase()));
  let from = 0;
  const hit = (t, i) => keys[i].some((k) => t.includes(k));
  const links = items.map((item) => {
    const t = item.toLowerCase();
    const i = [...blocks.keys()].slice(from).find((j) => hit(t, j)) ?? [...blocks.keys()].find((j) => hit(t, j));
    if (i == null) return null;
    from = i;
    return blocks[i].id;
  });
  return links;
}

// 요약: 맥락·목적 등은 라벨 + 본문, 순서는 별도 상자에 번호 목록으로. 절이 없는 예전 요약은 문단 그대로.
function Brief({ summary, blocks }) {
  const secs = store.sections(summary);
  if (!secs.some((x) => x.title)) return summary ? <p className="summary">{rich(summary)}</p> : null;
  const intro = secs.find((x) => !x.title);
  const order = secs.find((x) => x.title === '순서');
  const items = order ? store.listItems(order.body) : [];
  const links = linkProcedure(items, blocks);
  return (
    <>
      {intro && <p className="summary">{rich(intro.body)}</p>}
      <dl className="brief">
        {secs.filter((x) => x.title && x !== order).map((x, i) => (
          <div key={i}>
            <dt>{SECTION[x.title] ?? x.title}</dt>
            <dd>{rich(x.body)}</dd>
          </div>
        ))}
      </dl>
      {order && (
        <section className="order" aria-label="작업 순서">
          <h2>{SECTION.순서}</h2>
          {items.length ? (
            <ol>
              {items.map((t, i) => <li key={i}>{links[i] ? <a href={`#${links[i]}`}>{t}</a> : t}</li>)}
            </ol>
          ) : <p>{order.body}</p>}
        </section>
      )}
    </>
  );
}

const ago = (iso) => {
  const m = Math.round((Date.now() - new Date(iso)) / 60000);
  return m < 1 ? '방금' : m < 60 ? `${m}분 전` : m < 1440 ? `${Math.round(m / 60)}시간 전` : `${Math.round(m / 1440)}일 전`;
};

// 제목 밑 상태 줄: 단계 완료 상태 pill + 최초 게시 시각 (GitLab 이슈 머리 참고)
function StepState({ done, total, createdAt }) {
  const [cls, icon, label] = total && done === total ? ['done', <CheckCircle key="i" size={14} weight="fill" />, 'Done']
    : done > 0 ? ['progress', <CircleHalf key="i" size={14} weight="fill" />, `In progress ${done}/${total}`]
      : ['todo', <Circle key="i" size={14} weight="bold" />, 'Todo'];
  return (
    <div className="state-line">
      <span className={`state ${cls}`}>{icon}{label}</span>
      <span className="posted" title={new Date(createdAt).toLocaleString('ko-KR')}>{time(createdAt)} 게시<span>{ago(createdAt)}</span></span>
    </div>
  );
}

export default async function Page({ params, searchParams }) {
  const { slug } = await params;
  const { c } = await searchParams;
  const project = store.getProject(slug);
  if (!project) notFound();

  const commits = store.listCommits(slug);
  const cur = commits.find((x) => x.id === c) ?? commits.at(-1);
  // 에이전트가 아직 가져가지 않은 수정 요청 수
  const pending = store.readInbox(slug).slice(store.getCursor(slug)).filter((e) => e.type === 'request').length;

  const blocks = await Promise.all((cur?.blocks ?? []).map(async (b) => {
    return {
      ...b,
      ...store.blockState(project.root, b),
      name: path.basename(b.file),
      dir: path.dirname(b.file),
      html: await highlight(b, project.root),
      diff: b.before != null ? diffOf(b) : null,
      preview: store.resolveLang(b.lang, b.file) === 'markdown' ? md.parse(b.after) : null,
    };
  }));
  const done = blocks.filter((b) => b.done).length;
  const applied = blocks.filter((b) => b.applied).length;
  // AI 전체 구현 대상: 아직 완료 안 됐고, 작업 중도 아니고, 적용 가능한 블록
  const aiTargets = blocks.filter((b) => !b.done && !b.aiPending && !b.stale).length;
  const aiBusy = blocks.filter((b) => b.aiPending).length;

  return (
    <AgentProvider slug={slug} initial={store.agentStatus(slug)}>
    <div className="shell">
      <aside className="side">
        {/* 로고 이미지는 자르기만 해서 쓴다(public/brand). 색은 CSS 로만 바꾼다 */}
        <Link href="/" className="brand" title="모든 프로젝트">
          <img src="/brand/emblem.png" width={26} height={26} alt="" className="brand-img" />
          <img src="/brand/wordmark.png" width={76} height={13} alt="Hand Flying" className="brand-img" />
        </Link>
        <Link href="/" className="nav-item"><SquaresFour size={15} weight="bold" />모든 프로젝트</Link>
        <div className="side-label">브랜치</div>
        <nav aria-label="작업 이력">
          {Object.entries(Object.groupBy(commits, (x) => x.branch)).map(([branch, list]) => (
            <details key={branch} className="branch" open>
              <summary>
                <CaretRight size={10} weight="bold" className="caret" />
                <GitBranch size={15} weight="bold" />
                <span className="t">{branch}</span>
                <span className="n">{list.length}</span>
              </summary>
              <ol className="steps">
                {list.map((x) => (
                  <li key={x.id}>
                    <Link href={`/p/${slug}?c=${x.id}`} aria-current={x.id === cur?.id ? 'page' : undefined}>
                      <StepIcon done={x.blocks.filter((b) => b.done).length} total={x.blocks.length} />
                      <span className="t">{x.title}</span>
                    </Link>
                  </li>
                ))}
              </ol>
            </details>
          ))}
        </nav>
        <div className="side-foot">
          {/* 프로젝트 | 에이전트 상태 점. 이름이 길면 이름만 말줄임되어 서로 겹치지 않는다 */}
          <div className="ws-row">
            <div className="ws" title={project.root}>
              <span className="ws-mark">{project.name[0].toUpperCase()}</span>
              <span className="t">{project.name}</span>
            </div>
            <AgentDot />
          </div>
          <AgentReconnect />
        </div>
      </aside>
      {/* 접기 버튼: Claude 데스크톱처럼 각 사이드바 맨 위에 고정. 접혀도 같은 자리에 남는다 */}
      <PaneToggle pane="left" label="왼쪽 사이드바 접기·펴기" />
      {cur && <PaneToggle pane="right" label="오른쪽 패널 접기·펴기" />}

      <div className="main">
        <Resizer pane="left" />
        <header className="topbar">
          <Link href={`/p/${slug}`} className="crumb"><FolderSimple size={15} weight="bold" />{project.name}</Link>
          {cur && (
            <>
              <CaretRight size={11} weight="bold" className="sep" />
              <span className="crumb"><GitBranch size={15} weight="bold" />{cur.branch}</span>
              <CaretRight size={11} weight="bold" className="sep" />
              <span className="crumb cur">{cur.title}</span>
            </>
          )}
        </header>

        <div className="body">
          <div className="docwrap">
            {cur && <Resizer pane="right" />}
            <div className="scroll">
              <article className="doc">
                {cur ? (
                  <>
                    <h1>{cur.title}</h1>
                    <StepState done={done} total={blocks.length} createdAt={cur.createdAt} />
                    <Brief summary={cur.summary} blocks={blocks} />
                    <div className="doc-files"><FileList blocks={blocks} /></div>

                    {blocks.map((b, i) => (
                      <details key={`${cur.id}:${b.id}`} id={b.id} className="block" style={{ '--i': i }} open={!b.done}>
                        {/* 고정 칸: 1행 (파일명 + 범주, 간격 8px 고정) | 상태 오른쪽 정렬, 2행 경로.
                            파일명이 길면 파일명만 말줄임되고 범주 pill 은 언제나 바로 뒤에 보인다 */}
                        <summary className="bhead">
                          <CaretRight size={11} weight="bold" className="caret" />
                          <FileKind file={b.file} />
                          <span className="ftitle">
                            <span className="fname" title={b.name}>{b.name}</span>
                            <KindTag label={b.label} />
                          </span>
                          <span className="bright"><BlockStatus b={b} /></span>
                          {b.dir !== '.' && <span className="fpath" title={b.file}>{b.dir}/</span>}
                        </summary>
                        {b.note && (
                          <div className="why">
                            <b>Explain</b>
                            <p>{rich(b.note.replace(/^(근거|설명)\s*[:：]\s*/, ''))}</p>
                          </div>
                        )}
                        <div className="code" style={{ counterReset: `line ${b.line - 1}` }} dangerouslySetInnerHTML={{ __html: b.html }} />
                        {b.preview != null && <div className="md" dangerouslySetInnerHTML={{ __html: b.preview }} />}
                        {b.diff && (
                          <details className="changes">
                            <summary>
                              <CaretRight size={10} weight="bold" className="caret" />
                              <GitDiff size={15} weight="bold" />
                              변경사항 보기
                              <Stat diff={b.diff} />
                            </summary>
                            <div className="diffwrap">
                              <table className="diff">
                                <tbody>
                                  {b.diff.rows.map((r, j) => r.kind === 'hunk' ? (
                                    <tr key={j} className="hunk"><td colSpan={3}>{r.text}</td></tr>
                                  ) : (
                                    <tr key={j} className={r.kind}>
                                      <td className="ln">{r.o}</td>
                                      <td className="ln">{r.n}</td>
                                      <td className="tx">{sign[r.kind]}{r.text}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          </details>
                        )}
                        <BlockActions ids={{ slug, cid: cur.id, bid: b.id }} code={b.after} done={b.done} applied={b.applied} stale={b.stale} aiPending={b.aiPending} overwrite={b.overwrite} creatable={b.creatable} markdown={b.preview != null} />
                      </details>
                    ))}
                    {blocks.length > 0 && <AiAllButton ids={{ slug, cid: cur.id }} count={aiTargets} busy={aiBusy} />}
                  </>
                ) : (
                  <div className="empty-state">
                    <h2>아직 게시된 단계가 없습니다</h2>
                    <p>에이전트가 이 프로젝트에서 <code>hfl post</code> 로 코드를 게시하면 여기에 나타납니다.</p>
                  </div>
                )}
              </article>
            </div>
            {cur && <RequestBar key={cur.id} ids={{ slug, cid: cur.id }} pending={pending} />}
          </div>

          {cur && (
            <aside className="rail" aria-label="단계 속성">
              {/* Claude 데스크톱처럼 선 대신 떠 있는 카드. 카드 제목을 누르면 접고 편다 */}
              <details className="rail-card" open>
                <summary>속성<CaretDown size={11} weight="bold" className="chev" /></summary>
                <dl className="props">
                  <dt>진행</dt>
                  <dd><StepIcon done={done} total={blocks.length} />완료 {done}/{blocks.length}</dd>
                  <dt>파일 일치</dt>
                  <dd><ListChecks size={14} weight="bold" />{applied}/{blocks.length}</dd>
                  <dt>브랜치</dt>
                  <dd><GitBranch size={14} weight="bold" /><code>{cur.branch}</code></dd>
                  <dt>게시</dt>
                  <dd><Clock size={14} weight="bold" />{time(cur.createdAt)}</dd>
                  {cur.updatedAt && (
                    <>
                      <dt>수정</dt>
                      <dd><Clock size={14} weight="bold" />{time(cur.updatedAt)}</dd>
                    </>
                  )}
                </dl>
              </details>
              <details className="rail-card" open>
                <summary>이번 단계의 파일<span className="n">{blocks.length}</span><CaretDown size={11} weight="bold" className="chev" /></summary>
                <FileList blocks={blocks} />
              </details>
            </aside>
          )}
        </div>
      </div>
      <LiveRefresh url={`/api/version?p=${slug}&c=${cur?.id ?? ''}`} initial={store.version(slug, cur)} />
    </div>
    </AgentProvider>
  );
}
