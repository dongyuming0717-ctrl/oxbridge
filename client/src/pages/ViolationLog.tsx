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

export function ViolationLog() {
  const { violations } = useProctor();

  if (violations.length === 0) {
    return (
      <div style={{
        padding: 14, borderRadius: 8,
        background: '#fff',
        border: '1px solid #e0e0e0',
        textAlign: 'center',
      }}>
        <div style={{ fontSize: 11, color: '#888', fontWeight: 500, textTransform: 'uppercase', letterSpacing: 1 }}>
          No Violations
        </div>
      </div>
    );
  }

  return (
    <div style={{
      padding: 14, borderRadius: 8,
      background: '#fef2f2',
      border: '1px solid #fecaca',
    }}>
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        marginBottom: 8,
      }}>
        <span style={{ fontSize: 10, fontWeight: 600, color: '#dc2626', textTransform: 'uppercase', letterSpacing: 1 }}>
          Violations
        </span>
        <span style={{
          fontSize: 12, fontWeight: 700, color: '#dc2626',
          background: '#fee2e2', borderRadius: 6,
          padding: '2px 8px',
        }}>
          {violations.length}
        </span>
      </div>
      <ul style={{ margin: 0, paddingLeft: 16, fontSize: 11, maxHeight: 160, overflowY: 'auto' }}>
        {violations.map((v, i) => (
          <li key={i} style={{ marginBottom: 5, color: '#888' }}>
            <span style={{ fontWeight: 600, color: '#dc2626' }}>
              {LABELS[v.type] || v.type}
            </span>
            {v.detail && <span style={{ color: '#aaa' }}> — {v.detail}</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}
