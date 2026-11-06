import {useRef,useState} from 'react';
import AccountSessionLab from './AccountSessionLab';

/** The server chooses who may reach this page; no account identifier is sent by the client. */
export default function LimitedDraftTrial({localFixture=false}:{localFixture?:boolean}){
 const [message,setMessage]=useState(localFixture?'架空のGoogle応答を使うローカル試験です。':'指定されたアカウントで、本人だけの下書きを保存できます。公開はできません。');
 const lock=useRef(false);
 async function login(){
  if(lock.current)return;
  if(document.querySelector('.session-private:not([hidden])')&&!window.confirm('ログインし直すと未保存の変更が失われる場合があります。続行しますか？'))return;
  lock.current=true;setMessage('認証を開始しています…');
  try{
   const options={method:'POST',credentials:'same-origin',redirect:'error'} as const;
   const bootstrap=await fetch('/api/auth/bootstrap',options);if(!bootstrap.ok&&bootstrap.status!==409)throw Error();
   const command=await fetch('/api/auth/command?action=login',options);if(!command.ok)throw Error();
   const {commandToken}=await command.json() as {commandToken?:unknown};if(typeof commandToken!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(commandToken))throw Error();
   const start=await fetch('/api/auth/start',{...options,headers:{Authorization:'Bearer command.'+commandToken}});if(!start.ok)throw Error();
   const {authorizationUrl}=await start.json() as {authorizationUrl?:unknown};if(typeof authorizationUrl!=='string')throw Error();
   const target=new URL(authorizationUrl);if(target.origin!=='https://accounts.google.com'||target.pathname!=='/o/oauth2/v2/auth')throw Error();location.assign(target.href);
  }catch{lock.current=false;setMessage('認証を開始できませんでした。もう一度お試しください。')}
 }
 return <><section><h1>限定ログインと本人の下書き</h1><p role="status">{message}</p><button onClick={()=>void login()}>Googleで限定ログイン</button></section><AccountSessionLab privateOnly trial/></>;
}
