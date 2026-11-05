import {createRoot} from 'react-dom/client';
import AccountSessionLab from '../../src/editor/AccountSessionLab';
// Local test entry only. The component and its clients are unchanged application source.
createRoot(document.getElementById('root')!).render(location.origin==='https://127.0.0.1:8790'&&location.pathname==='/lab/account'?<AccountSessionLab/>:<p>Local generation QA only.</p>);
