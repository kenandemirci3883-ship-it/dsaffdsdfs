import React, { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { Upload, FileText, Eye, Copy, Menu, X, Trash2, Sparkles, ChevronRight, ChevronLeft, FilePlus, FileDown, Broom } from "lucide-react";
import mammoth from "mammoth";

type ViewMode = "normal" | "highlights";

type DocElement =
  | { id: string; type: "heading"; level: 1 | 2 | 3; content: string }
  | { id: string; type: "paragraph"; text: string }
  | { id: string; type: "checkbox"; text: string }
  | { id: string; type: "table"; data: string[][] }
  | { id: string; type: "pageBreak" };

type HighlightsState = Record<string, { sentences: number[]; hasHighlight: boolean }>;

type ParsedDocument = {
  id: string;
  name: string;
  elements: DocElement[];
};

function uid(prefix = "id") {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}_${Date.now().toString(36)}`;
}

function escapeHtml(s: string) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function transformText(html: string): string {
  let result = html;
  result = result.replace(/=>/g, '<span style="font-family: Apple Color Emoji; font-size: 8.5pt;">💎</span>');
  result = result.replace(/•/g, '<span style="font-family: Apple Color Emoji; font-size: 8.5pt;">🔮</span>');
  result = result.replace(/^-\s*/gm, '<span style="font-family: Apple Color Emoji; font-size: 8.5pt;">🇹🇷</span> ');
  result = result.replace(/<br\s*\/?>\s*-\s*/gi, '<br/><span style="font-family: Apple Color Emoji; font-size: 8.5pt;">🇹🇷</span> ');
  result = result.replace(/^\*\s*/gm, '<span style="font-family: Apple Color Emoji; font-size: 8.5pt;">⭐️</span> ');
  result = result.replace(/<br\s*\/?>\s*\*\s*/gi, '<br/><span style="font-family: Apple Color Emoji; font-size: 8.5pt;">⭐️</span> ');
  const timeUnits = /(\d+)\s*(yıl|yıllık|ay|aylık|hafta|haftalık|gün|günlük|YIL|YILLIK|AY|AYLIK|HAFTA|HAFTALIK|GÜN|GÜNLÜK)/gi;
  result = result.replace(timeUnits, '<span style="color: rgb(236, 102, 65); background: rgb(204, 255, 255); padding: 1px 4px; border-radius: 3px;">$1  $2</span>');
  const timeExpressions = /(\d+)\s*(YILDAN|AYDAN|HAFTADAN|GÜNDEN)\s*(FAZLA|ÇOK|AZ)/gi;
  result = result.replace(timeExpressions, '<span style="color: rgb(236, 102, 65); background: rgb(204, 255, 255); padding: 1px 4px; border-radius: 3px;">$1  $2 $3</span>');
  return result;
}

function splitIntoSentences(htmlText: string): string[] {
  const text = htmlText.trim();
  if (!text) return [];
  // Split by sentence endings but keep single characters attached to their context
  const parts = text.split(/(?<=[\.\!\?\…])\s+(?=[^\s])/g);
  return parts.map((p) => {
    const trimmed = p.trim();
    // Skip rendering single characters like lone parentheses
    if (trimmed.length === 1 && /[\(\)\[\]\{\}\-\–\—\:]/.test(trimmed)) {
      return '';
    }
    return transformText(trimmed);
  }).filter(Boolean);
}

function isLikelyCheckbox(text: string) {
  const t = text.trim();
  return t.startsWith("☐") || t.startsWith("☑") || t.startsWith("□") || t.startsWith("✓") || t.startsWith("•");
}

function looksLikeHeadingText(text: string) {
  const t = text.replace(/\s+/g, " ").trim();
  if (!t) return false;
  if (t.length <= 2) return false;
  const hasPuncEnd = /[.!?\…]$/.test(t);
  const hasManyCaps = (t.match(/[A-ZÇĞIÖŞÜ]/g) || []).length >= Math.min(6, Math.floor(t.length * 0.4));
  const isShort = t.length <= 70;
  return isShort && !hasPuncEnd && (hasManyCaps || /^[0-9]+\)/.test(t) || /^[IVX]+\./.test(t));
}

function parseHtmlTable(tableEl: HTMLTableElement): string[][] {
  const rows: string[][] = [];
  const trEls = Array.from(tableEl.querySelectorAll("tr"));
  for (const tr of trEls) {
    const cells = Array.from(tr.querySelectorAll("th,td")).map((c) => c.innerHTML.trim());
    rows.push(cells);
  }
  return rows;
}

function docxToElements(html: string): DocElement[] {
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, "text/html");
  const out: DocElement[] = [];

  const walk = (node: Element) => {
    const tag = node.tagName.toLowerCase();
    const style = (node.getAttribute("style") || "").toLowerCase();
    
    if (style.includes("page-break-before") && style.includes("always")) {
      out.push({ id: uid("pb"), type: "pageBreak" });
    }

    if (tag === "table") {
      out.push({ id: uid("tbl"), type: "table", data: parseHtmlTable(node as HTMLTableElement) });
      return;
    }

    if (tag === "h1" || tag === "h2" || tag === "h3") {
      const level = tag === "h1" ? 1 : tag === "h2" ? 2 : 3;
      out.push({ id: uid("h"), type: "heading", level, content: node.innerHTML.trim() });
      return;
    }

    if (tag === "p" || tag === "div") {
      const raw = node.innerHTML.trim();
      const plain = node.textContent || "";
      const t = plain.replace(/\s+/g, " ").trim();

      if (!t) return;

      if (looksLikeHeadingText(t)) {
        out.push({ id: uid("h"), type: "heading", level: 2, content: escapeHtml(t) });
        return;
      }

      if (isLikelyCheckbox(t)) {
        out.push({ id: uid("cb"), type: "checkbox", text: raw });
        return;
      }

      out.push({ id: uid("p"), type: "paragraph", text: raw });
      return;
    }

    const children = Array.from(node.children);
    if (children.length) children.forEach(walk);
  };

  Array.from(doc.body.children).forEach(walk);

  const cleaned: DocElement[] = [];
  for (const el of out) {
    if (el.type === "pageBreak" && cleaned.at(-1)?.type === "pageBreak") continue;
    cleaned.push(el);
  }
  if (cleaned.at(-1)?.type === "pageBreak") cleaned.pop();

  return cleaned;
}

function splitElementsIntoPages(elements: DocElement[]): DocElement[][] {
  const pages: DocElement[][] = [[]];
  for (const el of elements) {
    if (el.type === "pageBreak") {
      if (pages.at(-1)?.length) pages.push([]);
      continue;
    }
    pages.at(-1)!.push(el);
  }
  return pages.filter((p) => p.length > 0);
}

const LiquidGlassDocViewer: React.FC = () => {
  const [documents, setDocuments] = useState<ParsedDocument[]>([]);
  const [currentDocId, setCurrentDocId] = useState<string | null>(null);
  const [highlightsByDoc, setHighlightsByDoc] = useState<Record<string, HighlightsState>>({});
  const [viewMode, setViewMode] = useState<ViewMode>("normal");
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [isDragging, setIsDragging] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [copySuccess, setCopySuccess] = useState(false);
  const [highlightPanelOpen, setHighlightPanelOpen] = useState(false);

  const dragDepthRef = useRef(0);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const pageRefs = useRef<Map<number, HTMLDivElement>>(new Map());

  const currentDoc = useMemo(() => documents.find((d) => d.id === currentDocId) || null, [documents, currentDocId]);
  const highlights = useMemo<HighlightsState>(() => {
    if (!currentDoc) return {};
    return highlightsByDoc[currentDoc.id] || {};
  }, [currentDoc, highlightsByDoc]);

  const pages = useMemo(() => {
    if (!currentDoc) return [];
    return splitElementsIntoPages(currentDoc.elements);
  }, [currentDoc]);

  const setHighlightsForCurrentDoc = (updater: (prev: HighlightsState) => HighlightsState) => {
    if (!currentDoc) return;
    setHighlightsByDoc((prev) => {
      const cur = prev[currentDoc.id] || {};
      return { ...prev, [currentDoc.id]: updater(cur) };
    });
  };

  const handleSentenceClick = (elementId: string, sentenceIndex: number) => {
    setHighlightsForCurrentDoc((prev) => {
      const current = prev[elementId] || { sentences: [], hasHighlight: false };
      const exists = current.sentences.includes(sentenceIndex);
      const nextSentences = exists
        ? current.sentences.filter((i) => i !== sentenceIndex)
        : [...current.sentences, sentenceIndex];
      return {
        ...prev,
        [elementId]: {
          sentences: nextSentences,
          hasHighlight: nextSentences.length > 0,
        },
      };
    });
  };

  const getAllHighlightedText = useCallback(() => {
    if (!currentDoc) return [];
    const exported: string[] = [];
    for (const pageEls of pages) {
      for (const el of pageEls) {
        if (el.type !== "paragraph" && el.type !== "checkbox") continue;
        const elementHighlights = highlights[el.id];
        if (!elementHighlights?.hasHighlight) continue;

        const sentences = splitIntoSentences(el.text);
        const picked = elementHighlights.sentences
          .slice()
          .sort((a, b) => a - b)
          .map((idx) => sentences[idx])
          .filter(Boolean);

        if (picked.length) {
          const asPlain = picked
            .map((s) => s.replace(/<[^>]*>/g, ""))
            .join(" ")
            .replace(/\s+/g, " ")
            .trim();
          if (asPlain) exported.push(asPlain);
        }
      }
    }
    return exported;
  }, [currentDoc, pages, highlights]);

  const exportHighlights = async () => {
    const exported = getAllHighlightedText();
    const output = exported.join("\n\n");
    try {
      await navigator.clipboard.writeText(output);
      setCopySuccess(true);
      setTimeout(() => setCopySuccess(false), 2000);
      setMenuOpen(false);
    } catch (e) {
      console.error("Kopyalama hatası:", e);
    }
  };

  const exportAsHtml = () => {
    if (!currentDoc) return;
    const exported = getAllHighlightedText();
    const htmlContent = `<!DOCTYPE html>
<html lang="tr">
<head>
  <meta charset="UTF-8">
  <title>${currentDoc.name} - Vurgular</title>
  <style>
    body { font-family: system-ui, sans-serif; padding: 40px; background: #1e1e1e; color: #ddd; }
    .highlight { background: linear-gradient(135deg, hsla(180, 100%, 90%, 0.45), hsla(180, 100%, 85%, 0.35)); color: #DC3C28; padding: 4px 8px; border-radius: 4px; margin: 8px 0; display: block; }
  </style>
</head>
<body>
  <h1>${currentDoc.name}</h1>
  ${exported.map(t => `<p class="highlight">${t}</p>`).join('\n  ')}
</body>
</html>`;
    
    const blob = new Blob([htmlContent], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${currentDoc.name.replace('.docx', '')}_vurgular.html`;
    a.click();
    URL.revokeObjectURL(url);
    setMenuOpen(false);
  };

  const exportAsPdf = () => {
    window.print();
    setMenuOpen(false);
  };

  const clearHighlights = () => {
    setHighlightsForCurrentDoc(() => ({}));
  };

  const removeCurrentDoc = () => {
    if (!currentDoc) return;
    setDocuments((prev) => prev.filter((d) => d.id !== currentDoc.id));
    setHighlightsByDoc((prev) => {
      const next = { ...prev };
      delete next[currentDoc.id];
      return next;
    });
    setCurrentDocId((prev) => (prev === currentDoc.id ? null : prev));
    setMenuOpen(false);
  };

  const openNewFile = () => {
    fileInputRef.current?.click();
    setMenuOpen(false);
  };

  const readFiles = async (files: FileList | File[]) => {
    const fileArr = Array.from(files).filter((f) => f.name.toLowerCase().endsWith(".docx"));
    if (fileArr.length === 0) return;

    const parsedDocs: ParsedDocument[] = [];
    for (const file of fileArr) {
      const arrayBuffer = await file.arrayBuffer();
      const result = await mammoth.convertToHtml({ arrayBuffer });
      const elements = docxToElements(result.value);
      parsedDocs.push({ id: uid("doc"), name: file.name, elements });
    }

    setDocuments((prev) => [...prev, ...parsedDocs]);
    setCurrentDocId((prev) => prev || parsedDocs[0]?.id || null);
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files) await readFiles(files);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  useEffect(() => {
    const onDragEnter = (ev: DragEvent) => {
      ev.preventDefault();
      dragDepthRef.current += 1;
      setIsDragging(true);
    };
    const onDragOver = (ev: DragEvent) => {
      ev.preventDefault();
      ev.dataTransfer!.dropEffect = "copy";
      setIsDragging(true);
    };
    const onDragLeave = (ev: DragEvent) => {
      ev.preventDefault();
      dragDepthRef.current -= 1;
      if (dragDepthRef.current <= 0) {
        dragDepthRef.current = 0;
        setIsDragging(false);
      }
    };
    const onDrop = async (ev: DragEvent) => {
      ev.preventDefault();
      dragDepthRef.current = 0;
      setIsDragging(false);
      const dt = ev.dataTransfer;
      if (!dt) return;
      if (dt.files && dt.files.length) await readFiles(dt.files);
    };

    window.addEventListener("dragenter", onDragEnter);
    window.addEventListener("dragover", onDragOver);
    window.addEventListener("dragleave", onDragLeave);
    window.addEventListener("drop", onDrop);
    return () => {
      window.removeEventListener("dragenter", onDragEnter);
      window.removeEventListener("dragover", onDragOver);
      window.removeEventListener("dragleave", onDragLeave);
      window.removeEventListener("drop", onDrop);
    };
  }, []);

  // Cmd+V auto-save (copies highlights to clipboard)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'v') {
        // Browser security prevents saving directly to Desktop
        // Instead, we export highlights to clipboard
        exportHighlights();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [currentDoc, pages, highlights]);

  const updateCurrentPageFromScroll = () => {
    const scroller = scrollerRef.current;
    if (!scroller) return;

    if (pages.length > 1) {
      const top = scroller.scrollTop;
      let bestPage = 1;
      let bestDelta = Number.POSITIVE_INFINITY;

      for (let i = 1; i <= pages.length; i++) {
        const el = pageRefs.current.get(i);
        if (!el) continue;
        const delta = Math.abs(el.offsetTop - top);
        if (delta < bestDelta) {
          bestDelta = delta;
          bestPage = i;
        }
      }
      setCurrentPage(bestPage);
      return;
    }

    const approxPageHeight = 1123 + 40;
    const p = Math.floor(scroller.scrollTop / approxPageHeight) + 1;
    setCurrentPage(Math.max(1, p));
  };

  useEffect(() => {
    setCurrentPage(1);
    if (scrollerRef.current) scrollerRef.current.scrollTo({ top: 0 });
  }, [currentDocId]);

  const handleCellClick = (elementId: string, rowIndex: number, cellIndex: number) => {
    const cellKey = `${elementId}_r${rowIndex}_c${cellIndex}`;
    setHighlightsForCurrentDoc((prev) => {
      const current = prev[cellKey] || { sentences: [], hasHighlight: false };
      return {
        ...prev,
        [cellKey]: {
          sentences: current.hasHighlight ? [] : [0],
          hasHighlight: !current.hasHighlight,
        },
      };
    });
  };

  const renderTable = (tableData: string[][], elementId: string) => {
    return (
      <div key={elementId} className="doc-table-wrapper">
        <div className="doc-table-inner">
          <table className="doc-table">
            <tbody>
              {tableData.map((row, rowIndex) => (
                <tr key={rowIndex} className={rowIndex === 0 ? "doc-table-header-row" : ""}>
                  {row.map((cell, cellIndex) => {
                    const Tag = rowIndex === 0 ? "th" : "td";
                    const cellKey = `${elementId}_r${rowIndex}_c${cellIndex}`;
                    const isHighlighted = highlights[cellKey]?.hasHighlight || false;
                    return (
                      <Tag 
                        key={cellIndex} 
                        className={isHighlighted ? "doc-table-cell-highlighted" : ""}
                        onClick={() => handleCellClick(elementId, rowIndex, cellIndex)}
                        dangerouslySetInnerHTML={{ __html: cell }} 
                      />
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  };

  // Render paragraph with ONE checkbox per paragraph (not per line)
  const renderParagraphLike = (element: { id: string; text: string }, isCheckbox = false) => {
    const sentences = splitIntoSentences(element.text);
    const elementHighlights = highlights[element.id];
    const hasHighlight = !!elementHighlights?.hasHighlight;

    return (
      <div key={element.id} className="doc-paragraph-box">
        <div className={`doc-paragraph-row ${isCheckbox ? "is-checkbox" : ""}`}>
          <button
            type="button"
            className={`doc-paragraph-indicator ${hasHighlight ? "doc-paragraph-indicator-active" : ""}`}
            onClick={() => {
              if (!sentences.length) return;
              handleSentenceClick(element.id, 0);
            }}
            aria-label="Paragraf işaretleyici"
          >
            {hasHighlight ? (
              <span className="text-lg animate-scale-in">⚖️</span>
            ) : (
              <span className="w-2 h-2 rounded-full bg-foreground/30" />
            )}
          </button>

          <div className="doc-paragraph-content doc-content">
            {sentences.map((sentence, sIdx) => {
              const isHighlighted = elementHighlights?.sentences.includes(sIdx) || false;
              const shouldFade = viewMode === "highlights" && !isHighlighted;

              return (
                <span
                  key={sIdx}
                  className={`doc-sentence ${isHighlighted ? "doc-sentence-highlighted" : ""} ${shouldFade ? "doc-sentence-faded" : ""}`}
                  onClick={() => handleSentenceClick(element.id, sIdx)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      handleSentenceClick(element.id, sIdx);
                    }
                  }}
                  dangerouslySetInnerHTML={{ __html: sentence }}
                />
              );
            })}
          </div>
        </div>
      </div>
    );
  };

  const renderHeading = (element: { id: string; level: 1 | 2 | 3; content: string }) => {
    const className = `doc-heading doc-heading-${element.level} my-6`;
    if (element.level === 1) {
      return <h1 key={element.id} className={className} dangerouslySetInnerHTML={{ __html: element.content }} />;
    }
    if (element.level === 2) {
      return <h2 key={element.id} className={className} dangerouslySetInnerHTML={{ __html: element.content }} />;
    }
    return <h3 key={element.id} className={className} dangerouslySetInnerHTML={{ __html: element.content }} />;
  };

  const renderElement = (element: DocElement) => {
    switch (element.type) {
      case "table":
        return renderTable(element.data, element.id);
      case "paragraph":
        return renderParagraphLike({ id: element.id, text: element.text }, false);
      case "checkbox":
        return renderParagraphLike({ id: element.id, text: element.text }, true);
      case "heading":
        return renderHeading(element);
      default:
        return null;
    }
  };

  const highlightedTexts = getAllHighlightedText();

  return (
    <div className="w-screen h-screen flex flex-col relative z-10" onClick={() => setMenuOpen(false)}>
      {/* Floating highlight controls - always visible when doc open */}
      {!!currentDoc && (
        <div 
          className="fixed top-4 right-4 flex gap-2 items-center z-50"
          onClick={(e) => e.stopPropagation()}
        >
          <button
            className={`glass-button glass-button-icon ${viewMode === "highlights" ? "glass-button-primary" : ""}`}
            onClick={() => setViewMode((m) => (m === "normal" ? "highlights" : "normal"))}
            title={viewMode === "highlights" ? "Normal görünüm" : "Vurgular görünümü"}
          >
            <Eye size={15} />
          </button>

          {/* Toggle highlight panel - sparkles icon */}
          <button
            className="glass-button glass-button-icon"
            onClick={() => setHighlightPanelOpen(!highlightPanelOpen)}
            aria-label="Vurgular Paneli"
          >
            <Sparkles size={17} />
          </button>

          <div className="relative">
            <button 
              className="glass-button glass-button-icon" 
              onClick={(e) => {
                e.stopPropagation();
                setMenuOpen((v) => !v);
              }} 
              aria-label="Menü"
            >
              <Menu size={17} />
            </button>

            {menuOpen && (
              <div 
                className="glass-menu absolute top-12 right-0" 
                onClick={(e) => e.stopPropagation()}
              >
                <button className="glass-menu-item" onClick={openNewFile} type="button">
                  <span className="flex items-center gap-2 text-xs font-medium">
                    <FilePlus size={15} /> Yeni Dosya
                  </span>
                  <span className="text-xs text-foreground/50">⌘N</span>
                </button>

                <div className="h-2" />

                <button className="glass-menu-item" onClick={() => fileInputRef.current?.click()} type="button">
                  <span className="flex items-center gap-2 text-xs font-medium">
                    <Upload size={15} /> Dosya Yükle
                  </span>
                  <span className="text-xs text-foreground/50">⌘O</span>
                </button>

                <div className="h-2" />

                <button className="glass-menu-item" onClick={exportHighlights} type="button">
                  <span className="flex items-center gap-2 text-xs font-medium">
                    <Copy size={15} /> {copySuccess ? "Kopyalandı! ✓" : "Vurguları Kopyala"}
                  </span>
                  <span className="text-xs text-foreground/50">⌘C</span>
                </button>

                <div className="h-2" />

                <button className="glass-menu-item" onClick={exportAsHtml} type="button">
                  <span className="flex items-center gap-2 text-xs font-medium">
                    <FileDown size={15} /> HTML Olarak Kaydet
                  </span>
                  <span className="text-xs text-foreground/50">—</span>
                </button>

                <div className="h-2" />

                <button className="glass-menu-item" onClick={exportAsPdf} type="button">
                  <span className="flex items-center gap-2 text-xs font-medium">
                    <FileDown size={15} /> PDF Olarak Kaydet
                  </span>
                  <span className="text-xs text-foreground/50">⌘P</span>
                </button>

                <div className="h-2" />

                <button className="glass-menu-item" onClick={clearHighlights} type="button">
                  <span className="flex items-center gap-2 text-xs font-medium">
                    <Broom size={15} /> Temizle
                  </span>
                  <span className="text-xs text-foreground/50">—</span>
                </button>

                <div className="h-2" />

                <button className="glass-menu-item" onClick={removeCurrentDoc} type="button">
                  <span className="flex items-center gap-2 text-xs font-medium">
                    <Trash2 size={15} /> Dosyayı Kaldır
                  </span>
                  <span className="text-xs text-foreground/50">⌫</span>
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Header - only show when no doc open */}
      {!currentDoc && (
        <header 
          className="glass-header fixed top-4 left-1/2 -translate-x-1/2 w-[min(1280px,calc(100%-48px))] h-16 flex items-center justify-between px-4 z-50"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="text-sm font-semibold tracking-tight bg-gradient-to-r from-[#EBD77D] to-[#EBD77D]/70 bg-clip-text text-transparent truncate max-w-[50%] relative z-10">
            Olacak Önizleme
          </div>

          <div className="flex gap-2 items-center relative z-10">
            <button 
              className="glass-button glass-button-primary"
              onClick={() => fileInputRef.current?.click()}
            >
              <Upload size={15} />
              Yükle
            </button>
          </div>
        </header>
      )}

      <input ref={fileInputRef} type="file" accept=".docx" multiple onChange={handleFileUpload} className="hidden" />

      {/* Drag overlay */}
      {isDragging && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="glass-upload animate-pop-in">
            <Upload size={48} className="text-white/70" />
            <div className="text-lg font-bold tracking-tight">.docx dosyalarını buraya bırak</div>
            <div className="text-sm text-foreground/60">
              Çoklu dosya desteklenir. Bırakınca otomatik yüklenir.
            </div>
          </div>
        </div>
      )}

      {/* Document tabs - only show when no doc open but has docs */}
      {documents.length > 0 && !currentDoc && (
        <div className="mt-24 px-8 flex gap-3 overflow-x-auto scrollbar-glass pb-2">
          {documents.map((d) => (
            <div 
              key={d.id} 
              className={`glass-card min-w-[210px] h-20 ${currentDocId === d.id ? "glass-card-active" : ""}`}
              onClick={() => setCurrentDocId(d.id)}
            >
              <div className="text-sm font-semibold text-white truncate mb-1">{d.name}</div>
              <div className="flex items-center gap-2 text-xs text-foreground/50">
                <span className="px-2 py-1 rounded-lg bg-white/5 border border-white/10 text-white/60 text-[10px] font-semibold">
                  📄 {splitElementsIntoPages(d.elements).length}
                </span>
                <span className="px-2 py-1 rounded-lg bg-white/5 border border-white/10 text-white/60 text-[10px] font-semibold">
                  📋 {d.elements.length}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Main content */}
      <div className={`flex-1 p-4 md:p-8 overflow-hidden flex ${!currentDoc ? 'justify-center' : ''}`}>
        {!currentDoc ? (
          <div
            className="glass-upload-visionos animate-fade-in"
            onClick={() => fileInputRef.current?.click()}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                fileInputRef.current?.click();
              }
            }}
          >
            <FileText size={50} className="text-white/40" />
            <div className="text-sm text-foreground/40 leading-relaxed mt-4">
              Çoklu dosya seçebilirsin
            </div>
          </div>
        ) : (
          <div className="flex w-full gap-4">
            {/* Document viewer - full width when panel closed */}
            <div
              className={`h-full overflow-y-auto scrollbar-glass rounded-3xl transition-all duration-200 ${highlightPanelOpen ? 'flex-1' : 'w-full max-w-[21cm] mx-auto'}`}
              ref={scrollerRef}
              onScroll={updateCurrentPageFromScroll}
              onClick={() => setMenuOpen(false)}
            >
              {pages.map((pageEls, idx) => {
                const pageNo = idx + 1;
                return (
                  <div
                    key={`page_${pageNo}`}
                    className="glass-panel p-8 md:p-12 mb-8 animate-fade-in"
                    ref={(el) => {
                      if (!el) return;
                      pageRefs.current.set(pageNo, el);
                    }}
                  >
                    {pageEls.map((el) => renderElement(el))}
                  </div>
                );
              })}
            </div>

            {/* Collapsible highlight panel - slides from the right */}
            <div
              className={`h-full overflow-hidden highlight-panel ${highlightPanelOpen ? 'highlight-panel-open' : 'highlight-panel-closed'}`}
            >
              <div className="glass-panel h-full p-4 overflow-y-auto scrollbar-glass">
                <div className="text-sm font-bold mb-4 text-white/80">Vurgulanan Cümleler</div>
                {highlightedTexts.length === 0 ? (
                  <div className="text-xs text-foreground/50">Henüz vurgulama yok.</div>
                ) : (
                  <div className="space-y-3">
                    {highlightedTexts.map((text, idx) => (
                      <div
                        key={idx}
                        className="doc-paragraph-box p-3 text-xs"
                        /* Apply the same golden highlight background as inline highlights. Do not override text colour so original colours are preserved. */
                        style={{ background: 'linear-gradient(135deg, hsla(43, 89%, 50%, 0.25), hsla(43, 89%, 45%, 0.18))' }}
                      >
                        {text}
                      </div>
                    ))}
                  </div>
                )}
                <button
                  className="glass-button w-full mt-4 justify-center text-xs"
                  onClick={exportHighlights}
                >
                  <Copy size={14} />
                  {copySuccess ? 'Kopyalandı!' : 'Tümünü Kopyala'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Page badge */}
      {!!currentDoc && (
        <div className="glass-page-badge">
          <span className="relative z-10">{currentPage}</span>
        </div>
      )}
    </div>
  );
};

export default LiquidGlassDocViewer;
