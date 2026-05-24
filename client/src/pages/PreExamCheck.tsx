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
    <div style={{
      minHeight: '100vh', fontFamily: "'Times New Roman', Times, serif",
      background: '#ffffff', padding: 20,
    }}>
      <div style={{ maxWidth: 640, margin: '0 auto' }}>

        {/* Blue Top Bar */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '0 20px', height: 48, marginBottom: 24, borderRadius: 4,
          background: '#306ca0',
        }}>
          <span style={{
            fontSize: 18, fontWeight: 400, color: '#ffffff',
            fontFamily: "'Times New Roman', Times, serif",
            letterSpacing: '0.3px',
          }}>
            Test of Mathematics for University Admission
          </span>
        </div>

        <button
          onClick={() => { cleanup(); onBack(); }}
          style={{
            padding: '8px 0', background: 'none', border: 'none',
            color: '#888', cursor: 'pointer', fontSize: 13,
            display: 'flex', alignItems: 'center', gap: 4, marginBottom: 12,
          }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="15 18 9 12 15 6"/></svg>
          Back to paper selection
        </button>

        <h1 style={{ textAlign: 'center', marginBottom: 4, color: '#333', fontSize: 22, fontWeight: 400, fontFamily: "'Times New Roman', Times, serif" }}>
          Pre-Exam Setup
        </h1>
        <p style={{ textAlign: 'center', color: '#888', marginBottom: 32, fontSize: 14 }}>
          Complete all checks below before entering the exam.
        </p>

        {/* ── Camera Check ── */}
        <div style={{
          background: '#fafafa',
          border: `2px solid ${cameraOk ? '#d1fae5' : '#e0e0e0'}`,
          borderRadius: 8, padding: 22, marginBottom: 14,
          transition: 'all 0.3s ease',
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
            <h3 style={{ margin: 0, fontSize: 15, color: cameraOk ? '#16a34a' : '#333', display: 'flex', alignItems: 'center', gap: 8, fontWeight: 400, fontFamily: "'Times New Roman', Times, serif" }}>
              {cameraOk ? (
                <span style={{ width: 22, height: 22, borderRadius: '50%', background: '#dcfce7', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, color: '#16a34a' }}>✓</span>
              ) : (
                <span style={{ width: 22, height: 22, borderRadius: '50%', background: '#f0f0f0', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, color: '#888' }}>1</span>
              )}
              Camera Check
            </h3>
            {!cameraOk && (
              <button
                onClick={requestCamera}
                style={{
                  padding: '8px 20px', background: '#306ca0', color: '#fff',
                  border: 'none', borderRadius: 4, cursor: 'pointer', fontSize: 13,
                  fontWeight: 400, fontFamily: "'Times New Roman', Times, serif",
                }}
              >
                Allow Camera
              </button>
            )}
          </div>
          <div style={{
            width: '100%', height: 340, borderRadius: 8, overflow: 'hidden',
            background: '#f0f0f0', position: 'relative',
            border: '1px solid #e0e0e0',
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
                display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                gap: 8,
              }}>
                <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#aaa" strokeWidth="1.5">
                  <path d="M23 7l-7 5 7 5V7z"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/>
                </svg>
                <span style={{ color: '#aaa', fontSize: 13 }}>
                  {cameraError || 'Click "Allow Camera" to enable webcam'}
                </span>
              </div>
            )}
          </div>
          {cameraError && (
            <p style={{ color: '#dc2626', fontSize: 12, margin: '10px 0 0 0' }}>{cameraError}</p>
          )}
        </div>

        {/* ── Mic Check ── */}
        <div style={{
          background: '#fafafa',
          border: `2px solid ${micOk ? '#d1fae5' : '#e0e0e0'}`,
          borderRadius: 8, padding: 22, marginBottom: 14,
          transition: 'all 0.3s ease',
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
            <h3 style={{ margin: 0, fontSize: 15, color: micOk ? '#16a34a' : '#333', display: 'flex', alignItems: 'center', gap: 8, fontWeight: 400, fontFamily: "'Times New Roman', Times, serif" }}>
              {micOk ? (
                <span style={{ width: 22, height: 22, borderRadius: '50%', background: '#dcfce7', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, color: '#16a34a' }}>✓</span>
              ) : (
                <span style={{ width: 22, height: 22, borderRadius: '50%', background: '#f0f0f0', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, color: '#888' }}>2</span>
              )}
              Microphone Check
            </h3>
            {!micOk && (
              <button
                onClick={requestMic}
                style={{
                  padding: '8px 20px', background: '#306ca0', color: '#fff',
                  border: 'none', borderRadius: 4, cursor: 'pointer', fontSize: 13,
                  fontWeight: 400, fontFamily: "'Times New Roman', Times, serif",
                }}
              >
                Allow Mic
              </button>
            )}
          </div>
          <div style={{
            height: 52, borderRadius: 8, background: '#f0f0f0',
            display: 'flex', alignItems: 'center', padding: '0 16px',
            border: '1px solid #e0e0e0',
          }}>
            <div style={{ flex: 1, height: 8, borderRadius: 4, background: '#e0e0e0', overflow: 'hidden' }}>
              <div ref={micMeterRef} style={{
                height: '100%', borderRadius: 4, width: '0%',
                background: 'linear-gradient(90deg, #22c55e, #4ade80)', transition: 'width 0.1s',
              }} />
            </div>
            <span style={{ marginLeft: 14, fontSize: 12, color: micOk ? '#16a34a' : '#aaa', minWidth: 70, textAlign: 'right', fontWeight: 500 }}>
              {micOk ? 'Detected' : 'Waiting...'}
            </span>
          </div>
          {micError && (
            <p style={{ color: '#dc2626', fontSize: 12, margin: '10px 0 0 0' }}>{micError}</p>
          )}
        </div>

        {/* ── Rules ── */}
        <div style={{
          background: '#fafafa',
          border: `2px solid ${rulesAccepted ? '#d1fae5' : '#e0e0e0'}`,
          borderRadius: 8, padding: 22, marginBottom: 28,
          transition: 'all 0.3s ease',
        }}>
          <h3 style={{ margin: '0 0 14px 0', fontSize: 15, color: rulesAccepted ? '#16a34a' : '#333', display: 'flex', alignItems: 'center', gap: 8, fontWeight: 400, fontFamily: "'Times New Roman', Times, serif" }}>
            {rulesAccepted ? (
              <span style={{ width: 22, height: 22, borderRadius: '50%', background: '#dcfce7', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, color: '#16a34a' }}>✓</span>
            ) : (
              <span style={{ width: 22, height: 22, borderRadius: '50%', background: '#f0f0f0', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, color: '#888' }}>3</span>
            )}
            Exam Rules
          </h3>
          <ul style={{ margin: 0, paddingLeft: 20, fontSize: 13, color: '#666', lineHeight: 2 }}>
            <li>Do not switch tabs or windows during the exam</li>
            <li>Keep your face clearly visible in the camera at all times</li>
            <li>No other people should be visible on camera</li>
            <li>No headphones, earphones, or external devices allowed</li>
            <li>No copy/paste, right-click, or developer tools</li>
            <li>Stay in fullscreen mode for the entire duration</li>
          </ul>
          <label style={{
            display: 'flex', alignItems: 'center', marginTop: 16, cursor: 'pointer', fontSize: 13,
            color: '#555',
          }}>
            <input
              type="checkbox"
              checked={rulesAccepted}
              onChange={(e) => setRulesAccepted(e.target.checked)}
              style={{ marginRight: 10, width: 18, height: 18, accentColor: '#306ca0' }}
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
            width: '100%', padding: '15px',
            background: allOk ? '#306ca0' : '#e0e0e0',
            color: allOk ? '#fff' : '#aaa',
            border: 'none',
            borderRadius: 4, cursor: allOk ? 'pointer' : 'not-allowed',
            fontSize: 17, fontWeight: 400,
            fontFamily: "'Times New Roman', Times, serif",
            boxShadow: allOk ? '0 2px 8px rgba(48,108,160,0.3)' : 'none',
            transition: 'all 0.2s',
          }}
        >
          {allOk ? 'Begin Exam' : 'Complete all checks to continue'}
        </button>

        {!allOk && (
          <p style={{ textAlign: 'center', color: '#aaa', fontSize: 12, marginTop: 10 }}>
            {!cameraOk && 'Camera required · '}
            {!micOk && 'Microphone required · '}
            {!rulesAccepted && 'Rules acknowledgment required'}
          </p>
        )}
      </div>
    </div>
  );
}
