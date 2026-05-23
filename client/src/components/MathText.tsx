import { useMemo } from 'react';
import katex from 'katex';

interface Props {
  text: string;
  displayMode?: boolean;
}

function renderMath(text: string, displayMode: boolean): string {
  const parts: string[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    const dd = remaining.indexOf('$$');
    const sd = remaining.indexOf('$');
    let start = -1;
    let delim = '';

    // Find the earliest delimiter: prefer $$ over $
    if (dd !== -1 && sd !== -1) {
      if (dd <= sd) { start = dd; delim = '$$'; }
      else { start = sd; delim = '$'; }
    } else if (dd !== -1) {
      start = dd; delim = '$$';
    } else if (sd !== -1) {
      start = sd; delim = '$';
    }

    if (start === -1) {
      parts.push(remaining);
      break;
    }

    if (start > 0) {
      parts.push(remaining.substring(0, start));
    }

    const end = remaining.indexOf(delim, start + delim.length);
    if (end === -1) {
      parts.push(remaining.substring(start));
      break;
    }

    const tex = remaining.substring(start + delim.length, end);
    try {
      // displayMode prop controls: false = everything inline (single line)
      const isDisplay = displayMode;
      parts.push(katex.renderToString(tex, { throwOnError: false, displayMode: isDisplay }));
    } catch {
      parts.push(remaining.substring(start, end + delim.length));
    }
    remaining = remaining.substring(end + delim.length);
  }

  return parts.join('');
}

export function MathText({ text, displayMode = false }: Props) {
  const html = useMemo(() => renderMath(text, displayMode), [text, displayMode]);
  return <span dangerouslySetInnerHTML={{ __html: html }} />;
}
