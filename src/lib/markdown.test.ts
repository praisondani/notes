import { describe, expect, it } from "vitest";
import { marked } from "marked";
import DOMPurify from "dompurify";

function renderMarkdown(content: string): string {
  marked.setOptions({ gfm: true, breaks: true });
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
}

describe("markdown rendering", () => {
  it("renders headings, lists, code, links, and tables", () => {
    const html = renderMarkdown([
      "# Title",
      "",
      "- one",
      "- two",
      "",
      "`code`",
      "",
      "[Notes](https://notes.example.com)",
      "",
      "| A | B |",
      "| - | - |",
      "| 1 | 2 |",
    ].join("\n"));

    expect(html).toContain("<h1");
    expect(html).toContain("<ul>");
    expect(html).toContain("<code>");
    expect(html).toContain('href="https://notes.example.com"');
    expect(html).toContain("<table>");
  });

  it("strips script tags and javascript URLs", () => {
    const html = renderMarkdown('Hello <script>alert(1)</script> [x](javascript:alert(1))');
    expect(html).not.toContain("<script");
    expect(html).not.toContain("javascript:");
  });
});
