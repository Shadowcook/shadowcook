import MarkdownIt from 'markdown-it';

interface MarkdownRenderer {
  render(source: string): string;
}

const markdown: MarkdownRenderer = new MarkdownIt({
  html: false,
  linkify: true,
  typographer: true,
});

export function renderMarkdown(source: string): string {
  return markdown.render(source);
}
