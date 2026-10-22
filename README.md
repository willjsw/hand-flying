<p align="center">
  <img src="public/brand/emblem.png" width="160" alt="">
  <br>
  <img src="public/brand/wordmark.png" width="300" alt="Hand Flying">
  <br>
  <img src="public/brand/tagline.png" width="150" alt="Take the stick">
</p>

# hand-flying

AI 코딩 에이전트가 짠 코드를 **파일에 바로 쓰지 않고**, 단계별 블록으로 로컬 뷰어에 게시하게 하는 도구입니다.
개발자는 뷰어를 보며 코드를 직접 타이핑하고, 필요할 때만 "AI 작성"으로 맡깁니다.

에이전트가 모든 코드를 알아서 써 버리면 결과만 남고, 무엇을 왜 그렇게 짰는지는 놓치기 쉽습니다.
처음 구조를 잡을 때, 낯선 언어나 기술을 쓸 때처럼 **직접 손으로 짜며 이해해야 하는 순간**에 쓰는 수동 비행(hand flying) 모드입니다.

뷰어는 대화 도구가 아니라 **코드 가시성 도구**입니다. 목적은 세 가지뿐입니다.

- 코드 추적: 어떤 파일의 어느 부분이 어떻게 바뀌는지
- 구현 범위의 큰 그림: 이 단계의 맥락·목적·순서
- 현재 작업 흐름 추적: 어느 단계까지 반영·완료됐는지

## 구성

| 구성 | 위치 | 역할 |
| --- | --- | --- |
| 뷰어 | `app/` (Next.js) | 단계·코드 블록·변경사항을 보여 주는 로컬 웹 화면. 미리 빌드해 두고 `next start` 로 띄운다 |
| CLI `hfl` | `bin/hfl.mjs` | 에이전트가 코드를 게시(`hfl post`)하고 화면 이벤트를 받는(`hfl wait`) 명령. 뷰어 기동·종료도 맡는다 |
| 스킬 | `skill/hand-flying/SKILL.md` | Claude Code 에이전트가 따르는 작업 규칙(게시 형식, 블록 크기, 이벤트 처리) |
| 데이터 | `~/.hand-flying/` | 프로젝트별 단계·이벤트 기록. 작업 중인 저장소에는 아무것도 만들지 않는다 |

## 요구 사항

- macOS 또는 Linux
- Node.js 22 이상
- [Claude Code](https://claude.com/claude-code) (에이전트와 함께 쓸 때)

## 설치

```bash
git clone https://github.com/willjsw/hand-flying.git
cd hand-flying
npm install
npm link          # hfl 명령을 어디서나 쓸 수 있게 등록
```

스킬을 Claude Code 에 연결합니다. 모든 프로젝트에서 쓰려면 사용자 스킬 폴더에 링크를 둡니다.

```bash
ln -s "$(pwd)/skill/hand-flying" ~/.claude/skills/hand-flying
```

특정 프로젝트에서만 쓰려면 그 프로젝트의 `.claude/skills/hand-flying` 에 링크를 두고,
링크가 절대경로이므로 `.git/info/exclude` 에 넣어 커밋되지 않게 합니다.

뷰어를 띄웁니다. 첫 실행 때는 빌드부터 하므로 조금 걸립니다.

```bash
hfl start          # 백그라운드 실행 → http://127.0.0.1:4100
hfl stop           # 종료
```

에이전트가 스킬을 따르면 `hfl start` 를 스스로 실행하므로, 평소에는 직접 켜지 않아도 됩니다.

## 사용 가이드

### 1. 에이전트에게 맡기기

작업할 프로젝트 폴더에서 Claude Code 세션을 열고 요청합니다.

```
/hand-flying 로그인 API 의 서비스 계층 골격 잡아줘
```

에이전트는 파일을 직접 고치지 않고 `hfl post` 로 첫 단계를 게시한 뒤, `hfl wait` 로 화면 이벤트를 기다립니다.
`http://127.0.0.1:4100` 을 열면 프로젝트가 자동으로 등록되어 있습니다.

Claude Code 의 권한 확인 창이 매번 뜨는 것이 번거로우면 프로젝트의 `.claude/settings.local.json` 에 `"Bash(hfl:*)"` 를 허용 목록으로 추가합니다.

### 2. 화면 구성

```
┌ 사이드바 ─────────┬ 상단: 프로젝트 › 브랜치 › 단계 ───────────────┬ 속성 패널 ─┐
│ ◧ 로고            │ 단계 제목                                     │ 진행·파일 일치 ◨│
│ 모든 프로젝트      │ (Todo) 10. 18. 오후 07:43 게시 · 2시간 전      │ 브랜치·게시 시각│
│ 브랜치 ▸ 단계 목록 │ Context / Purpose   (이 단계를 왜, 무엇을 위해) │ 이번 단계 파일 │
│                   │ Procedure           (누르면 해당 블록으로 이동) │           │
│                   │ ┌ 코드 블록 ──────────────────────────────┐ │           │
│                   │ │ ⌄ </> 파일명 method                Todo │ │           │
│                   │ │       src/main/java/…/                  │ │           │
│                   │ │ Explain · 코드(실제 줄 번호) · 변경사항   │ │           │
│                   │ │ 복사  AI 작성                     완료   │ │           │
│                   │ └─────────────────────────────────────────┘ │           │
│ 프로젝트           │ AI 전체 구현 · 수정 요청 입력칸               │           │
│ 에이전트 대기 중   │                                               │           │
└───────────────────┴───────────────────────────────────────────────┴───────────┘
```

- 좌우 패널은 각 패널 맨 위의 버튼(◧ ◨)으로 접습니다. 버튼은 접혀도 같은 자리에 남습니다. 경계선을 끌면 너비가 바뀌고(키보드 ← → 도 됨), 상태는 새로고침해도 유지됩니다.
- 제목 밑에는 단계 상태(Todo · In progress · Done)와 최초 게시 시각이 보입니다.
- Procedure 항목을 누르면 해당 코드 블록으로 부드럽게 이동합니다.
- 블록 머리를 누르면 블록을 접고 펼 수 있습니다.

### 3. 한 단계를 따라가는 흐름

1. **읽기**: Context·Purpose 로 이 단계가 왜 필요한지 보고, Procedure 로 순서를 확인합니다. 각 블록의 설명(Explain)은 첫 문장에서 무엇을 왜 바꾸는지 말합니다.
2. **직접 타이핑**: 에디터에서 블록을 따라 칩니다. 새 파일 블록에는 "파일 생성" 버튼이 있어, 누르면 선언부까지만 담은 파일(Java 는 class 선언, C 는 main)이 만들어지고 본문부터 치면 됩니다. 저장하면 공백 차이는 무시하고 파일과 대조해 상태가 **Applied** 로 바뀝니다.
3. **완료**: 블록마다 "완료" 를 누르면 **Done**. 단계의 블록이 모두 Done 이 되면 에이전트가 다음 단계를 게시합니다.
4. **맡기기**: 직접 치지 않을 블록은 "AI 작성", 남은 블록 전부는 "AI 전체 구현" 을 누릅니다. 에이전트가 반영을 마치면 **AI Writing** 에서 **Done** 으로 저절로 바뀝니다.
5. **고치기**: 하단 입력칸에 수정 요청을 적으면, 에이전트가 답글 대신 **같은 단계의 코드를 바로 교체**합니다. 코드 블록을 누르면 입력칸에 그 블록이 칩(파일명 + 범주, × 로 빼기)으로 붙고, 보낸 요청은 그 코드에 대한 것으로 에이전트에 전달됩니다. "왜 이렇게 했어?" 같은 질문도 블록 설명을 보강하는 것으로 답합니다.

### 4. 블록 상태

| 상태 | 뜻 |
| --- | --- |
| Todo | 아직 파일에 반영되지 않음 |
| Applied | 파일 내용과 일치함 (직접 쳤거나 AI 가 반영) |
| Done | 완료 처리됨 |
| AI Writing | 에이전트가 작성 중 |
| Outdated | 이후 단계가 파일을 바꿔, 이 블록을 그대로 적용할 수 없음 |

### 5. 에이전트 연결

사이드바 아래에 에이전트 상태가 보입니다.

- **대기 중**: `hfl wait` 가 돌고 있음. AI 버튼을 쓸 수 있음
- **작업 중**: 이벤트를 받아 처리하는 중
- **연결 끊김**: 대기가 멈춤. AI 버튼이 막힘

끊겼을 때는 화면에 나오는 문장을 복사해 에이전트 세션에 보내면 다시 붙습니다.
세션을 닫았다면 프로젝트 폴더에서 새 세션을 열고 같은 문장을 보냅니다.

```
/hand-flying 대기 재개
```

## CLI

| 명령 | 설명 |
| --- | --- |
| `hfl start [--port 4100]` | 뷰어를 백그라운드로 시작. 빌드가 없으면 먼저 빌드. 이미 실행 중이면 주소만 출력 |
| `hfl stop` | 백그라운드 뷰어 종료 |
| `hfl serve [--port 4100]` | 뷰어를 포그라운드로 실행 (로그를 바로 볼 때) |
| `hfl build` | 뷰어 재빌드 |
| `hfl post [--branch 이름] < 게시.md` | 새 단계 게시 (stdin) |
| `hfl post --amend <커밋id> < 게시.md` | 기존 단계를 수정본으로 교체 |
| `hfl wait [--timeout 600]` | 화면 이벤트(수정 요청·AI 작성 요청·완료)를 기다림 |
| `hfl apply <커밋id> [블록id…]` | 게시된 블록을 파일에 그대로 반영 |
| `hfl done <커밋id> [블록id…]` | 완료 처리 (AI 작성 요청을 끝냈다는 알림) |

공통 옵션 `--root <경로>`: 대상 프로젝트 (기본은 현재 폴더의 git 루트)

## 게시 형식

에이전트가 쓰는 형식입니다. 자세한 규칙은 [skill/hand-flying/SKILL.md](skill/hand-flying/SKILL.md) 에 있습니다.

````markdown
# 사용자 단건 조회 예외 처리
### 맥락
findById 가 null 을 돌려줘 호출부마다 null 검사가 흩어져 있다.
### 목적
없는 사용자를 예외로 알려 호출부를 단순하게 만든다.
### 순서
1. UserService.findById 가 UserNotFound 를 던지게 바꾼다
2. 테스트로 예외 경로를 확인한다

## src/main/java/com/example/UserService.java#method findById
단건 조회를, 없는 사용자를 호출부가 구분할 수 있도록, null 대신 예외를 던지는 방향으로 바꾼다.

```java before
    public User findById(long id) {
        return null;
    }
```

```java
    public User findById(long id) {
        return repository.findById(id)
            .orElseThrow(() -> new UserNotFound(id));
    }
```
````

- `### 맥락`, `### 목적` 은 필수입니다. 빠지면 게시가 거부됩니다.
- 블록 머리는 `## 경로#종류 [이름]` 입니다. 종류는 아래 중 하나만 씁니다.
  `imports` `field` `constructor` `method` `type` `test` `block` `query` `key` `section` `file`
- 코드 펜스에는 언어 id 를 씁니다(예: ` ```java `). 블록에 기록되어 하이라이트에 쓰이고, 생략하면 확장자로 정합니다. 목록 밖 이름이면 게시가 거부됩니다.
  지원 언어: java, kotlin, groovy, scala, c, cpp, csharp, go, rust, python, ruby, php, swift, javascript, typescript, jsx, tsx, html, css, scss, vue, json, yaml, toml, ini, properties, xml, sql, bash, dockerfile, markdown, diff, text
- `before` 는 지금 파일 내용 그대로여야 하고, 파일에서 정확히 한 번 나와야 합니다. 줄 번호는 CLI 가 실제 파일에서 계산합니다.

## 설정

| 환경 변수 | 기본값 | 설명 |
| --- | --- | --- |
| `HFL_HOME` | `~/.hand-flying` | 데이터·서버 로그·PID 파일 위치 |
| `HF_PORT` | `4100` | 뷰어 포트 |

## 개발

```bash
npm run dev       # 개발 서버 (http://127.0.0.1:4100)
npm test          # 게시 형식 파서·블록 반영 로직 테스트
hfl build && hfl stop && hfl start   # 고친 화면을 백그라운드 뷰어에 반영
```

## 알아 둘 점

- 뷰어는 `127.0.0.1` 에만 열립니다. 프로젝트 코드와 경로를 보여 주고 에이전트에게 작성 요청을 보낼 수 있으므로 외부에서 접속하게 바꾸지 마세요.
- "AI 작성" 으로 반영되는 코드는 에이전트가 `hfl apply` 로 씁니다. Claude Code 의 파일 수정 금지 규칙(`permissions.deny`)이 걸린 경로에는 블록을 게시하지 않도록 유의하세요.
- 한 프로젝트에는 `hfl wait` 를 돌리는 에이전트 세션을 하나만 두는 것을 전제로 합니다.
