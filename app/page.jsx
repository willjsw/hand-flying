import Link from 'next/link';
import { FolderSimple } from '@phosphor-icons/react/ssr';
import { listCommits, listProjects } from '@/lib/store.mjs';

export const dynamic = 'force-dynamic';

export default function Home() {
  const projects = listProjects();
  return (
    <main className="home">
      <div className="home-brand">
        <img src="/brand/emblem.png" width={96} height={96} alt="" className="brand-img" />
        <div>
          <h1><img src="/brand/wordmark.png" width={209} height={36} alt="Hand Flying" className="brand-img" /></h1>
          <img src="/brand/tagline.png" width={126} height={16} alt="Take the stick" className="brand-img" />
        </div>
      </div>
      <p className="lead">AI가 제안한 코드를 단계별로 읽고, 직접 타이핑하며 따라가는 작업대입니다.</p>
      {projects.length ? (
        <ul className="projects">
          {projects.map((p) => (
            <li key={p.slug}>
              <Link href={`/p/${p.slug}`}>
                <FolderSimple size={16} weight="bold" />
                <span>
                  <strong>{p.name}</strong>
                  <code>{p.root}</code>
                </span>
                <span className="n">{listCommits(p.slug).length}단계</span>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <div className="empty-state">
          <h2>아직 프로젝트가 없습니다</h2>
          <p>에이전트가 프로젝트 폴더에서 코드를 게시하면 여기에 자동으로 등록됩니다.</p>
          <pre>cd 내-프로젝트{'\n'}hfl post &lt; 게시.md</pre>
        </div>
      )}
    </main>
  );
}
