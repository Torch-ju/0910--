import type { Project } from "./comic";
export function download(blob:Blob,name:string){const url=URL.createObjectURL(blob);const a=document.createElement("a");a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),30000);}
export function exportScript(p:Project){const text=`# ${p.title}\n\n${p.summary}\n\n## 剧本\n\n${p.script}\n\n## 角色设定\n\n${p.characters.map(c=>`### ${c.name} · ${c.role}\n${c.appearance}\n${c.personality}`).join("\n\n")}\n\n## 分镜\n\n${p.panels.map((s,i)=>`### ${i+1}. ${s.title}（${s.shot}）\n${s.scene}\n对白：${s.dialogue}`).join("\n\n")}`;download(new Blob([text],{type:"text/markdown;charset=utf-8"}),`${p.title}.md`);}
export async function exportComic(p:Project){
 if(p.boardStale||p.panels.some(s=>!s.image||s.stale))throw new Error("请先完成或更新所有画面，再导出漫画。");
 const canvas=document.createElement("canvas"),ctx=canvas.getContext("2d");if(!ctx)throw new Error("浏览器不支持图片导出。");
 const wrap=(text:string,width:number)=>{const lines:string[]=[];let line="";for(const c of text){if(c==="\n"){lines.push(line);line="";continue;}if(ctx.measureText(line+c).width>width){lines.push(line);line=c;}else line+=c;}if(line)lines.push(line);return lines;};
 ctx.font='25px Arial,"PingFang SC",sans-serif';
 const captions=p.panels.map(s=>wrap(s.dialogue,680));
 const rowHeights=Array.from({length:Math.ceil(p.panels.length/2)},(_,i)=>510+Math.max(captions[i*2].length,captions[i*2+1]?.length||0)*36);
 canvas.width=1600;canvas.height=180+rowHeights.reduce((a,b)=>a+b,0)+55;
 ctx.fillStyle="#fff";ctx.fillRect(0,0,canvas.width,canvas.height);ctx.fillStyle="#242132";ctx.font='bold 48px Arial,"PingFang SC",sans-serif';ctx.fillText(p.title.slice(0,26),60,85);ctx.font='23px Arial,"PingFang SC",sans-serif';ctx.fillStyle="#7d758a";ctx.fillText(`${p.style} · ${p.panels.length} 格漫画${p.demo?" · 示例作品":""}`,60,130);
 let y=170;
 for(let i=0;i<p.panels.length;i++){
  const x=60+(i%2)*760;const img=new Image();img.src=p.panels[i].image!;await img.decode();
  ctx.drawImage(img,x,y,720,480);ctx.strokeStyle="#282433";ctx.lineWidth=2;ctx.strokeRect(x,y,720,480);
  ctx.fillStyle="#fff";ctx.fillRect(x+14,y+14,40,36);ctx.fillStyle="#292335";ctx.font="bold 22px Arial";ctx.fillText(String(i+1).padStart(2,"0"),x+20,y+40);
  ctx.font='25px Arial,"PingFang SC",sans-serif';captions[i].forEach((line,j)=>ctx.fillText(line,x+12,y+516+j*36));
  if(i%2===1||i===p.panels.length-1)y+=rowHeights[Math.floor(i/2)];
 }
 ctx.font="18px Arial";ctx.fillStyle="#999";ctx.fillText("漫想 · COMIC STUDIO",60,canvas.height-20);
 const blob=await new Promise<Blob|null>(r=>canvas.toBlob(r,"image/png"));if(!blob)throw new Error("导出失败，请重试。");download(blob,`${p.title}.png`);
}
