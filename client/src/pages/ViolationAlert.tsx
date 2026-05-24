import { useEffect, useRef, useState } from 'react';
import { useProctor } from '../sdk/useProctor';
import type { ViolationType } from '../sdk/types';

const LABELS: Record<ViolationType, string> = {
  tab_blur: 'Tab Switch',
  window_blur: 'Window Blur',
  fullscreen_exit: 'Fullscreen Exit',
  face_missing: 'No Face Detected',
  multiple_faces: 'Multiple Faces',
  copy_attempt: 'Copy/Paste Blocked',
  right_click: 'Right Click Blocked',
  tab_switch: 'Tab Switch',
  no_face: 'No Face Detected',
  scroll_away: 'Scroll Away',
};

const WARNINGS: Record<string, string> = {
  tab_blur: 'Do not leave the exam tab. This has been recorded.',
  tab_switch: 'Do not leave the exam tab. This has been recorded.',
  window_blur: 'Keep the exam window in focus. This has been recorded.',
  fullscreen_exit: 'Return to fullscreen mode immediately. This has been recorded.',
  face_missing: 'Keep your face visible in the camera. This has been recorded.',
  multiple_faces: 'Only one person allowed on camera. This has been recorded.',
  no_face: 'Keep your face visible in the camera. This has been recorded.',
  copy_attempt: 'Copy/paste is not allowed. This has been recorded.',
  right_click: 'Right-click is disabled. This has been recorded.',
  scroll_away: 'Stay on the question. This has been recorded.',
};

export function ViolationAlert() {
  const { violations } = useProctor();
  const prevCount = useRef(0);
  const shownTypes = useRef<Set<string>>(new Set());
  const [alert, setAlert] = useState<{ type: ViolationType; detail: string } | null>(null);

  useEffect(() => {
    if (violations.length > prevCount.current) {
      const latest = violations[violations.length - 1];
      prevCount.current = violations.length;

      // Only show alert if this type hasn't been shown yet
      if (!shownTypes.current.has(latest.type)) {
        shownTypes.current.add(latest.type);
        setAlert({ type: latest.type, detail: latest.detail });
      }
    }
  }, [violations]);

  if (!alert) return null;

  const label = LABELS[alert.type] || alert.type;
  const warning = WARNINGS[alert.type] || 'Violation recorded.';

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 9999,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: 'rgba(0,0,0,0.5)',
        animation: 'fadeIn 0.2s ease',
      }}
    >
      <div
        style={{
          background: '#fff', borderRadius: 16, padding: '28px 32px',
          maxWidth: 420, width: '90%', textAlign: 'center',
          boxShadow: '0 20px 60px rgba(0,0,0,0.3)',
        }}
      >
        <div style={{
          width: 56, height: 56, borderRadius: '50%',
          background: '#fef2f2', margin: '0 auto 16px',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <span style={{ fontSize: 28 }}>&#9888;</span>
        </div>

        <h2 style={{ margin: '0 0 4px 0', fontSize: 18, color: '#dc2626' }}>
          {label}
        </h2>

        <p style={{ margin: '0 0 4px 0', fontSize: 14, color: '#4b5563' }}>
          {warning}
        </p>

        {alert.detail && (
          <p style={{ margin: '0 0 12px 0', fontSize: 12, color: '#9ca3af' }}>
            {alert.detail}
          </p>
        )}

        <p style={{
          margin: '0 0 16px 0', fontSize: 13, color: '#dc2626', fontWeight: 600,
        }}>
          Total violations: {violations.length}
        </p>

        <button
          onClick={() => setAlert(null)}
          style={{
            padding: '8px 32px', background: '#306ca0', color: '#fff',
            border: 'none', borderRadius: 4, cursor: 'pointer', fontSize: 14, fontWeight: 400,
            fontFamily: "'Times New Roman', Times, serif",
          }}
        >
          I Understand
        </button>
      </div>

      <style>{`
        @keyframes fadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }
      `}</style>
    </div>
  );
}
