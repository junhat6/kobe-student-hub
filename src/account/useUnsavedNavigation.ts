import { useCallback, useEffect, useRef } from 'react';
import { useBlocker } from 'react-router-dom';

/** Block SPA navigation too; beforeunload alone only protects full page exits. */
export function useUnsavedNavigation(message: string) {
  const risk = useRef(false);
  const sources = useRef(new Set<string>());
  const onRiskChange = useCallback((value: boolean, source = 'default') => {
    if (value) sources.current.add(source);
    else sources.current.delete(source);
    risk.current = sources.current.size > 0;
  }, []);
  const blocker = useBlocker(useCallback(() => risk.current, []));
  useEffect(() => {
    if (blocker.state !== 'blocked') return;
    if (window.confirm(message)) blocker.proceed();
    else blocker.reset();
  }, [blocker, message]);
  return onRiskChange;
}
