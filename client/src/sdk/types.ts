export type ViolationType =
  | 'tab_blur'
  | 'face_missing'
  | 'multiple_faces'
  | 'copy_attempt'
  | 'scroll_away'
  | 'tab_switch'
  | 'window_blur'
  | 'fullscreen_exit'
  | 'no_face'
  | 'right_click';

export interface Violation {
  type: ViolationType;
  detail: string;
  timestamp: Date;
}

export interface ProctorState {
  sessionId: string | null;
  status: 'idle' | 'active' | 'ended';
  violations: Violation[];
  faceDetected: boolean;
  faceCount: number;
}

// Supabase exam types
export interface Paper {
  id: string;
  title: string;
  paper_number: 1 | 2;
  year: number;
  sitting: string;
  duration_minutes: number;
  total_marks: number;
  topics: string[];
  questions: Question[];
  created_at: string;
}

export interface Question {
  id: string;
  text: string;
  image_url?: string;
  options: string[];
  answer: number;
  topic: string;
}
