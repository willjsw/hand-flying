import assert from 'node:assert/strict';
import test from 'node:test';
import { applyBlock, isApplied, listItems, parseLabel, parsePost, sections } from './store.mjs';

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
