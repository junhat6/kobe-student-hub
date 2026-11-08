import {useCallback,useEffect,useLayoutEffect,useMemo,useRef,useState,type ReactNode} from 'react';
import {Button} from '@base-ui/react/button';
import {createAuthorSessionGuard,createSessionClient,SessionClientError,type AuthorSessionGuard} from '../editor/session-client';
type Phase='checking'|'active'|'review'|'signed-out'|'unverified'|'logout-pending'|'logout-unknown';
export interface AccountSessionBoundaryProps {
 variant?:'lab'|'account'|'authoring';
 children:(session:{csrfToken:string;fetcher:typeof fetch})=>ReactNode;
 signedOutContent?:ReactNode;
}
/** Reuses the existing UI consumption guard; server authentication remains authoritative. */
export default function AccountSessionBoundary({variant='account',children,signedOutContent}:AccountSessionBoundaryProps){
 const lab=variant==='lab',authoring=variant==='authoring';
 const copy=(legacy:string,account:string,drafts=account)=>lab?legacy:authoring?drafts:account;
 const client=useMemo(()=>createSessionClient(),[]);const mounted=useRef(true);const revision=useRef(0);const checkingRef=useRef(false);const logoutRef=useRef(false);const inspection=useRef<AbortController|null>(null);
 const pageActive=useRef(true);const initialInspection=useRef(true);const resumeInspection=useRef(true);
 const guard=useRef<AuthorSessionGuard|null>(null);const tokenRef=useRef<string|null>(null);const privatePanel=useRef<HTMLDivElement>(null);
 const [sessionToken,setSessionToken]=useState<string|null>(null);const [candidate,setCandidate]=useState<string|null>(null);const [concealed,setConcealed]=useState(true);const [phase,setPhase]=useState<Phase>('checking');const [checking,setChecking]=useState(false);const [loggingOut,setLoggingOut]=useState(false);const [message,setMessage]=useState(copy('既存のセッションを確認しています…','セッションを確認しています…')),[inspectionGeneration,setInspectionGeneration]=useState(0);
 const conceal=()=>{if(privatePanel.current){privatePanel.current.hidden=true;privatePanel.current.inert=true}setConcealed(true)};
 const canReveal=()=>mounted.current&&pageActive.current&&document.visibilityState==='visible';
 const reveal=()=>{if(canReveal())setConcealed(false);else conceal()};
 // A lifecycle boundary cancels the proof, not the editor or its unsaved buffer.
 function cancelInspection(){revision.current++;inspection.current?.abort();inspection.current=null;checkingRef.current=false;setChecking(false)}
 function resetPending(){cancelInspection();guard.current?.invalidate();guard.current=null}
 function clearPrivate(){initialInspection.current=false;resumeInspection.current=false;conceal();resetPending();tokenRef.current=null;setSessionToken(null);setCandidate(null)}
 function unknown(){initialInspection.current=false;resumeInspection.current=false;conceal();resetPending();setCandidate(null);setPhase('unverified');setMessage(tokenRef.current?copy('セッションを確認できませんでした。手元の編集はこのページのメモリ内に保持したまま隠しています。再確認できるまで操作できません。','セッションを確認できませんでした。このページの入力をメモリ内に保持したまま隠しています。再確認できるまで年度やアカウントの操作はできません。','セッションを確認できませんでした。手元の編集を保持したまま隠しています。再確認できるまで操作できません。'):copy('セッションを確認できませんでした。編集画面は開いていません。もう一度確認してください。','セッションを確認できませんでした。アカウント情報は開いていません。もう一度確認してください。','セッションを確認できませんでした。下書きは開いていません。もう一度確認してください。'))}
 function install(current:string){
  guard.current?.invalidate();
  const bound=createAuthorSessionGuard({csrfToken:current,origin:location.origin,onMismatch:kind=>{if(!mounted.current||guard.current!==bound)return;clearPrivate();setPhase(kind==='signed-out'?'signed-out':'review');setMessage(kind==='signed-out'?copy('現在のセッションは無効です。前の編集画面は閉じています。','現在のセッションは無効です。前のアカウント情報は閉じています。','現在のセッションは無効です。前の下書きは閉じています。'):copy('別のセッションを検出したため、前の編集画面を閉じました。セッションを再確認してから続行してください。','別のセッションを検出したため、前のアカウント情報を閉じました。セッションを再確認してから続行してください。','別のセッションを検出したため、前の下書きを閉じました。セッションを再確認してから続行してください。'))},onUnverified:()=>{if(mounted.current&&guard.current===bound)unknown()}});
  guard.current=bound;tokenRef.current=current;setSessionToken(current);
 }
 // SDK instances keep this stable proxy across a hidden/same-session recovery.
 const guardedFetch=useCallback<typeof fetch>((input,init)=>{const active=guard.current;return active?active.fetcher(input,init):Promise.reject(new SessionClientError())},[]);
 async function inspect(allowInitialMount=false){
  if(!canReveal()||checkingRef.current||logoutRef.current)return;resumeInspection.current=false;checkingRef.current=true;setChecking(true);conceal();setMessage(copy('現在のセッションを確認しています…','ログイン状態を確認しています…'));const request=revision.current;const controller=new AbortController();inspection.current=controller;
  try{const current=await client.peek(controller.signal);if(!canReveal()||request!==revision.current)return;initialInspection.current=false;
   if(tokenRef.current===current){if(!guard.current)install(current);setCandidate(null);setPhase('active');setMessage(copy('同じセッションを確認しました。手元の編集を保持して再開しています。','同じセッションを確認しました。手元の年度の入力を保持して再開しています。','同じセッションを確認しました。手元の編集を保持して再開しています。'));reveal()}
   else if(tokenRef.current!==null){clearPrivate();setCandidate(current);setPhase('review');setMessage(copy('別のセッションを確認したため、前の編集内容を閉じました。新しい編集画面を開くには、明示的に続行してください。','別のセッションを確認したため、前のアカウント情報と入力を閉じました。新しいアカウント情報を開くには、明示的に続行してください。','別のセッションを確認したため、前の下書きと入力を閉じました。新しい下書き一覧を開くには、明示的に続行してください。'))}
   else if(allowInitialMount){install(current);setCandidate(null);setPhase('active');setMessage(copy('有効な既存セッションを確認しました。この画面からログインやアカウント作成は行っていません。','ログインを確認しました。登録した年度を確認・訂正できます。','ログインを確認しました。下書きを書く・再開できます。'));reveal()}
   else{setCandidate(current);setPhase('review');setMessage(copy('有効なセッションを確認しました。編集画面はまだ開いていません。内容を新しく読み込むには続行してください。','有効なセッションを確認しました。アカウント情報はまだ開いていません。内容を新しく読み込むには続行してください。','有効なセッションを確認しました。下書きはまだ開いていません。内容を新しく読み込むには続行してください。'))}
  }catch(error){if(!canReveal()||request!==revision.current)return;initialInspection.current=false;if(error instanceof SessionClientError&&error.kind==='signed-out'){clearPrivate();setPhase('signed-out');setMessage(copy('現在ログインしていません。このローカル画面では学校Googleログインやアカウント作成は利用できません。','現在ログインしていません。アカウント情報を開くにはログインが必要です。','現在ログインしていません。下書きを開くにはログインが必要です。'))}else unknown()}
  finally{if(mounted.current&&request===revision.current&&inspection.current===controller){checkingRef.current=false;setChecking(false);setInspectionGeneration(value=>value+1);if(inspection.current===controller)inspection.current=null}}
 }
 async function proceed(){if(!canReveal()||!candidate||checkingRef.current||logoutRef.current)return;const expected=candidate;checkingRef.current=true;setChecking(true);const request=revision.current;const controller=new AbortController();inspection.current=controller;
  try{const current=await client.peek(controller.signal);if(!canReveal()||request!==revision.current)return;if(current!==expected){setCandidate(current);setMessage(copy('確認後にセッションが変わりました。編集画面は開かず、改めて続行の確認を待っています。','確認後にセッションが変わりました。アカウント情報は開かず、改めて続行の確認を待っています。','確認後にセッションが変わりました。下書きは開かず、改めて続行の確認を待っています。'));return}install(current);setCandidate(null);setPhase('active');setMessage(copy('確認したセッションの編集画面を新しく開きました。前のセッションの入力は引き継いでいません。','確認したセッションのアカウント情報を新しく開きました。前のセッションの入力は引き継いでいません。','確認したセッションの下書き一覧を新しく開きました。前のセッションの入力は引き継いでいません。'));reveal()}
  catch(error){if(!canReveal()||request!==revision.current)return;initialInspection.current=false;if(error instanceof SessionClientError&&error.kind==='signed-out'){clearPrivate();setPhase('signed-out');setMessage(copy('現在のセッションは無効です。編集画面は開いていません。','現在のセッションは無効です。アカウント情報は開いていません。','現在のセッションは無効です。下書きは開いていません。'))}else unknown()}
  finally{if(mounted.current&&request===revision.current&&inspection.current===controller){checkingRef.current=false;setChecking(false);setInspectionGeneration(value=>value+1);if(inspection.current===controller)inspection.current=null}}
 }
 async function logout(){const previous=tokenRef.current;if(!previous||logoutRef.current||concealed)return;if(!window.confirm(copy('未保存の文章や公開情報は、この画面から消えます。このブラウザのセッションを終了しますか？','このページの未保存の入力は消えます。このブラウザのセッションを終了しますか？')))return;
  logoutRef.current=true;setLoggingOut(true);clearPrivate();setPhase('logout-pending');setMessage(copy('編集画面を閉じて、このブラウザのログアウト結果を確認しています…','アカウント情報を閉じて、このブラウザのログアウト結果を確認しています…','下書きを閉じて、このブラウザのログアウト結果を確認しています…'));const request=revision.current;
  try{await client.logout(previous);if(mounted.current&&request===revision.current){setPhase('signed-out');setMessage('このブラウザのセッションをログアウトしました。他のセッションの終了は確認していません。')}}catch{if(mounted.current&&request===revision.current){setPhase('logout-unknown');setMessage(copy('ログアウトの結果を確認できませんでした。編集画面は閉じたままです。セッションの状態を手動で確認してください。','ログアウトの結果を確認できませんでした。アカウント情報は閉じたままです。セッションの状態を手動で確認してください。','ログアウトの結果を確認できませんでした。下書きは閉じたままです。セッションの状態を手動で確認してください。'))}}finally{logoutRef.current=false;if(mounted.current)setLoggingOut(false)}
 }
 useLayoutEffect(()=>{if(privatePanel.current){const hidden=concealed||!canReveal();privatePanel.current.hidden=hidden;privatePanel.current.inert=hidden}},[concealed,sessionToken,inspectionGeneration]);
 useEffect(()=>{
  mounted.current=true;pageActive.current=true;void inspect(initialInspection.current);
  const recheck=()=>{if(!logoutRef.current&&(tokenRef.current||resumeInspection.current))void inspect(initialInspection.current)};
  const suspend=()=>{conceal();if(logoutRef.current)return;resumeInspection.current=resumeInspection.current||inspection.current!==null;cancelInspection()};
  const visibility=()=>{if(document.visibilityState==='visible')recheck();else suspend()};
  const pagehide=()=>{pageActive.current=false;suspend()};
  const pageshow=()=>{pageActive.current=true;recheck()};
  window.addEventListener('focus',recheck);window.addEventListener('pageshow',pageshow);window.addEventListener('pagehide',pagehide);document.addEventListener('visibilitychange',visibility);
  return()=>{mounted.current=false;revision.current++;inspection.current?.abort();guard.current?.invalidate();window.removeEventListener('focus',recheck);window.removeEventListener('pageshow',pageshow);window.removeEventListener('pagehide',pagehide);document.removeEventListener('visibilitychange',visibility)}
 },[]);
 return <div className={lab?'session-account-lab':'session-account'}>
  <section className="session-control" aria-label={lab?'既存セッションの確認':authoring?'下書きのセッション確認':'アカウントのセッション確認'}>
   {lab&&<p className="session-eyebrow">LOCAL AUTHOR SESSION</p>}
   <h1>{lab?'セッションと編集画面':authoring?'下書き':'アカウント'}</h1>
   {lab&&<p className="session-local-notice">架空のアカウントを使うローカル専用の検証です。このページからログイン・アカウント作成・権限付与は行いません。</p>}
   <p className="session-message" aria-live="polite" aria-atomic="true">{message}</p>
   <div className="session-actions">
    <Button disabled={checking||loggingOut} onClick={()=>void inspect(false)}>{lab?'セッションを再確認':'ログイン状態を確認'}</Button>
    {candidate&&<Button disabled={checking||loggingOut} onClick={()=>void proceed()}>{lab?'確認したセッションで編集を開く':authoring?'確認したセッションで下書きを開く':'確認したアカウントを開く'}</Button>}
    {sessionToken&&phase==='active'&&!concealed&&<Button disabled={checking||loggingOut} onClick={()=>void logout()}>このブラウザをログアウト</Button>}
   </div>
   {concealed&&sessionToken&&<p className="session-hidden-note">{lab||authoring?'確認できるまで、編集中の文章は表示・操作できません。同じセッションの確認が取れれば、このページに保持した編集を再開できます。':'確認できるまで、年度などのアカウント情報は表示・操作できません。同じセッションの確認が取れれば、このページに保持した入力を再開できます。'}</p>}
   {lab?<p className="session-scope-note">別タブの変更を常時検知するものではありません。ログアウトは同じブラウザ文脈のセッションと保留中の認証試行が対象です。別端末の終了は確認していません。通信の中止で、すでに保存・公開された操作を取り消すことはできません。ページを閉じると未保存の入力は失われます。</p>:<details className="session-scope-note"><summary>ログアウトと入力の保持について</summary><p>ログアウトはこのブラウザが対象です。別端末は終了しません。ページを閉じると未保存の入力は失われます。通信の中止で、すでに保存された変更を取り消すことはできません。</p></details>}
  </section>
  {phase==='signed-out'&&!checking&&!loggingOut&&signedOutContent}
  <div ref={privatePanel} className="session-private" hidden={concealed} inert={concealed}>{sessionToken&&<div key={sessionToken}>{children({csrfToken:sessionToken,fetcher:guardedFetch})}</div>}</div>
 </div>;
}
