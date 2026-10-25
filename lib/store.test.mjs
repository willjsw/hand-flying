import assert from 'node:assert/strict';
import test from 'node:test';
import { applyBlock, isApplied, listItems, parseLabel, parsePost, resolveLang, sections, skeleton, widenMarkdown } from './store.mjs';

test('parsePost: 제목·요약·블록·before/after·긴 펜스', () => {
  const p = parsePost(`# 로그인 골격
### 맥락
왜 필요한가
### 목적
무엇이 되는가

## src/a.py#method login
근거 한 줄

\`\`\`python before
def login(): pass
\`\`\`

\`\`\`python
def login(user):
    return user
\`\`\`

## README.md#file
\`\`\`\`markdown
\`\`\`sh
run
\`\`\`
\`\`\`\`
`);
  assert.equal(p.title, '로그인 골격');
  assert.equal(p.summary, '### 맥락\n왜 필요한가\n### 목적\n무엇이 되는가');
  assert.deepEqual(p.blocks.map((b) => [b.file, b.label, b.lang, b.note]), [['src/a.py', 'method login', 'python', '근거 한 줄'], ['README.md', 'file', 'markdown', '']]);
  assert.equal(p.blocks[0].before, 'def login(): pass');
  assert.equal(p.blocks[0].after, 'def login(user):\n    return user');
  assert.equal(p.blocks[1].after, '```sh\nrun\n```');
  const ok = '# t\n### 맥락\nm\n### 목적\np\n';
  assert.throws(() => parsePost(ok + '## a.py#file\n```\nx'), /닫히지/);
  assert.throws(() => parsePost(ok + '## a.py#file\n'), /새 코드/);
  assert.throws(() => parsePost(ok + '## a.py#login\n```\nx\n```'), /라벨이 필요합니다/); // 이름만 쓴 라벨 거부
  assert.throws(() => parsePost('# t\n요약만\n## a.py#file\n```\nx\n```'), /"### 맥락", "### 목적"/);
  assert.throws(() => parsePost('# t\n### 맥락\nm\n## a.py#file\n```\nx\n```'), /"### 목적"/);
});

test('applyBlock / isApplied', () => {
  const file = 'a\nold()\nb\n';
  const mod = { before: 'old()', after: 'new()' };
  assert.equal(isApplied(file, mod), false);
  const out = applyBlock(file, mod);
  assert.equal(out, 'a\nnew()\nb\n');
  assert.equal(isApplied(out, mod), true);
  assert.equal(isApplied('a\n  new( )\nb', { before: 'old()', after: 'new( )' }), true); // 공백 차이 무시

  const del = { before: 'x()\ny()', after: 'x()' }; // 삭제형: 적용 전엔 after가 이미 들어 있음
  assert.equal(isApplied('x()\ny()', del), false);
  assert.equal(isApplied(applyBlock('x()\ny()', del), del), true);

  assert.equal(applyBlock(null, { before: null, after: 'new file' }), 'new file\n');
  assert.throws(() => applyBlock('dup dup', { before: 'dup', after: 'z' }), /정확히 한 번/);
  assert.equal(applyBlock('$&', { before: '$&', after: '$1' }), '$1'); // replace 특수패턴 안 탐
});

test('sections / listItems: 요약 절과 순서 목록', () => {
  const secs = sections('도입\n### 맥락\n배경\n### 순서\n1. 생성자\n   이어지는 설명\n2. 메서드\n- 테스트');
  assert.deepEqual(secs.map((x) => x.title), ['', '맥락', '순서']);
  assert.deepEqual(listItems(secs[2].body), ['생성자 이어지는 설명', '메서드', '테스트']);
  assert.deepEqual(listItems('그냥 문장'), []);
  assert.deepEqual(sections('예전 요약'), [{ title: '', body: '예전 요약' }]); // 절 없는 옛 게시물 호환
});

test('parseLabel: 고정 범주 + 선택 이름, 예전 자유 라벨 호환', () => {
  assert.deepEqual(parseLabel('method afterMessageHandled'), { kind: 'method', name: 'afterMessageHandled' });
  assert.deepEqual(parseLabel('key'), { kind: 'key', name: '' });
  assert.deepEqual(parseLabel('receiptTests'), { kind: null, name: 'receiptTests' });
  assert.deepEqual(parseLabel(''), { kind: null, name: '' });
});

test('resolveLang: 펜스 언어 → 정식 id, 없으면 확장자, 목록 밖 이름은 거부', () => {
  assert.equal(resolveLang('java', 'A.java'), 'java');
  assert.equal(resolveLang('JS', 'a.txt'), 'javascript'); // 별칭·대소문자
  assert.equal(resolveLang('', 'config/app.yml'), 'yaml'); // 확장자
  assert.equal(resolveLang('', 'Dockerfile'), 'dockerfile');
  assert.equal(resolveLang('', '.gitignore'), 'text'); // 모르는 확장자
  assert.equal(resolveLang('java17', 'A.java'), null);
  assert.equal(resolveLang('constructor', 'A.java'), null); // 프로토타입 이름에 속지 않음
  const ok = '# t\n### 맥락\nm\n### 목적\np\n';
  assert.equal(parsePost(ok + '## a.yml#key x\n```\nk: v\n```').blocks[0].lang, 'yaml');
  assert.throws(() => parsePost(ok + '## a.java#method\n```java17\nx\n```'), /코드 언어 "java17"/);
});

test('skeleton: 선언부까지만 남기고 닫는다', () => {
  const java = 'package a;\n\nimport b.C;\n\npublic final class Foo {\n  private int x;\n\n  void run() {\n  }\n}\n';
  assert.equal(skeleton(java, 'java'), 'package a;\n\nimport b.C;\n\npublic final class Foo {\n}\n');
  // 한 줄에서 닫히는 import { } 는 건너뛰고 처음 열리는 선언에서 멈춘다
  assert.equal(skeleton("import { a } from 'x';\nexport function f() {\n  return a;\n}\n", 'typescript'), "import { a } from 'x';\nexport function f() {\n}\n");
  // C 는 main: 앞의 다른 함수는 빼고 #include 만
  const c = '#include <stdio.h>\n\nstatic int add(int a, int b) {\n  return a + b;\n}\n\nint main(void)\n{\n  return add(1, 2);\n}\n';
  assert.equal(skeleton(c, 'c'), '#include <stdio.h>\n\nint main(void)\n{\n}\n');
  assert.equal(skeleton('def f():\n    pass\n', 'python'), '');
  assert.equal(skeleton('public record P(int x) {}\n', 'java'), '');
});

test('widenMarkdown: 표·펜스가 렌더링되는 단위까지 넓힌다', () => {
  const table = '# T\n\n| a | b |\n| - | - |\n| 1 | 2 |\n\nend\n';
  const w = widenMarkdown(table, { before: '| 1 | 2 |', after: '| 1 | 2 |\n| 3 | 4 |' });
  assert.equal(w.before, '| a | b |\n| - | - |\n| 1 | 2 |');
  assert.equal(w.after, '| a | b |\n| - | - |\n| 1 | 2 |\n| 3 | 4 |');
  // 반영 뒤(파일에 after 가 있음)에도 같은 둘레를 붙인다
  const applied = table.replace('| 1 | 2 |', '| 1 | 2 |\n| 3 | 4 |');
  assert.deepEqual(widenMarkdown(applied, { before: '| 1 | 2 |', after: '| 1 | 2 |\n| 3 | 4 |' }), w);
  // 펜스 안의 빈 줄에서 멈추지 않고 펜스 전체를 담는다
  const fence = 'intro\n\n```\nx\n\ny\n```\n\nafter\n';
  assert.equal(widenMarkdown(fence, { before: 'y', after: 'z' }).before, '```\nx\n\ny\n```');
  // 이미 한 덩어리면 그대로
  const b = { before: 'end', after: 'fin' };
  assert.equal(widenMarkdown(table, b), b);
});
