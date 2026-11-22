"use client";

import { useMemo } from "react";
import { marked } from "marked";
import DOMPurify from "dompurify";

type MarkdownRendererProps = {
  content: string;
  className?: string;
};

export function MarkdownRenderer({ content, className }: MarkdownRendererProps) {
  const html = useMemo(() => {
    if (!content.trim()) return "";
    
    marked.setOptions({
      gfm: true,
      breaks: true,
    });
    
    const rawHtml = marked.parse(content) as string;
    
    return DOMPurify.sanitize(rawHtml, {
      ALLOWED_TAGS: [
        "h1", "h2", "h3", "h4", "h5", "h6",
        "p", "br", "hr",
        "strong", "em", "u", "s", "code", "pre",
        "ul", "ol", "li",
        "blockquote",
        "a",
        "img",
        "table", "thead", "tbody", "tr", "th", "td",
        "input",
      ],
      ALLOWED_ATTR: [
        "href", "title", "target", "rel",
        "src", "alt", "width", "height",
        "type", "checked", "disabled",
        "class",
      ],
      ALLOW_DATA_ATTR: false,
    });
  }, [content]);

  if (!html) return null;

  return (
    <div 
      className={className}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
