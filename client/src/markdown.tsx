import { Fragment, type ReactNode } from 'react';

/**
 * A small, safe markdown renderer for notes. It builds React elements (never raw HTML),
 * so note content can't inject markup or scripts.
 * Supports: # headings, paragraphs, - / * / 1. lists, - [ ] checklists, > quotes,
 * ``` code blocks, **bold**, *italic*, `code`, ~~strike~~, [links](https://…).
 */
export function Markdown({ source, className }: { source: string; className?: string }) {
  return <div className={`markdown ${className ?? ''}`}>{renderBlocks(source)}</div>;
}

function renderBlocks(src: string): ReactNode[] {
  const lines = src.replace(/\r\n/g, '\n').split('\n');
  const out: ReactNode[] = [];
  let i = 0;
  let key = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      i++;
      continue;
    }
    if (line.startsWith('```')) {
      const code: string[] = [];
      i++;
      while (i < lines.length && !lines[i].startsWith('```')) code.push(lines[i++]);
      i++;
      out.push(
        <pre key={key++}>
          <code>{code.join('\n')}</code>
        </pre>,
      );
      continue;
    }
    const h = line.match(/^(#{1,4})\s+(.*)$/);
    if (h) {
      const level = Math.min(h[1].length + 1, 5);
      const Tag = `h${level}` as 'h2';
      out.push(<Tag key={key++}>{inline(h[2])}</Tag>);
      i++;
      continue;
    }
    if (/^>\s?/.test(line)) {
      const q: string[] = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) q.push(lines[i++].replace(/^>\s?/, ''));
      out.push(<blockquote key={key++}>{inline(q.join(' '))}</blockquote>);
      continue;
    }
    if (/^\s*([-*]|\d+\.)\s+/.test(line)) {
      const ordered = /^\s*\d+\./.test(line);
      const items: ReactNode[] = [];
      while (i < lines.length && /^\s*([-*]|\d+\.)\s+/.test(lines[i])) {
        const text = lines[i].replace(/^\s*([-*]|\d+\.)\s+/, '');
        const task = text.match(/^\[( |x|X)\]\s+(.*)$/);
        items.push(
          task ? (
            <li key={i} className="md-task">
              <span className={`md-check ${task[1] !== ' ' ? 'on' : ''}`} aria-hidden />
              <span className={task[1] !== ' ' ? 'md-done' : ''}>{inline(task[2])}</span>
            </li>
          ) : (
            <li key={i}>{inline(text)}</li>
          ),
        );
        i++;
      }
      out.push(ordered ? <ol key={key++}>{items}</ol> : <ul key={key++}>{items}</ul>);
      continue;
    }
    const para: string[] = [];
    while (i < lines.length && lines[i].trim() && !/^(#{1,4}\s|```|>|\s*([-*]|\d+\.)\s+)/.test(lines[i])) para.push(lines[i++]);
    out.push(<p key={key++}>{inline(para.join(' '))}</p>);
  }
  return out;
}

const INLINE_RE = /(`[^`]+`)|(\*\*[^*]+\*\*)|(~~[^~]+~~)|(\*[^*\s][^*]*\*|_[^_\s][^_]*_)|(\[[^\]]+\]\([^)\s]+\))/g;

function inline(text: string): ReactNode {
  const parts: ReactNode[] = [];
  let last = 0;
  let k = 0;
  for (const m of text.matchAll(INLINE_RE)) {
    if (m.index! > last) parts.push(text.slice(last, m.index));
    const t = m[0];
    if (m[1]) parts.push(<code key={k++}>{t.slice(1, -1)}</code>);
    else if (m[2]) parts.push(<strong key={k++}>{inline(t.slice(2, -2))}</strong>);
    else if (m[3]) parts.push(<del key={k++}>{inline(t.slice(2, -2))}</del>);
    else if (m[4]) parts.push(<em key={k++}>{inline(t.slice(1, -1))}</em>);
    else if (m[5]) {
      const lm = t.match(/^\[([^\]]+)\]\(([^)\s]+)\)$/)!;
      const href = /^(https?:|mailto:)/i.test(lm[2]) ? lm[2] : undefined; // block javascript: etc.
      parts.push(
        href ? (
          <a key={k++} href={href} target="_blank" rel="noreferrer noopener">
            {lm[1]}
          </a>
        ) : (
          <Fragment key={k++}>{lm[1]}</Fragment>
        ),
      );
    }
    last = m.index! + t.length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}

/** Plain-text preview (markdown syntax stripped) for compact cards. */
export function markdownToText(src: string): string {
  return src
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^\s*([-*]|\d+\.)\s+(\[[ xX]\]\s+)?/gm, '• ')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/[*_~`>]/g, '')
    .trim();
}
