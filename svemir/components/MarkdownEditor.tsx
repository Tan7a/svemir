"use client";

import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Link from "@tiptap/extension-link";
import Image from "@tiptap/extension-image";
import Placeholder from "@tiptap/extension-placeholder";
import { Markdown } from "tiptap-markdown";

/**
 * WYSIWYG markdown editor (TipTap). You see rendered formatting (real bold,
 * italic, headings, quotes, lists, images) - never the raw markdown symbols -
 * but the value in/out is markdown, so it stores straight into the block
 * `description`. Images pasted/dropped/picked upload via /api/upload-image and
 * insert inline. Uncontrolled: seed with `initialValue`, changes flow out via
 * `onChange`; remount (change the React `key`) to load different content.
 */

type Props = {
  initialValue: string;
  onChange: (markdown: string) => void;
  placeholder?: string;
};

async function uploadImage(file: File): Promise<string | null> {
  const fd = new FormData();
  fd.append("file", file, file.name || "image.png");
  const res = await fetch("/api/upload-image", { method: "POST", body: fd });
  const data = await res.json().catch(() => null);
  return res.ok && data?.url ? (data.url as string) : null;
}

function ToolButton({
  active,
  disabled,
  onClick,
  title,
  children,
}: {
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={title}
      disabled={disabled}
      onMouseDown={(e) => e.preventDefault()} // keep editor selection
      onClick={onClick}
      className={`min-w-7 rounded-md px-1.5 py-1 text-xs transition-colors disabled:opacity-40 ${
        active
          ? "bg-white/15 text-neutral-50"
          : "text-neutral-400 hover:bg-white/10 hover:text-neutral-100"
      }`}
    >
      {children}
    </button>
  );
}

export default function MarkdownEditor({
  initialValue,
  onChange,
  placeholder = "Start writing…",
}: Props) {
  const editor = useEditor({
    immediatelyRender: false, // SSR-safe in Next
    extensions: [
      StarterKit,
      Link.configure({ openOnClick: false, autolink: true }),
      Image,
      Placeholder.configure({ placeholder }),
      Markdown.configure({ html: false, linkify: true, breaks: true }),
    ],
    content: initialValue, // parsed as markdown by tiptap-markdown
    editorProps: {
      attributes: {
        class:
          "tiptap-content min-h-[52vh] max-w-none text-lg leading-relaxed text-neutral-200 focus:outline-none",
      },
      handlePaste: (_view, event) => {
        const items = event.clipboardData?.items;
        if (!items) return false;
        for (const it of items) {
          if (it.type.startsWith("image/")) {
            const f = it.getAsFile();
            if (f) {
              event.preventDefault();
              uploadImage(f).then((url) => {
                if (url) editor?.chain().focus().setImage({ src: url }).run();
              });
            }
            return true;
          }
        }
        return false;
      },
      handleDrop: (_view, event) => {
        const f = (event as DragEvent).dataTransfer?.files?.[0];
        if (f && f.type.startsWith("image/")) {
          event.preventDefault();
          uploadImage(f).then((url) => {
            if (url) editor?.chain().focus().setImage({ src: url }).run();
          });
          return true;
        }
        return false;
      },
    },
    onUpdate: ({ editor }) => {
      const md = editor.storage.markdown?.getMarkdown?.() ?? "";
      onChange(md);
    },
  });

  function pickImage() {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    input.onchange = async () => {
      const f = input.files?.[0];
      if (f) {
        const url = await uploadImage(f);
        if (url) editor?.chain().focus().setImage({ src: url }).run();
      }
    };
    input.click();
  }

  function setLink() {
    if (!editor) return;
    const prev = editor.getAttributes("link").href as string | undefined;
    const url = window.prompt("Link URL", prev ?? "https://");
    if (url === null) return;
    if (url === "") {
      editor.chain().focus().extendMarkRange("link").unsetLink().run();
      return;
    }
    editor.chain().focus().extendMarkRange("link").setLink({ href: url }).run();
  }

  const e = editor;

  return (
    <div>
      {/* Placeholder styling for TipTap's empty state. */}
      <style>{`.tiptap-content p.is-editor-empty:first-child::before{content:attr(data-placeholder);float:left;color:#525252;pointer-events:none;height:0;}
        .tiptap-content h1{font-size:1.6em;font-weight:600;margin:.6em 0 .3em;}
        .tiptap-content h2{font-size:1.35em;font-weight:600;margin:.6em 0 .3em;}
        .tiptap-content h3{font-size:1.15em;font-weight:600;margin:.5em 0 .25em;}
        .tiptap-content p{margin:.5em 0;}
        .tiptap-content ul{list-style:disc;padding-left:1.4em;margin:.5em 0;}
        .tiptap-content ol{list-style:decimal;padding-left:1.4em;margin:.5em 0;}
        .tiptap-content blockquote{border-left:2px solid #525252;padding-left:1em;font-style:italic;margin:.6em 0;color:#d4d4d4;}
        .tiptap-content a{color:#fafafa;text-decoration:underline;text-underline-offset:2px;}
        .tiptap-content code{background:rgba(255,255,255,.1);padding:.1em .3em;border-radius:.25em;font-size:.9em;}
        .tiptap-content img{max-height:70vh;max-width:100%;border-radius:.5rem;margin:1rem 0;}`}</style>

      {/* Formatting toolbar - drives the editor (shows live state). */}
      <div className="mb-3 flex flex-wrap items-center gap-0.5 border-b border-white/10 pb-2">
        <ToolButton title="Bold" active={e?.isActive("bold")} onClick={() => e?.chain().focus().toggleBold().run()}>
          <span className="font-bold">B</span>
        </ToolButton>
        <ToolButton title="Italic" active={e?.isActive("italic")} onClick={() => e?.chain().focus().toggleItalic().run()}>
          <span className="italic">I</span>
        </ToolButton>
        <ToolButton title="Strikethrough" active={e?.isActive("strike")} onClick={() => e?.chain().focus().toggleStrike().run()}>
          <span className="line-through">S</span>
        </ToolButton>
        <span className="mx-1 h-4 w-px bg-white/10" />
        <ToolButton title="Heading 1" active={e?.isActive("heading", { level: 1 })} onClick={() => e?.chain().focus().toggleHeading({ level: 1 }).run()}>
          H1
        </ToolButton>
        <ToolButton title="Heading 2" active={e?.isActive("heading", { level: 2 })} onClick={() => e?.chain().focus().toggleHeading({ level: 2 }).run()}>
          H2
        </ToolButton>
        <ToolButton title="Heading 3" active={e?.isActive("heading", { level: 3 })} onClick={() => e?.chain().focus().toggleHeading({ level: 3 }).run()}>
          H3
        </ToolButton>
        <span className="mx-1 h-4 w-px bg-white/10" />
        <ToolButton title="Quote" active={e?.isActive("blockquote")} onClick={() => e?.chain().focus().toggleBlockquote().run()}>
          ❝
        </ToolButton>
        <ToolButton title="Bullet list" active={e?.isActive("bulletList")} onClick={() => e?.chain().focus().toggleBulletList().run()}>
          •
        </ToolButton>
        <ToolButton title="Numbered list" active={e?.isActive("orderedList")} onClick={() => e?.chain().focus().toggleOrderedList().run()}>
          1.
        </ToolButton>
        <ToolButton title="Link" active={e?.isActive("link")} onClick={setLink}>
          ↗
        </ToolButton>
        <ToolButton title="Insert image" onClick={pickImage}>
          🖼
        </ToolButton>
      </div>

      <EditorContent editor={editor} />
    </div>
  );
}
