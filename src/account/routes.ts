declare const __ACCOUNT_UI_RELEASE_ENABLED__: boolean;
/** Visibility only. Server identity, ownership and release gates remain authoritative. */
export const accountUiEnabled=typeof __ACCOUNT_UI_RELEASE_ENABLED__!=='undefined'&&__ACCOUNT_UI_RELEASE_ENABLED__===true;
export const isAccountRoute=(path:string)=>accountUiEnabled&&['/signup','/login','/account'].includes(path);
