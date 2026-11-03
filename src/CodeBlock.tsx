import {useRef,useState} from 'react';
import type {ReactNode} from 'react';
import {Button} from '@base-ui/react/button';
export default function CodeBlock({children}:{children?:ReactNode}){
 const pre=useRef<HTMLPreElement>(null);
 const [state,setState]=useState<'idle'|'copying'|'copied'|'failed'|'selected'>('idle');
 const copy=async()=>{
  setState('copying');
  try{
   if(!pre.current||!navigator.clipboard?.writeText)throw Error();
   await navigator.clipboard.writeText(pre.current.textContent??'');
   setState('copied');
  }catch{setState('failed')}
 };
 const select=()=>{
  if(!pre.current)return;
  const selection=window.getSelection();if(!selection)return;
  pre.current.focus({preventScroll:true});
  const range=document.createRange();range.selectNodeContents(pre.current);selection.removeAllRanges();selection.addRange(range);
  setState('selected');
 };
 return <div className="code-block"><div className="code-tools"><Button type="button" disabled={state==='copying'} onClick={copy}>{state==='copying'?'コピー中…':'コードをコピー'}</Button>{(state==='failed'||state==='selected')&&<Button type="button" onClick={select}>コードを選択</Button>}<span role="status">{state==='copied'?'コピーしました':state==='failed'?'コピーできませんでした。コードを選択し、端末のコピー操作を使ってください。':state==='selected'?'コードを選択しました。端末のコピー操作を使ってください。':''}</span></div><pre ref={pre} tabIndex={-1}>{children}</pre></div>;
}
