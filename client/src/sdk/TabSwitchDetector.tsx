import { useEffect, useRef } from 'react';
import { useProctor } from './useProctor';

export function TabSwitchDetector() {
  const { reportViolation, status } = useProctor();
  const lastBlurTime = useRef(0);

  useEffect(() => {
    if (status !== 'active') return;

    const DEBOUNCE_MS = 1000;

    const onVisibilityChange = () => {
      if (document.hidden) {
        reportViolation('tab_blur', 'User switched to another tab or minimized window');
      }
    };

    const onBlur = () => {
      const now = Date.now();
      if (now - lastBlurTime.current < DEBOUNCE_MS) return;
      lastBlurTime.current = now;
      reportViolation('window_blur', 'User clicked outside the exam window');
    };

    const onFullscreenChange = () => {
      if (!document.fullscreenElement) {
        reportViolation('fullscreen_exit', 'User exited fullscreen mode');
      }
    };

    const onContextMenu = (e: Event) => {
      e.preventDefault();
      reportViolation('right_click', 'Right-click blocked during exam');
    };

    const onCopy = (e: ClipboardEvent) => {
      e.preventDefault();
      reportViolation('copy_attempt', 'Copy blocked during exam');
    };

    const onPaste = (e: ClipboardEvent) => {
      e.preventDefault();
      reportViolation('copy_attempt', 'Paste blocked during exam');
    };

    const onKeyDown = (e: KeyboardEvent) => {
      const blocked = ['c', 'v', 'p', 's', 'u'];
      if (
        (e.ctrlKey && e.shiftKey && e.key === 'I') ||
        (e.ctrlKey && blocked.includes(e.key.toLowerCase())) ||
        e.key === 'F12' ||
        (e.metaKey && blocked.includes(e.key.toLowerCase()))
      ) {
        e.preventDefault();
        reportViolation('copy_attempt', `Blocked shortcut: ${e.key}`);
      }
      if (e.altKey) {
        e.preventDefault();
      }
    };

    document.addEventListener('visibilitychange', onVisibilityChange);
    window.addEventListener('blur', onBlur);
    document.addEventListener('fullscreenchange', onFullscreenChange);
    document.addEventListener('contextmenu', onContextMenu);
    document.addEventListener('copy', onCopy);
    document.addEventListener('paste', onPaste);
    document.addEventListener('keydown', onKeyDown);

    window.history.pushState(null, '', window.location.href);
    const onPopState = () => {
      window.history.pushState(null, '', window.location.href);
    };
    window.addEventListener('popstate', onPopState);

    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.removeEventListener('blur', onBlur);
      document.removeEventListener('fullscreenchange', onFullscreenChange);
      document.removeEventListener('contextmenu', onContextMenu);
      document.removeEventListener('copy', onCopy);
      document.removeEventListener('paste', onPaste);
      document.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('popstate', onPopState);
    };
  }, [status, reportViolation]);

  return null;
}
