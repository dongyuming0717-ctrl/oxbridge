import { useEffect, useRef, useState } from 'react';
import { useProctor } from './useProctor';

let faceapi: any = null;

export function WebcamCapture() {
  const { videoRef, status, reportViolation } = useProctor();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [modelsLoaded, setModelsLoaded] = useState(false);
  const [error, setError] = useState('');
  const noFaceStart = useRef<number>(0);

  useEffect(() => {
    if (status !== 'active') return;

    let cancelled = false;

    async function start() {
      try {
        // Camera first — user can see and approve the permission dialog
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { width: 640, height: 480, facingMode: 'user' },
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
        }
        // Fullscreen AFTER camera is approved
        await new Promise((r) => setTimeout(r, 500));
        try {
          await document.documentElement.requestFullscreen();
        } catch {
          // Fullscreen may be denied; non-critical
        }
      } catch {
        setError('Cannot access webcam. Please allow camera permission.');
      }
    }

    start();

    return () => {
      cancelled = true;
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
      }
    };
  }, [status, videoRef]);

  useEffect(() => {
    if (status !== 'active' || modelsLoaded) return;

    async function loadModels() {
      try {
        faceapi = await import('face-api.js');
        const MODEL_URL = 'https://justadudewhohacks.github.io/face-api.js/models';
        await faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_URL);
        setModelsLoaded(true);
      } catch {
        console.warn('Face detection models failed to load');
      }
    }

    loadModels();
  }, [status, modelsLoaded]);

  useEffect(() => {
    if (status !== 'active' || !modelsLoaded || !videoRef.current) return;

    let running = true;
    const video = videoRef.current;
    const canvas = canvasRef.current;

    async function detect() {
      if (!running || !video || !canvas || video.readyState < 2) {
        if (running) requestAnimationFrame(detect);
        return;
      }

      try {
        const result = await faceapi.detectAllFaces(
          video,
          new faceapi.TinyFaceDetectorOptions({ inputSize: 320, scoreThreshold: 0.5 })
        );

        const faceCount = result.length;
        (window as any).__proctorFaceUpdate?.(faceCount === 1, faceCount);

        const ctx = canvas.getContext('2d');
        if (ctx) {
          const displaySize = { width: video.videoWidth, height: video.videoHeight };
          faceapi.matchDimensions(canvas, displaySize);
          ctx.clearRect(0, 0, canvas.width, canvas.height);

          if (faceCount === 0) {
            ctx.strokeStyle = '#ef4444';
            ctx.lineWidth = 4;
            ctx.strokeRect(2, 2, displaySize.width - 4, displaySize.height - 4);
            ctx.font = '16px sans-serif';
            ctx.fillStyle = '#ef4444';
            ctx.fillText('No face detected', 10, 30);

            if (noFaceStart.current === 0) {
              noFaceStart.current = Date.now();
            } else if (Date.now() - noFaceStart.current > 3000) {
              reportViolation('face_missing', 'Face not detected for over 3 seconds');
              noFaceStart.current = Date.now();
            }
          } else if (faceCount > 1) {
            ctx.strokeStyle = '#f59e0b';
            ctx.lineWidth = 4;
            ctx.strokeRect(2, 2, displaySize.width - 4, displaySize.height - 4);
            ctx.font = '16px sans-serif';
            ctx.fillStyle = '#f59e0b';
            ctx.fillText(`${faceCount} faces detected`, 10, 30);

            reportViolation('multiple_faces', `${faceCount} faces detected`);
          } else {
            const detection = result[0].detection;
            const box = detection.box;
            ctx.strokeStyle = '#22c55e';
            ctx.lineWidth = 2;
            ctx.strokeRect(box.x, box.y, box.width, box.height);

            noFaceStart.current = 0;
          }
        }
      } catch {
        // Detection error, continue loop
      }

      if (running) requestAnimationFrame(detect);
    }

    const onPlay = () => {
      if (canvas && video) {
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
      }
      detect();
    };

    video.addEventListener('play', onPlay);
    if (!video.paused) onPlay();

    return () => {
      running = false;
      video.removeEventListener('play', onPlay);
    };
  }, [status, modelsLoaded, videoRef, reportViolation]);

  if (status !== 'active') return null;

  return (
    <div style={{ position: 'relative', width: '100%', borderRadius: 8, overflow: 'hidden', boxShadow: '0 2px 8px rgba(0,0,0,0.15)' }}>
      <video
        ref={videoRef as React.RefObject<HTMLVideoElement>}
        autoPlay
        muted
        playsInline
        style={{ width: '100%', display: 'block' }}
      />
      <canvas
        ref={canvasRef}
        style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%' }}
      />
      {error && (
        <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, background: '#ef4444', color: '#fff', fontSize: 11, padding: 4, textAlign: 'center' }}>
          {error}
        </div>
      )}
    </div>
  );
}
