import { useProctor } from '../sdk/useProctor';
import type { ViolationType } from '../sdk/types';

const LABELS: Record<ViolationType, string> = {
  tab_blur: 'Tab Switch',
  window_blur: 'Window Blur',
  fullscreen_exit: 'Fullscreen Exit',
  face_missing: 'No Face Detected',
  multiple_faces: 'Multiple Faces',
  copy_attempt: 'Copy/Paste Attempt',
  right_click: 'Right Click',
  tab_switch: 'Tab Switch',
  no_face: 'No Face Detected',
  scroll_away: 'Scroll Away',
};

const COLORS: Record<string, string> = {
  tab_blur: '#f59e0b',
  window_blur: '#f59e0b',
  fullscreen_exit: '#ef4444',
  face_missing: '#ef4444',
  multiple_faces: '#ef4444',
  copy_attempt: '#f59e0b',
  right_click: '#f59e0b',
  tab_switch: '#f59e0b',
  no_face: '#ef4444',
  scroll_away: '#f59e0b',
};

export function ViolationLog() {
  const { violations } = useProctor();

  if (violations.length === 0) return null;

  return (
    <div style={{ padding: 10, background: '#fef2f2', borderRadius: 8, border: '1px solid #fecaca' }}>
      <h3 style={{ margin: '0 0 6px 0', fontSize: 12, color: '#dc2626', fontWeight: 600 }}>
        Violations ({violations.length})
      </h3>
      <ul style={{ margin: 0, paddingLeft: 18, fontSize: 11, maxHeight: 120, overflowY: 'auto' }}>
        {violations.map((v, i) => (
          <li key={i} style={{ marginBottom: 4 }}>
            <span style={{ fontWeight: 600, color: COLORS[v.type] || '#dc2626' }}>
              {LABELS[v.type] || v.type}
            </span>
            {v.detail && <span style={{ color: '#6b7280' }}> — {v.detail}</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}
