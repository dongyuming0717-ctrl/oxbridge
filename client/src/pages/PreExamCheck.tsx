import { useEffect, useRef, useState, useCallback } from 'react';

interface Props {
  onComplete: () => void;
  onBack: () => void;
}

export function PreExamCheck({ onComplete, onBack }: Props) {
  const [cameraOk, setCameraOk] = useState(false);
  const [micOk, setMicOk] = useState(false);
  const [rulesAccepted, setRulesAccepted] = useState(false);
  const [cameraError, setCameraError] = useState('');
  const [micError, setMicError] = useState('');
  const cameraStreamRef = useRef<MediaStream | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const cameraVideoRef = useRef<HTMLVideoElement | null>(null);
  const micMeterRef = useRef<HTMLDivElement | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);

  // Cleanup all streams
  const cleanup = useCallback(() => {
    [cameraStreamRef.current, micStreamRef.current].forEach((s) => {
      if (s) s.getTracks().forEach((t) => t.stop());
    });
    cameraStreamRef.current = null;
    micStreamRef.current = null;
    if (audioCtxRef.current) {
      audioCtxRef.current.close();
      audioCtxRef.current = null;
    }
  }, []);

  // Camera check
  const requestCamera = useCallback(async () => {
    setCameraError('');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: 640, height: 480, facingMode: 'user' },
        audio: false,
      });
      cameraStreamRef.current = stream;
      if (cameraVideoRef.current) {
        cameraVideoRef.current.srcObject = stream;
        await cameraVideoRef.current.play();
      }
      setCameraOk(true);
    } catch (err: any) {
      const name = err?.name || '';
      if (name === 'NotAllowedError') {
        setCameraError('Camera permission was denied. Open browser site settings and allow camera access, then reload.');
      } else if (name === 'NotFoundError') {
        setCameraError('No camera found. Please connect a camera and try again.');
      } else if (name === 'NotReadableError') {
        setCameraError('Camera is in use by another app. Close other apps using the camera and try again.');
      } else {
        setCameraError(`Camera error: ${err?.message || 'Unknown error'}. Make sure you are using an external browser (Chrome/Safari/Edge), not VSCode built-in browser.`);
      }
    }
  }, []);

  // Mic check with volume meter
  const requestMic = useCallback(async () => {
    setMicError('');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: false,
      });
      micStreamRef.current = stream;

      // Set up audio level meter
      const ctx = new AudioContext();
      audioCtxRef.current = ctx;
      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);

      const dataArray = new Uint8Array(analyser.frequencyBinCount);
      const meter = micMeterRef.current;
      if (meter) {
        const animate = () => {
          analyser.getByteFrequencyData(dataArray);
          const avg = dataArray.reduce((a, b) => a + b, 0) / dataArray.length;
          const pct = Math.min(avg / 128, 1);
          meter.style.width = `${pct * 100}%`;
          if (pct > 0.01) {
            meter.style.background = '#16a34a';
            setMicOk(true);
          }
          if (micStreamRef.current) requestAnimationFrame(animate);
        };
        animate();
      }
    } catch (err: any) {
      const name = err?.name || '';
      if (name === 'NotAllowedError') {
        setMicError('Microphone permission was denied. Open browser site settings and allow microphone access.');
      } else if (name === 'NotFoundError') {
        setMicError('No microphone found. Please connect a microphone and try again.');
      } else {
        setMicError(`Mic error: ${err?.message || 'Unknown error'}.`);
      }
    }
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return cleanup;
  }, [cleanup]);

  const allOk = cameraOk && micOk && rulesAccepted;

  return (
    <div style={{ maxWidth: 640, margin: '40px auto', fontFamily: 'system-ui, sans-serif', padding: 20 }}>
      <button
        onClick={() => { cleanup(); onBack(); }}
        style={{
          padding: '6px 0', background: 'none', border: 'none',
          color: '#6b7280', cursor: 'pointer', fontSize: 13, marginBottom: 8,
        }}
      >
        ← Back to paper selection
      </button>
      <h1 style={{ textAlign: 'center', marginBottom: 4 }}>Pre-Exam Setup</h1>
      <p style={{ textAlign: 'center', color: '#6b7280', marginBottom: 28, fontSize: 14 }}>
        Complete all checks below before entering the exam.
      </p>

      {/* ── Camera Check ── */}
      <div style={{
        background: cameraOk ? '#f0fdf4' : '#fff',
        border: `2px solid ${cameraOk ? '#bbf7d0' : '#e5e7eb'}`,
        borderRadius: 12, padding: 20, marginBottom: 12,
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <h3 style={{ margin: 0, fontSize: 15 }}>
            {cameraOk ? '✓ ' : ''}Camera Check
          </h3>
          {!cameraOk && (
            <button
              onClick={requestCamera}
              style={{
                padding: '6px 16px', background: '#2563eb', color: '#fff',
                border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 13,
              }}
            >
              Allow Camera
            </button>
          )}
        </div>
        <div style={{
          width: '100%', height: 360, borderRadius: 8, overflow: 'hidden',
          background: '#1f2937', position: 'relative',
        }}>
          <video ref={cameraVideoRef} autoPlay muted playsInline
            style={{
              position: 'absolute', inset: 0,
              width: '100%', height: '100%', objectFit: 'cover',
              display: cameraOk ? 'block' : 'none',
            }}
          />
          {!cameraOk && (
            <div style={{
              position: 'absolute', inset: 0,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <span style={{ color: '#9ca3af', fontSize: 13 }}>
                {cameraError || 'Click "Allow Camera" to enable webcam'}
              </span>
            </div>
          )}
        </div>
        {cameraError && (
          <p style={{ color: '#ef4444', fontSize: 12, margin: '8px 0 0 0' }}>{cameraError}</p>
        )}
      </div>

      {/* ── Mic Check ── */}
      <div style={{
        background: micOk ? '#f0fdf4' : '#fff',
        border: `2px solid ${micOk ? '#bbf7d0' : '#e5e7eb'}`,
        borderRadius: 12, padding: 20, marginBottom: 12,
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <h3 style={{ margin: 0, fontSize: 15 }}>
            {micOk ? '✓ ' : ''}Microphone Check
          </h3>
          {!micOk && (
            <button
              onClick={requestMic}
              style={{
                padding: '6px 16px', background: '#2563eb', color: '#fff',
                border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 13,
              }}
            >
              Allow Mic
            </button>
          )}
        </div>
        <div style={{
          height: 48, borderRadius: 8, background: '#f3f4f6',
          display: 'flex', alignItems: 'center', padding: '0 12px',
        }}>
          <div style={{ flex: 1, height: 8, borderRadius: 4, background: '#e5e7eb', overflow: 'hidden' }}>
            <div ref={micMeterRef} style={{
              height: '100%', borderRadius: 4, width: '0%',
              background: '#d1d5db', transition: 'width 0.1s',
            }} />
          </div>
          <span style={{ marginLeft: 12, fontSize: 12, color: '#6b7280', minWidth: 60, textAlign: 'right' }}>
            {micOk ? 'Detected' : 'Waiting...'}
          </span>
        </div>
        {micError && (
          <p style={{ color: '#ef4444', fontSize: 12, margin: '8px 0 0 0' }}>{micError}</p>
        )}
      </div>

      {/* ── Rules ── */}
      <div style={{
        background: rulesAccepted ? '#f0fdf4' : '#fff',
        border: `2px solid ${rulesAccepted ? '#bbf7d0' : '#e5e7eb'}`,
        borderRadius: 12, padding: 20, marginBottom: 24,
      }}>
        <h3 style={{ margin: '0 0 12px 0', fontSize: 15 }}>
          {rulesAccepted ? '✓ ' : ''}Exam Rules
        </h3>
        <ul style={{ margin: 0, paddingLeft: 20, fontSize: 13, color: '#4b5563', lineHeight: 1.8 }}>
          <li>Do not switch tabs or windows during the exam</li>
          <li>Keep your face clearly visible in the camera at all times</li>
          <li>No other people should be visible on camera</li>
          <li>No headphones, earphones, or external devices allowed</li>
          <li>No copy/paste, right-click, or developer tools</li>
          <li>Stay in fullscreen mode for the entire duration</li>
        </ul>
        <label style={{ display: 'flex', alignItems: 'center', marginTop: 14, cursor: 'pointer', fontSize: 13 }}>
          <input
            type="checkbox"
            checked={rulesAccepted}
            onChange={(e) => setRulesAccepted(e.target.checked)}
            style={{ marginRight: 8, width: 16, height: 16 }}
          />
          I have read and agree to the exam rules
        </label>
      </div>

      {/* ── Begin Button ── */}
      <button
        disabled={!allOk}
        onClick={() => {
          cleanup();
          onComplete();
        }}
        style={{
          width: '100%', padding: '14px',
          background: allOk ? '#2563eb' : '#d1d5db',
          color: '#fff', border: 'none', borderRadius: 10,
          cursor: allOk ? 'pointer' : 'not-allowed',
          fontSize: 17, fontWeight: 600,
        }}
      >
        {allOk ? 'Begin Exam' : 'Complete all checks to continue'}
      </button>

      {!allOk && (
        <p style={{ textAlign: 'center', color: '#9ca3af', fontSize: 12, marginTop: 8 }}>
          {!cameraOk && 'Camera required · '}
          {!micOk && 'Microphone required · '}
          {!rulesAccepted && 'Rules acknowledgment required'}
        </p>
      )}
    </div>
  );
}
