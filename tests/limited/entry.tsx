import React,{useState} from 'react';
import {createRoot} from 'react-dom/client';
import AccountSessionLab from '../../src/editor/AccountSessionLab';
function LocalLimitedDraft(){
 const [message,setMessage]=useState('架空のGoogle署名応答を使うローカル限定試験です。公開・権限付与はできません。');
 async function login(){
  setMessage('認証を開始しています…');
  try{
   const options={method:'POST',credentials:'same-origin',redirect:'error'} as const;
   const bootstrap=await fetch('/api/auth/bootstrap',options);if(!bootstrap.ok&&bootstrap.status!==409)throw Error();
   const command=await fetch('/api/auth/command?action=login',options);if(!command.ok)throw Error();
   const {commandToken}=await command.json() as {commandToken:string};
   const start=await fetch('/api/auth/start',{...options,headers:{Authorization:'Bearer command.'+commandToken}});if(!start.ok)throw Error();
   const target=new URL((await start.json() as {authorizationUrl:string}).authorizationUrl);if(target.origin!=='https://accounts.google.com'||target.pathname!=='/o/oauth2/v2/auth')throw Error();location.assign(target.href);
  }catch{setMessage('認証を開始できませんでした。期限・取消状態を確認してください。')}
 }
 return <><section><h1>限定ログインと本人の下書き</h1><p role="status">{message}</p><button onClick={()=>void login()}>Googleで限定ログイン</button></section><AccountSessionLab privateOnly/></>;
}
createRoot(document.getElementById('root')!).render(location.origin==='https://127.0.0.1:8792'?<LocalLimitedDraft/>:<p>指定のローカル試験環境でのみ利用できます。</p>);
