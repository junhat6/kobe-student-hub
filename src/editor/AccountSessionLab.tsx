import OwnPublications from './OwnPublications';
import ProjectRegistration from './ProjectRegistration';
import {useCallback,useEffect,useLayoutEffect,useMemo,useRef,useState} from 'react';
import {Button} from '@base-ui/react/button';
import DraftEditor from './DraftEditor';
import PublicProfileSetup from './PublicProfileSetup';
import {createAuthorSessionGuard,createSessionClient,SessionClientError,type AuthorSessionGuard} from './session-client';
import './session-lab.css';
type Phase='checking'|'active'|'review'|'signed-out'|'unverified'|'logout-pending'|'logout-unknown';
export default function AccountSessionLab({privateOnly=false}:{privateOnly?:boolean}){
 const client=useMemo(()=>createSessionClient(),[]);const mounted=useRef(true);const revision=useRef(0);const checkingRef=useRef(false);const logoutRef=useRef(false);const inspection=useRef<AbortController|null>(null);
 const guard=useRef<AuthorSessionGuard|null>(null);const tokenRef=useRef<string|null>(null);const privatePanel=useRef<HTMLDivElement>(null);
 const [sessionToken,setSessionToken]=useState<string|null>(null);const [candidate,setCandidate]=useState<string|null>(null);const [concealed,setConcealed]=useState(true);const [phase,setPhase]=useState<Phase>('checking');const [checking,setChecking]=useState(false);const [loggingOut,setLoggingOut]=useState(false);const [message,setMessage]=useState('既存のセッションを確認しています…'),[inspectionGeneration,setInspectionGeneration]=useState(0);
 const conceal=()=>{if(privatePanel.current){privatePanel.current.hidden=true;privatePanel.current.inert=true}setConcealed(true)};
 const reveal=()=>{setConcealed(false)};
 function resetPending(){revision.current++;inspection.current?.abort();inspection.current=null;checkingRef.current=false;setChecking(false);guard.current?.invalidate();guard.current=null}
 function clearPrivate(){conceal();resetPending();tokenRef.current=null;setSessionToken(null);setCandidate(null)}
 function unknown(){conceal();resetPending();setCandidate(null);setPhase('unverified');setMessage(tokenRef.current?'セッションを確認できませんでした。手元の編集はこのページのメモリ内に保持したまま隠しています。再確認できるまで操作できません。':'セッションを確認できませんでした。編集画面は開いていません。もう一度確認してください。')}
 function install(current:string){
  guard.current?.invalidate();
  const bound=createAuthorSessionGuard({csrfToken:current,origin:location.origin,onMismatch:kind=>{if(!mounted.current||guard.current!==bound)return;clearPrivate();setPhase(kind==='signed-out'?'signed-out':'review');setMessage(kind==='signed-out'?'現在のセッションは無効です。前の編集画面は閉じています。':'別のセッションを検出したため、前の編集画面を閉じました。セッションを再確認してから続行してください。')},onUnverified:()=>{if(mounted.current&&guard.current===bound)unknown()}});
  guard.current=bound;tokenRef.current=current;setSessionToken(current);
 }
 // SDK instances keep this stable proxy across a hidden/same-session recovery.
 const guardedFetch=useCallback<typeof fetch>((input,init)=>{const active=guard.current;return active?active.fetcher(input,init):Promise.reject(new SessionClientError())},[]);
 async function inspect(allowInitialMount=false){
  if(checkingRef.current||logoutRef.current)return;checkingRef.current=true;setChecking(true);conceal();setMessage('現在のセッションを確認しています…');const request=revision.current;const controller=new AbortController();inspection.current=controller;
  try{const current=await client.peek(controller.signal);if(!mounted.current||request!==revision.current)return;
   if(tokenRef.current===current){if(!guard.current)install(current);setCandidate(null);setPhase('active');setMessage('同じセッションを確認しました。手元の編集を保持して再開しています。');reveal()}
   else if(tokenRef.current!==null){clearPrivate();setCandidate(current);setPhase('review');setMessage('別のセッションを確認したため、前の編集内容を閉じました。新しい編集画面を開くには、明示的に続行してください。')}
   else if(allowInitialMount){install(current);setCandidate(null);setPhase('active');setMessage('有効な既存セッションを確認しました。この画面からログインやアカウント作成は行っていません。');reveal()}
   else{setCandidate(current);setPhase('review');setMessage('有効なセッションを確認しました。編集画面はまだ開いていません。内容を新しく読み込むには続行してください。')}
  }catch(error){if(!mounted.current||request!==revision.current)return;if(error instanceof SessionClientError&&error.kind==='signed-out'){clearPrivate();setPhase('signed-out');setMessage('現在ログインしていません。このローカル画面では学校Googleログインやアカウント作成は利用できません。')}else unknown()}
  finally{if(mounted.current&&request===revision.current){checkingRef.current=false;setChecking(false);setInspectionGeneration(value=>value+1);if(inspection.current===controller)inspection.current=null}}
 }
 async function proceed(){if(!candidate||checkingRef.current||logoutRef.current)return;const expected=candidate;checkingRef.current=true;setChecking(true);const request=revision.current;const controller=new AbortController();inspection.current=controller;
  try{const current=await client.peek(controller.signal);if(!mounted.current||request!==revision.current)return;if(current!==expected){setCandidate(current);setMessage('確認後にセッションが変わりました。編集画面は開かず、改めて続行の確認を待っています。');return}install(current);setCandidate(null);setPhase('active');setMessage('確認したセッションの編集画面を新しく開きました。前のセッションの入力は引き継いでいません。');reveal()}
  catch(error){if(!mounted.current||request!==revision.current)return;if(error instanceof SessionClientError&&error.kind==='signed-out'){clearPrivate();setPhase('signed-out');setMessage('現在のセッションは無効です。編集画面は開いていません。')}else unknown()}
  finally{if(mounted.current&&request===revision.current){checkingRef.current=false;setChecking(false);setInspectionGeneration(value=>value+1);if(inspection.current===controller)inspection.current=null}}
 }
 async function logout(){const previous=tokenRef.current;if(!previous||logoutRef.current||concealed)return;if(!window.confirm('未保存の文章や公開情報は、この画面から消えます。このブラウザのセッションを終了しますか？'))return;
  logoutRef.current=true;setLoggingOut(true);clearPrivate();setPhase('logout-pending');setMessage('編集画面を閉じて、このブラウザのログアウト結果を確認しています…');const request=revision.current;
  try{await client.logout(previous);if(mounted.current&&request===revision.current){setPhase('signed-out');setMessage('このブラウザのセッションをログアウトしました。他のセッションの終了は確認していません。')}}catch{if(mounted.current&&request===revision.current){setPhase('logout-unknown');setMessage('ログアウトの結果を確認できませんでした。編集画面は閉じたままです。セッションの状態を手動で確認してください。')}}finally{logoutRef.current=false;if(mounted.current)setLoggingOut(false)}
 }
 useLayoutEffect(()=>{if(privatePanel.current){privatePanel.current.hidden=concealed;privatePanel.current.inert=concealed}},[concealed,sessionToken,inspectionGeneration]);
 useEffect(()=>{mounted.current=true;void inspect(true);const recheck=()=>{if(tokenRef.current&&!logoutRef.current)void inspect(false)};const visibility=()=>{if(!tokenRef.current)return;if(document.visibilityState==='visible')recheck();else conceal()};window.addEventListener('focus',recheck);window.addEventListener('pageshow',recheck);document.addEventListener('visibilitychange',visibility);return()=>{mounted.current=false;revision.current++;inspection.current?.abort();guard.current?.invalidate();window.removeEventListener('focus',recheck);window.removeEventListener('pageshow',recheck);document.removeEventListener('visibilitychange',visibility)}},[]);
 return <div className="session-account-lab"><section className="session-control" aria-label="既存セッションの確認"><p className="session-eyebrow">LOCAL AUTHOR SESSION</p><h1>セッションと編集画面</h1><p className="session-local-notice">架空のアカウントを使うローカル専用の検証です。このページからログイン・アカウント作成・権限付与は行いません。</p><p className="session-message" aria-live="polite" aria-atomic="true">{message}</p><div className="session-actions"><Button disabled={checking||loggingOut} onClick={()=>void inspect(false)}>セッションを再確認</Button>{candidate&&<Button disabled={checking||loggingOut} onClick={()=>void proceed()}>確認したセッションで編集を開く</Button>}{sessionToken&&phase==='active'&&!concealed&&<Button disabled={checking||loggingOut} onClick={()=>void logout()}>このブラウザをログアウト</Button>}</div>{concealed&&sessionToken&&<p className="session-hidden-note">確認できるまで、編集中の文章は表示・操作できません。同じセッションの確認が取れれば、このページに保持した編集を再開できます。</p>}<p className="session-scope-note">別タブの変更を常時検知するものではありません。ログアウトは同じブラウザ文脈のセッションと保留中の認証試行が対象です。別端末の終了は確認していません。通信の中止で、すでに保存・公開された操作を取り消すことはできません。ページを閉じると未保存の入力は失われます。</p></section><div ref={privatePanel} className="session-private" hidden={concealed} inert={concealed}>{sessionToken&&<div key={sessionToken}><DraftEditor csrfToken={sessionToken} fetcher={guardedFetch} privateOnly={privateOnly}/>{!privateOnly&&<><PublicProfileSetup csrfToken={sessionToken} fetcher={guardedFetch}/><ProjectRegistration csrfToken={sessionToken} fetcher={guardedFetch}/><OwnPublications csrfToken={sessionToken} fetcher={guardedFetch}/></>}</div>}</div></div>;
}
