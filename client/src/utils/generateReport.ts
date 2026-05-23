import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

interface QuestionDetail {
  qid: string;
  questionLabel: string;
  text: string;
  timeMs: number;
  correctAnswer: number;
  yourAnswer: number | null;
  isCorrect: boolean;
}

interface ReportData {
  paperTitle: string;
  paperDuration: number;
  completedAt: Date;
  totalQuestions: number;
  score: number;
  maxScore: number;
  questionDetails: QuestionDetail[];
}

function formatTime(ms: number): string {
  if (ms < 1000) return '0s';
  const totalSec = Math.round(ms / 1000);
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  if (min === 0) return `${sec}s`;
  return `${min}m ${sec}s`;
}

function answerLetter(idx: number | null): string {
  if (idx === null) return '--';
  return String.fromCharCode(65 + idx);
}

const GREEN = '#16a34a';
const RED = '#ef4444';
const GRAY = '#6b7280';
const BLUE = '#2563eb';

export function generateExamReport(data: ReportData): void {
  const doc = new jsPDF();
  const pageW = doc.internal.pageSize.getWidth();
  let y = 20;

  // ── Header ──
  doc.setFontSize(20);
  doc.setTextColor('#111827');
  doc.text('Exam Analysis Report', pageW / 2, y, { align: 'center' });
  y += 12;

  doc.setFontSize(11);
  doc.setTextColor(GRAY);
  const pct = Math.round((data.score / data.maxScore) * 100);
  const dateStr = data.completedAt.toLocaleString('en-GB', {
    day: 'numeric', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });

  const metaLines = [
    `Paper: ${data.paperTitle}`,
    `Completed: ${dateStr}`,
    `Duration Available: ${data.paperDuration} minutes`,
    `Score: ${data.score} / ${data.maxScore}  (${pct}%)`,
  ];
  doc.setFontSize(10);
  metaLines.forEach((line) => {
    doc.text(line, 14, y);
    y += 6;
  });
  y += 4;

  // ── Sort: longest time first ──
  const sorted = [...data.questionDetails].sort((a, b) => b.timeMs - a.timeMs);

  // ── Per-Question Time Table ──
  doc.setFontSize(13);
  doc.setTextColor('#111827');
  doc.text('Time Breakdown (longest to shortest)', 14, y);
  y += 6;

  autoTable(doc, {
    startY: y,
    head: [['#', 'Question', 'Time', 'Result', 'Answer']],
    body: sorted.map((q, i) => {
      const label = q.qid.replace('q', 'Q');
      const shortText = q.text.length > 45 ? q.text.slice(0, 42) + '...' : q.text;
      const result = q.yourAnswer === null
        ? 'Skipped'
        : q.isCorrect
          ? `Correct (${answerLetter(q.correctAnswer)})`
          : `Wrong (${answerLetter(q.correctAnswer)})`;
      return [
        String(i + 1),
        `${label}: ${shortText}`,
        formatTime(q.timeMs),
        result,
        answerLetter(q.yourAnswer),
      ];
    }),
    styles: { fontSize: 9, cellPadding: 3 },
    headStyles: { fillColor: [37, 99, 235], textColor: [255, 255, 255] },
    columnStyles: {
      0: { cellWidth: 10 },
      1: { cellWidth: 68 },
      2: { cellWidth: 24 },
      3: { cellWidth: 40 },
      4: { cellWidth: 18 },
    },
    didParseCell: (_hookData: any) => {
      const cell = _hookData.cell;
      if (_hookData.column.index === 3) {
        const txt = cell.text?.[0] || '';
        if (txt.startsWith('Correct')) {
          cell.styles.textColor = GREEN;
        } else if (txt.startsWith('Wrong')) {
          cell.styles.textColor = RED;
        } else {
          cell.styles.textColor = GRAY;
        }
      }
    },
  });

  y = (doc as any).lastAutoTable.finalY + 10;

  // ── Summary Statistics ──
  const totalActiveMs = sorted.reduce((sum, q) => sum + q.timeMs, 0);
  const avgMs = data.totalQuestions > 0 ? totalActiveMs / data.totalQuestions : 0;
  const fastest = sorted[sorted.length - 1];
  const slowest = sorted[0];
  const visitedCount = sorted.filter((q) => q.timeMs > 0).length;
  const notVisited = data.totalQuestions - visitedCount;

  // Time vs. Accuracy
  const correctQs = sorted.filter((q) => q.isCorrect);
  const wrongQs = sorted.filter((q) => q.yourAnswer !== null && !q.isCorrect);
  const skippedQs = sorted.filter((q) => q.yourAnswer === null);
  const avgCorrectMs = correctQs.length > 0
    ? correctQs.reduce((s, q) => s + q.timeMs, 0) / correctQs.length : 0;
  const avgWrongMs = wrongQs.length > 0
    ? wrongQs.reduce((s, q) => s + q.timeMs, 0) / wrongQs.length : 0;

  doc.setFontSize(13);
  doc.setTextColor('#111827');
  doc.text('Summary Statistics', 14, y);
  y += 8;

  doc.setFontSize(10);
  doc.setTextColor('#374151');
  const statsLines = [
    `Total active time: ${formatTime(totalActiveMs)}`,
    `Average time per question: ${formatTime(avgMs)}`,
    `Fastest: ${fastest.qid.replace('q', 'Q')} (${formatTime(fastest.timeMs)})`,
    `Slowest: ${slowest.qid.replace('q', 'Q')} (${formatTime(slowest.timeMs)})`,
    `Questions visited: ${visitedCount} / ${data.totalQuestions}`,
    notVisited > 0 ? `Questions not visited: ${notVisited}` : null,
  ].filter(Boolean) as string[];
  statsLines.forEach((line) => {
    doc.text(`•  ${line}`, 14, y);
    y += 6;
  });
  y += 4;

  // ── Time vs. Accuracy ──
  doc.setFontSize(13);
  doc.setTextColor('#111827');
  doc.text('Time vs. Accuracy', 14, y);
  y += 8;

  doc.setFontSize(10);
  doc.setTextColor('#374151');
  const accuracyLines = [
    `Average time on correct answers: ${formatTime(avgCorrectMs)}`,
    `Average time on wrong answers: ${formatTime(avgWrongMs)}`,
  ];
  accuracyLines.forEach((line) => {
    doc.text(`•  ${line}`, 14, y);
    y += 6;
  });

  if (skippedQs.length > 0) {
    doc.setTextColor(RED);
    doc.text(`•  Skipped questions: ${skippedQs.map((q) => q.qid.replace('q', 'Q')).join(', ')}`, 14, y);
    y += 6;
  }
  y += 8;

  // ── Bar Chart ──
  // Check if we need a new page
  if (y > 240) {
    doc.addPage();
    y = 20;
  }

  doc.setFontSize(13);
  doc.setTextColor('#111827');
  doc.text('Time Distribution', 14, y);
  y += 8;

  const maxTime = Math.max(...sorted.map((q) => q.timeMs), 1);
  const maxBarW = pageW - 80; // leave room for label + time text
  const barH = 8;
  const barGap = 3;

  sorted.forEach((q) => {
    if (y > 275) {
      doc.addPage();
      y = 20;
    }

    const barW = Math.max((q.timeMs / maxTime) * maxBarW, 2);
    const label = q.qid.replace('q', 'Q');
    const color = q.yourAnswer === null ? GRAY : q.isCorrect ? GREEN : RED;

    // Label
    doc.setFontSize(8);
    doc.setTextColor('#374151');
    doc.text(label, 14, y + 5);

    // Bar
    doc.setFillColor(color);
    doc.rect(24, y + 1, barW, barH, 'F');

    // Time text
    doc.setTextColor('#374151');
    doc.text(formatTime(q.timeMs), 28 + barW, y + 7);

    y += barH + barGap;
  });

  // ── Save ──
  const slug = data.paperTitle.replace(/\s+/g, '-').toLowerCase().replace(/[^a-z0-9-]/g, '');
  doc.save(`exam-report-${slug}.pdf`);
}
