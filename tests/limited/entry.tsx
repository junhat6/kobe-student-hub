import React from 'react';
import {createRoot} from 'react-dom/client';
import LimitedDraftTrial from '../../src/editor/LimitedDraftTrial';
createRoot(document.getElementById('root')!).render(location.origin==='https://127.0.0.1:8792'?<LimitedDraftTrial localFixture/>:<p>指定のローカル試験環境でのみ利用できます。</p>);
