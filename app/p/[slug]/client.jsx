'use client';
import { useRouter } from 'next/navigation';
import { createContext, useContext, useEffect, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { ArrowUp, Check, CheckCircle, Clock, Copy, Plugs, PlugsConnected, SidebarSimple, StarFour } from '@phosphor-icons/react';
import { requestAiWrite, requestAiWriteAll, sendRequest, toggleDone } from './actions';

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

// 왼쪽 사이드바 맨 아래
export function AgentStatus() {
  const { state, at } = useAgent();
  const [copied, setCopied] = useState(false);
  if (state === 'waiting') {
    return <div className="agent ok" role="status"><PlugsConnected size={15} weight="bold" />에이전트 대기 중</div>;
  }
  if (state === 'working') {
    return <div className="agent busy" role="status"><AiStars size={14} />에이전트 작업 중</div>;
  }
  const copy = async () => {
    await navigator.clipboard.writeText(RESUME);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  return (
    <div className="agent off" role="status">
      <div className="agent-head">
        <Plugs size={15} weight="bold" />
        {at ? '에이전트 연결 끊김' : '에이전트 연결 안 됨'}
        {at && <small suppressHydrationWarning>{ago(at)}</small>}
      </div>
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

export function BlockActions({ ids, code, done, applied, stale, aiPending, overwrite }) {
  const offline = useAgent().state === 'off';
  const [copied, setCopied] = useState(false);
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
  // 직접 타이핑이 기본 경로: 파일이 일치하면 "완료 체크"가 주 버튼이 되고, AI 작성은 보조로 둔다.
  const doneClass = done ? 'btn done' : applied ? 'btn primary' : 'btn';
  return (
    <div className="actions">
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
      <span className="spacer" />
      <form action={toggleDone.bind(null, ids)}>
        <Submit className={doneClass} title={done ? '누르면 완료를 해제합니다' : undefined}>
          {done ? <CheckCircle size={14} weight="fill" /> : <Check size={14} weight="bold" />}
          {done ? '완료됨' : '완료 체크'}
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
  const submitOnEnter = (e) => {
    // isComposing: 한글 조합 중 Enter는 글자 확정이지 전송이 아님
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      e.currentTarget.form.requestSubmit();
    }
  };
  return (
    <div className="request">
      <form className="composer" action={sendRequest.bind(null, ids)}>
        <textarea id="hf-req" name="text" rows={1} placeholder="이 단계 코드에 반영할 수정 사항" onKeyDown={submitOnEnter} />
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
