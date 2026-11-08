'use strict';

function inlineSegments(text) {
  const segments = [];
  for (const part of String(text).split(/(\*\*[^*]+\*\*)/g)) {
    if (!part) continue;
    const bold = /^\*\*([^*]+)\*\*$/.exec(part);
    segments.push(bold
      ? { tag: 'text', text: bold[1], style: ['bold'] }
      : { tag: 'text', text: part });
  }
  return segments;
}

function markdownToPost(markdown) {
  const lines = String(markdown || '').slice(0, 4000).split('\n');
  let title = '老道助手的回复';
  const content = [];
  let first = true;
  for (const raw of lines) {
    const line = raw.trimEnd();
    if (!line.trim()) continue;
    const heading = /^(#{1,3})\s+(.*)$/.exec(line);
    if (heading) {
      const headingText = heading[2].replace(/\*\*/g, '').trim();
      if (first) title = headingText.slice(0, 100) || title;
      else content.push([{ tag: 'text', text: headingText, style: ['bold'] }]);
      first = false;
      continue;
    }
    if (first) title = line.replace(/\*\*/g, '').trim().slice(0, 100) || title;
    first = false;
    const unordered = /^[-*•]\s+(.*)$/.exec(line);
    const ordered = /^(\d+)[.、]\s+(.*)$/.exec(line);
    if (unordered) content.push([{ tag: 'text', text: '• ' }, ...inlineSegments(unordered[1])]);
    else if (ordered) content.push([{ tag: 'text', text: ordered[1] + '. ' }, ...inlineSegments(ordered[2])]);
    else content.push(inlineSegments(line));
  }
  // Feishu post requires at least one nonempty content row. A heading-only
  // answer is valid; keep its title as the body instead of failing to text.
  if (!content.length) content.push([{ tag: 'text', text: title }]);
  return { zh_cn: { title, content } };
}

module.exports = { markdownToPost };
