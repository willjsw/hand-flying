'use client';
import { useRouter } from 'next/navigation';
import { createContext, useContext, useEffect, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { ArrowUp, Check, CheckCircle, Clock, Copy, FilePlus, SidebarSimple, StarFour, X } from '@phosphor-icons/react';
import { createFile, requestAiWrite, requestAiWriteAll, sendRequest, toggleDone } from './actions';

// ── 에이전트 연결 상태: 3초마다 /api/agent 를 보고 화면 전체에 나눠 준다 ──
const AgentCtx = createContext({ state: 'off', at: null });
const useAgent = () => useContext(AgentCtx);
const OFFLINE_TITLE = '에이전트 연결이 끊겨 있습니다. 왼쪽 아래 안내로 다시 연결하세요';
const RESUME = '/hand-flying 대기 재개';

export function AgentProvider({ slug, initial, children }) {
  const [agent, setAgent] = useState(initial);
  useEffect(() => {
    const t = setInterval(async () => {
      const a = await fetch(`/api/agent?p=${slug}`, { cache: 'no-store' }).then((r) => r.json()).catch(() => null);
      if (a) setAgent((prev) => (prev.state === a.state && prev.at === a.at ? prev : a));
    }, 3000);
    return () => clearInterval(t);
  }, [slug]);
  return <AgentCtx.Provider value={agent}>{children}</AgentCtx.Provider>;
}

const ago = (at) => {
  const m = Math.round((Date.now() - at) / 60000);
  return m < 1 ? '방금' : m < 60 ? `${m}분 전` : `${Math.round(m / 60)}시간 전`;
};

const AGENT_LABEL = { waiting: '대기 중', working: '작업 중' };

// 사이드바 아래 프로젝트 줄 오른쪽: 에이전트 연결 상태를 색 점으로 (초록 대기 / 노랑 작업 / 빨강 끊김)
export function AgentDot() {
  const { state, at } = useAgent();
  const label = AGENT_LABEL[state] ?? (at ? '연결 끊김' : '연결 안 됨');
  const title = `에이전트 ${label}${state === 'off' && at ? ` · 마지막 응답 ${ago(at)}` : ''}`;
  return (
    <span className={`agent-dot ${state}`} role="status" title={title} suppressHydrationWarning>
      <i aria-hidden="true" />{label}
    </span>
  );
}

// 연결이 끊겼을 때만: 다시 붙이는 방법
export function AgentReconnect() {
  const { state } = useAgent();
  const [copied, setCopied] = useState(false);
  if (state !== 'off') return null;
  const copy = async () => {
    await navigator.clipboard.writeText(RESUME);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  return (
    <div className="agent-help">
      <p>AI 작성은 연결된 뒤에 쓸 수 있습니다. 에이전트 세션에 아래 문장을 보내면 다시 붙습니다.</p>
      <button type="button" className="resume" onClick={copy} title="복사">
        <code>{RESUME}</code>
        {copied ? <Check size={13} weight="bold" /> : <Copy size={13} weight="bold" />}
      </button>
    </div>
  );
}

function Submit({ children, ...props }) {
  const { pending } = useFormStatus();
  return <button {...props} disabled={pending || props.disabled}>{children}</button>;
}

// AI 표시: 큰 별 + 작은 별. 라이브러리에 같은 모양이 없어 StarFour 두 개를 겹쳐 만든다.
export function AiStars({ size = 14 }) {
  return (
    <span className="ai-stars" style={{ width: size, height: size }} aria-hidden="true">
      <StarFour size={Math.round(size * 0.8)} weight="bold" />
      <StarFour size={Math.round(size * 0.45)} weight="bold" className="s" />
    </span>
  );
}

export function BlockActions({ ids, code, done, applied, stale, aiPending, overwrite, creatable, markdown }) {
  const offline = useAgent().state === 'off';
  const [copied, setCopied] = useState(false);
  // 마크다운 블록: 코드와 렌더링 결과를 오간다. 블록에 data-view 를 달면 CSS 가 둘 중 하나만 보인다
  const [view, setView] = useState('code');
  const show = (v) => {
    setView(v);
    document.getElementById(ids.bid)?.setAttribute('data-view', v);
  };
  const copy = async () => {
    await navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  const confirmOverwrite = (e) => {
    if (overwrite && !confirm('파일에 이미 입력한 내용이 있습니다. AI 코드로 덮어쓸까요?')) e.preventDefault();
  };
  const aiTitle = aiPending ? '에이전트가 작성 중입니다. 끝나면 자동으로 완료됨으로 바뀝니다'
    : applied ? '이미 파일과 일치합니다'
      : stale ? '파일이 이후 단계에서 바뀌어 적용할 수 없습니다'
        : offline ? OFFLINE_TITLE : undefined;
  // 완료: 블록을 바로 접고 다음 블록 머리로 넘어간다(마지막이면 그 블록 머리).
  // 서버 갱신을 기다렸다 접으면 위쪽 높이가 갑자기 줄어 스크롤이 엉뚱한 곳(맨 위)으로 튄다.
  const markDone = async () => {
    if (!done) {
      const el = document.getElementById(ids.bid);
      const next = el?.nextElementSibling?.matches('details.block') ? el.nextElementSibling : el;
      if (el) el.open = false;
      next?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
    await toggleDone(ids);
  };
  // 직접 타이핑이 기본 경로: 파일이 일치하면 "완료 체크"가 주 버튼이 되고, AI 작성은 보조로 둔다.
  const doneClass = done ? 'btn done' : applied ? 'btn primary' : 'btn';
  return (
    <div className="actions">
      {creatable && (
        <form action={createFile.bind(null, ids)}>
          <Submit className="btn ghost" title="본문 없이 선언부까지만 담은 파일을 만듭니다">
            <FilePlus size={14} weight="bold" />파일 생성
          </Submit>
        </form>
      )}
      <button type="button" className="btn ghost" onClick={copy}>
        {copied ? <Check size={14} weight="bold" /> : <Copy size={14} weight="bold" />}
        {copied ? '복사됨' : '복사'}
      </button>
      <form action={requestAiWrite.bind(null, ids)} onSubmit={confirmOverwrite}>
        <Submit className={`btn ghost${aiPending ? ' ai-busy' : ''}`} disabled={aiPending || done || applied || stale || offline} title={aiTitle}>
          <AiStars size={14} />
          {aiPending ? 'AI 작업중' : 'AI 작성'}
        </Submit>
      </form>
      {markdown && (
        <span className="seg" role="group" aria-label="마크다운 보기">
          <button type="button" aria-pressed={view === 'code'} onClick={() => show('code')}>Code</button>
          <button type="button" aria-pressed={view === 'preview'} onClick={() => show('preview')}>Preview</button>
        </span>
      )}
      <span className="spacer" />
      <form action={markDone}>
        <Submit className={doneClass} title={done ? '누르면 완료를 해제합니다' : undefined}>
          {done ? <CheckCircle size={14} weight="fill" /> : <Check size={14} weight="bold" />}
          {done ? '완료됨' : '완료'}
        </Submit>
      </form>
    </div>
  );
}

// 블록 목록 맨 아래: 남은 블록 전부를 에이전트에게 맡긴다
export function AiAllButton({ ids, count, busy }) {
  const offline = useAgent().state === 'off';
  const confirmAll = (e) => {
    if (!confirm(`남은 블록 ${count}개를 AI가 작성합니다. 프로젝트 파일이 바뀝니다. 진행할까요?`)) e.preventDefault();
  };
  return (
    <form className="ai-all" action={requestAiWriteAll.bind(null, ids)} onSubmit={confirmAll}>
      <Submit className={`btn${busy ? ' ai-busy' : count && !offline ? ' primary' : ''}`} disabled={!count || offline} title={offline ? OFFLINE_TITLE : undefined}>
        <AiStars size={14} />
        {count ? `AI 전체 구현 (${count})` : busy ? `AI 작업중 (${busy})` : 'AI 전체 구현'}
      </Submit>
    </form>
  );
}

export function RequestBar({ ids, pending }) {
  // 화면에서 선택한 코드 블록. 요청과 함께 보내 "이 코드를 고쳐 달라"는 뜻이 되게 한다
  const [refs, setRefs] = useState([]);
  useEffect(() => {
    const pick = (e) => {
      const el = e.target.closest?.('.doc details.block');
      // 머리글은 접기/펴기, 버튼·링크는 제 할 일. 코드를 드래그해 복사하려는 중이면 고르지 않는다
      if (!el || e.target.closest('summary, button, a') || String(getSelection())) return;
      const r = { bid: el.id, name: el.querySelector('.fname')?.textContent, kind: el.querySelector('.bhead .tag')?.textContent };
      setRefs((rs) => (rs.some((x) => x.bid === r.bid) ? rs : [...rs, r]));
      document.getElementById('hf-req')?.focus();
    };
    document.addEventListener('click', pick);
    return () => document.removeEventListener('click', pick);
  }, []);
  const send = async (form) => {
    if (!String(form.get('text') ?? '').trim()) return;
    await sendRequest(ids, form);
    setRefs([]);
  };
  const submitOnEnter = (e) => {
    // isComposing: 한글 조합 중 Enter는 글자 확정이지 전송이 아님
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      e.currentTarget.form.requestSubmit();
    }
  };
  return (
    <div className="request">
      {/* 선택한 블록 테두리 강조 */}
      {refs.length > 0 && <style>{`${refs.map((r) => `.doc [id="${r.bid}"]`).join(',')}{border-color:var(--focus)}`}</style>}
      <form className="composer" action={send}>
        {refs.length > 0 && (
          <div className="refs">
            {refs.map((r) => (
              <span key={r.bid} className="ref">
                <input type="hidden" name="blocks" value={r.bid} />
                <span className="fn" title={r.name}>{r.name}</span>
                {r.kind && <span className={`tag k-${r.kind}`}>{r.kind}</span>}
                <button type="button" aria-label={`${r.name} 빼기`} onClick={() => setRefs((rs) => rs.filter((x) => x.bid !== r.bid))}>
                  <X size={11} weight="bold" />
                </button>
              </span>
            ))}
          </div>
        )}
        <textarea id="hf-req" name="text" rows={1} placeholder={refs.length ? '선택한 코드에 반영할 수정 사항' : '이 단계 코드에 반영할 수정 사항 · 코드 블록을 누르면 대상으로 선택됩니다'} onKeyDown={submitOnEnter} />
        <div className="composer-foot">
          <label htmlFor="hf-req">수정 요청</label>
          {pending > 0 && <span className="pending"><Clock size={12} weight="bold" />반영 대기 {pending}건</span>}
          <span className="keys">
            <kbd>Enter</kbd><span>보내기</span>
            <kbd>Shift</kbd><kbd>Enter</kbd><span>줄바꿈</span>
          </span>
          <Submit className="btn primary"><ArrowUp size={13} weight="bold" />보내기</Submit>
        </div>
      </form>
    </div>
  );
}

// ── 좌우 패널: 접기(html[data-left|right="closed"]) + 너비(--side-w / --rail-w) ──
// 상태는 <html> 에만 둔다(드래그 중 React 렌더 없음). 저장값은 layout 의 스크립트가 첫 페인트 전에 입힌다.
const PANES = {
  left: { prop: '--side-w', min: 180, max: 420, of: '.side' },
  right: { prop: '--rail-w', min: 220, max: 480, of: '.rail' },
};
const save = (k, v) => { try { localStorage.setItem(k, String(v)); } catch {} };

export function PaneToggle({ pane, label }) {
  const toggle = () => {
    const r = document.documentElement;
    const closing = r.dataset[pane] !== 'closed';
    if (closing) r.dataset[pane] = 'closed';
    else delete r.dataset[pane];
    save(`hf:${pane}:closed`, closing ? 1 : 0);
  };
  return (
    <button type="button" className={`icon-btn pane-${pane}`} onClick={toggle} aria-label={label} title={label}>
      <SidebarSimple size={16} weight="bold" />
    </button>
  );
}

export function Resizer({ pane }) {
  const { prop, min, max, of } = PANES[pane];
  const setWidth = (w) => {
    const v = Math.round(Math.min(max, Math.max(min, w)));
    document.documentElement.style.setProperty(prop, `${v}px`);
    return v;
  };
  const down = (e) => {
    const el = e.currentTarget;
    const box = document.querySelector(of).getBoundingClientRect();
    el.setPointerCapture(e.pointerId);
    document.documentElement.classList.add('resizing');
    let w;
    const move = (ev) => { w = setWidth(pane === 'left' ? ev.clientX - box.left : box.right - ev.clientX); };
    const up = () => {
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      document.documentElement.classList.remove('resizing');
      if (w) save(`hf:${pane}:w`, w);
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
  };
  // 키보드: ← → 로 16px 씩
  const key = (e) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    // 전환 애니메이션 중에는 실측 너비가 늦으므로, 마지막으로 정한 변수 값을 기준으로 삼는다
    const cur = parseFloat(getComputedStyle(document.documentElement).getPropertyValue(prop))
      || document.querySelector(of).getBoundingClientRect().width;
    const grow = (e.key === 'ArrowRight') === (pane === 'left');
    save(`hf:${pane}:w`, setWidth(cur + (grow ? 16 : -16)));
  };
  return (
    <div
      className={`resizer resizer-${pane}`}
      role="separator"
      aria-orientation="vertical"
      aria-label={pane === 'left' ? '왼쪽 사이드바 너비' : '오른쪽 패널 너비'}
      tabIndex={0}
      onPointerDown={down}
      onKeyDown={key}
    />
  );
}

// 사전 빌드된 페이지가 데이터 변화(에이전트 게시, 파일 저장, 메시지 수신)를 따라가도록 버전만 폴링
export function LiveRefresh({ url, initial }) {
  const router = useRouter();
  useEffect(() => {
    let v = initial;
    const t = setInterval(async () => {
      const now = await fetch(url, { cache: 'no-store' }).then((r) => r.text()).catch(() => v);
      if (now !== v) {
        v = now;
        router.refresh();
      }
    }, 1500);
    return () => clearInterval(t);
  }, [url, initial, router]);
  return null;
}
