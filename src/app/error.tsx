"use client";
export default function ErrorPage({reset}:{reset:()=>void}){return <main style={{padding:"4rem",maxWidth:800,margin:"auto"}}><h1>页面暂时没有展开</h1><p>已保存的故事仍保留在本地。请重试；不要清空浏览器数据。</p><button onClick={reset}>重新打开工作台</button></main>;}
