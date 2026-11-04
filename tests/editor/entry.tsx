import React from 'react';
import {createRoot} from 'react-dom/client';
import DraftEditor from '../../src/editor/DraftEditor';
const root=createRoot(document.getElementById('root')!);
root.render(<p>ローカル専用の実験環境を準備しています。</p>);
if(location.origin!=='https://127.0.0.1:8788')root.render(<p>この実験環境は指定のローカルURLでのみ動きます。</p>);
else fetch('/__fixture/session',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({account:'a'})}).then(async response=>{if(!response.ok)throw new Error();const value=await response.json() as {csrfToken:string};root.render(<DraftEditor csrfToken={value.csrfToken}/>)}).catch(()=>root.render(<p>ローカル実験環境を準備できませんでした。</p>));
