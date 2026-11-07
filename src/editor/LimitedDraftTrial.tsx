import {useEffect,useMemo,useRef,useState} from 'react';
import AccountSessionLab from './AccountSessionLab';
import {createLimitedLoginClient,LimitedLoginError} from './limited-login-client';

/** The server chooses who may reach this page; no account identifier is sent by the client. */
export default function LimitedDraftTrial({localFixture=false}:{localFixture?:boolean}){
 const [message,setMessage]=useState(localFixture?'架空のGoogle応答を使うローカル試験です。':'指定されたアカウントで、本人だけの下書きを保存できます。公開はできません。');
 const [starting,setStarting]=useState(false);
 const client=useMemo(()=>createLimitedLoginClient(),[]),attempt=useRef<AbortController|null>(null);
 function cancel(){
  const current=attempt.current;if(!current)return;attempt.current=null;current.abort();setStarting(false);
  setMessage('認証の開始を中止しました。もう一度開始できます。');
 }
 useEffect(()=>{
  const hidden=()=>{if(document.visibilityState==='hidden')cancel()};
  window.addEventListener('pagehide',cancel);window.addEventListener('popstate',cancel);window.addEventListener('hashchange',cancel);document.addEventListener('visibilitychange',hidden);
  return()=>{const current=attempt.current;attempt.current=null;current?.abort();window.removeEventListener('pagehide',cancel);window.removeEventListener('popstate',cancel);window.removeEventListener('hashchange',cancel);document.removeEventListener('visibilitychange',hidden)};
 },[]);
 async function login(){
  if(attempt.current)return;
  if(document.querySelector('.session-private:not([hidden])')&&!window.confirm('ログインし直すと未保存の変更が失われる場合があります。続行しますか？'))return;
  const current=new AbortController();attempt.current=current;setStarting(true);setMessage('認証を開始しています…');
  try{
   const target=await client.start(current.signal);
   if(attempt.current!==current||current.signal.aborted)return;
   location.assign(target);
  }catch(error){
   if(attempt.current!==current)return;
   setMessage(error instanceof LimitedLoginError&&error.kind==='timeout'?'認証の開始に時間がかかったため中止しました。もう一度お試しください。':'認証を開始できませんでした。もう一度お試しください。');
  }finally{if(attempt.current===current){attempt.current=null;setStarting(false)}}
 }
 return <><section><h1>限定ログインと本人の下書き</h1><p role="status">{message}</p><button disabled={starting} onClick={()=>void login()}>Googleで限定ログイン</button>{starting&&<button onClick={cancel}>認証の開始を中止</button>}</section><AccountSessionLab privateOnly trial/></>;
}
