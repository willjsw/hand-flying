import { Geist, Geist_Mono } from 'next/font/google';
import './globals.css';

// 빌드 시 받아서 자체 호스팅. 한글은 Geist 에 없으므로 globals.css 폰트 스택의 시스템 한글 글꼴로 넘어간다.
const sans = Geist({ subsets: ['latin'], variable: '--font-geist' });
const mono = Geist_Mono({ subsets: ['latin'], variable: '--font-geist-mono' });

export const metadata = { title: 'hand-flying', icons: { icon: '/brand/emblem-64.png' } };

// 저장해 둔 패널 접힘·너비를 첫 페인트 전에 <html> 에 입힌다(새로고침 때 레이아웃이 튀지 않게).
const PANE_INIT = `try{var r=document.documentElement,s=localStorage;[['left','--side-w'],['right','--rail-w']].forEach(function(p){if(s.getItem('hf:'+p[0]+':closed')==='1')r.dataset[p[0]]='closed';var w=s.getItem('hf:'+p[0]+':w');if(w)r.style.setProperty(p[1],w+'px')})}catch(e){}`;

export default function RootLayout({ children }) {
  return (
    // suppressHydrationWarning: 위 스크립트가 서버 렌더 뒤 <html> 속성을 바꾸기 때문
    <html lang="ko" className={`${sans.variable} ${mono.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: PANE_INIT }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
