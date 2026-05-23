import { useEffect, useRef, useCallback } from 'react';
import { supabase } from '../supabase';
import type { RealtimeChannel } from '@supabase/supabase-js';

export type EventType =
  | 'face_missing'
  | 'tab_blur'
  | 'scroll_away'
  | 'copy_attempt'
  | 'multiple_faces';

interface LogDetail {
  message?: string;
  duration_seconds?: number;
  [key: string]: unknown;
}

export function useProctoring() {
  const channelRef = useRef<RealtimeChannel | null>(null);

  const logEvent = useCallback(
    async (sessionId: string, eventType: EventType, detail: LogDetail = {}, severity: 'low' | 'medium' | 'high' = 'low') => {
      await supabase.from('exam_logs').insert({
        session_id: sessionId,
        event_type: eventType,
        detail,
        severity,
      });
    },
    [],
  );

  const subscribeToLogs = useCallback(
    (sessionId: string, onNewLog: (log: Record<string, unknown>) => void) => {
      channelRef.current = supabase
        .channel(`exam_logs_${sessionId}`)
        .on(
          'postgres_changes',
          {
            event: 'INSERT',
            schema: 'public',
            table: 'exam_logs',
            filter: `session_id=eq.${sessionId}`,
          },
          (payload) => onNewLog(payload.new as Record<string, unknown>),
        )
        .subscribe();

      return () => {
        channelRef.current?.unsubscribe();
      };
    },
    [],
  );

  return { logEvent, subscribeToLogs };
}
