// src/App.jsx
import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { useDiff } from "./hooks/useDiff";
import { FolderDiff } from "./components/FolderDiff";
import MergePanel from "./components/MergePanel.deep";  // v0.8 Deep: Three-way + Bidirectional merge
import hljs from "highlight.js/lib/core";
import javascript from "highlight.js/lib/languages/javascript";
import typescript from "highlight.js/lib/languages/typescript";
import python from "highlight.js/lib/languages/python";
import rust from "highlight.js/lib/languages/rust";
import json from "highlight.js/lib/languages/json";
import bash from "highlight.js/lib/languages/bash";
import yaml from "highlight.js/lib/languages/yaml";
import xml from "highlight.js/lib/languages/xml";
import sql from "highlight.js/lib/languages/sql";

// Register languages
hljs.registerLanguage("javascript", javascript);
hljs.registerLanguage("typescript", typescript);
hljs.registerLanguage("jsx", javascript);  // Treat JSX as JS
hljs.registerLanguage("python", python);
hljs.registerLanguage("rust", rust);
hljs.registerLanguage("json", json);
hljs.registerLanguage("bash", bash);
hljs.registerLanguage("sh", bash);
hljs.registerLanguage("yaml", yaml);
hljs.registerLanguage("yml", yaml);
hljs.registerLanguage("xml", xml);
hljs.registerLanguage("html", xml);
hljs.registerLanguage("sql", sql);

// ─── Design tokens ────────────────────────────────────────────────────────────

const C = {
  bg:           "#0d0f11",
  panel:        "#111418",
  border:       "#1e2329",
  lineNum:      "#3a4149",
  lineNumHov:   "#666f7a",
  text:         "#c9d1d9",
  textMuted:    "#4a5568",
  textDim:      "#2a3240",
  addBg:        "#0d2318",
  addBgHov:     "#112b1f",
  addLine:      "#26a641",
  addGutter:    "#081710",
  addText:      "#3de07a",
  removeBg:     "#2d0f0f",
  removeBgHov:  "#361212",
  removeLine:   "#da3633",
  removeGutter: "#200b0b",
  removeText:   "#ff7b72",
  modifyBg:     "#1a1500",
  modifyBgHov:  "#201a00",
  modifyLine:   "#e3b341",
  modifyGutter: "#130e00",
  modifyText:   "#f0c84a",
  charAdd:      "rgba(38,166,65,0.32)",
  charRemove:   "rgba(218,54,51,0.32)",
  accent:       "#26a641",
  accentDim:    "rgba(38,166,65,0.15)",
  accentBorder: "rgba(38,166,65,0.3)",
  scrollThumb:  "#252c36",
  headerBg:     "#0a0c0e",
  gutterBorder: "#181f28",
};

// Font stacks: prioritize local/system fonts, fallback to web fonts optional
// This ensures offline/restricted-network environments work without style shifts
const FONT_MONO = "-apple-system-monospace, 'Menlo', 'Monaco', 'Courier New', monospace";
const FONT_UI   = "-apple-system, BlinkMacSystemFont, 'Segoe UI', 'Ubuntu', sans-serif";
const ROW_H     = 22;
const OVERSCAN  = 12;

// ─── Syntax highlight theme (GitHub dark inspired) ────────────────────────────

const HL_THEME = {
  "hljs-number":    "#79c0ff",    // Blue numbers
  "hljs-literal":   "#79c0ff",    // Blue literals
  "hljs-string":    "#a5d6ff",    // Light blue strings
  "hljs-attr":      "#79c0ff",    // Object keys
  "hljs-name":      "#ff7b72",    // Rust macros, function names
  "hljs-keyword":   "#ff7b72",    // Keywords: fn, let, const
  "hljs-built_in":  "#d2a8ff",    // Built-in functions
  "hljs-type":      "#79dbb4",    // Types
  "hljs-variable":  "#c9d1d9",    // Variables
  "hljs-comment":   "#7d8590",    // Comments
  "hljs-symbol":    "#79c0ff",    // Symbols
  "hljs-operator":  "#ff7b72",    // Operators
};

// ─── Detect language from filename ────────────────────────────────────────────

function detectLanguage(filename) {
  if (!filename) return "plaintext";
  const ext = filename.toLowerCase().split(".").pop();
  const map = {
    "ts":   "typescript",
    "tsx":  "jsx",
    "js":   "javascript",
    "jsx":  "jsx",
    "py":   "python",
    "rb":   "ruby",
    "go":   "go",
    "rs":   "rust",
    "java": "java",
    "cs":   "csharp",
    "cpp":  "cpp",
    "c":    "c",
    "h":    "cpp",
    "sh":   "bash",
    "yaml": "yaml",
    "yml":  "yaml",
    "json": "json",
    "xml":  "xml",
    "html": "html",
    "css":  "css",
    "sql":  "sql",
    "md":   "markdown",
  };
  return map[ext] || "plaintext";
}

// ─── Apply syntax highlighting to code line ──────────────────────────────────

function highlightLine(code, language) {
  if (!code || language === "plaintext") return code;
  try {
    const html = hljs.highlight(code, { language, ignoreIllegals: true }).value;
    return html;
  } catch (e) {
    return code;
  }
}

// ─── Char-level Myers (for intra-line highlight) ──────────────────────────────

function charDiff(a, b) {
  const n = a.length, m = b.length;
  if (!n && !m) return [];
  const max = n + m, off = max;
  const v = new Array(2*max+1).fill(-1);
  v[off+1] = 0;
  const snaps = [];
  outer: for (let d = 0; d <= max; d++) {
    for (let k = -d; k <= d; k += 2) {
      let x = (k===-d||(k!==d&&v[k-1+off]<v[k+1+off]))?v[k+1+off]:v[k-1+off]+1;
      let y = x - k;
      while (x<n&&y<m&&a[x]===b[y]){x++;y++;}
      v[k+off] = x;
      if (x>=n&&y>=m){snaps.push([...v]);break outer;}
    }
    snaps.push([...v]);
  }
  const edits=[];
  let x=n,y=m;
  for (let d=snaps.length-1;d>=0;d--) {
    const sv=snaps[d],k=x-y;
    const pk=(k===-d||(k!==d&&(sv[k+1+off]??-1)>(sv[k-1+off]??-1)))?k+1:k-1;
    const pv=d>0?snaps[d-1]:sv;
    const px=pv[pk+off]??0,py=px-pk;
    let cx=x,cy=y;
    while(cx>px+1&&cy>py+1){cx--;cy--;edits.push({t:"eq",a:cx,b:cy});}
    if(d>0){pk===k-1?edits.push({t:"del",a:px}):edits.push({t:"ins",b:py});}
    while(cx>px&&cy>py){cx--;cy--;edits.push({t:"eq",a:cx,b:cy});}
    x=px;y=py;
    if(x<=0&&y<=0)break;
  }
  edits.reverse();
  return edits;
}

function IntraLine({ textA, textB, side }) {
  const edits = useMemo(() => {
    if (textA == null || textB == null) return null;
    return charDiff(textA, textB);
  }, [textA, textB]);

  const src = side === "a" ? textA : textB;
  if (!edits || src == null) return <span>{src ?? ""}</span>;

  const out = [];
  let normal = "", hl = "", keyCounter = 0;
  const flush  = () => { if (normal) { out.push(<span key={`normal-${keyCounter++}`}>{normal}</span>); normal=""; }};
  const flushH = () => {
    if (hl) {
      out.push(
        <span key={`hl-${keyCounter++}`} style={{
          background: side==="a" ? C.charRemove : C.charAdd,
          borderRadius: 2, padding: "0 1px",
        }}>{hl}</span>
      );
      hl = "";
    }
  };
  for (const e of edits) {
    if (e.t === "eq") { flushH(); normal += src[side==="a"?e.a:e.b] ?? ""; }
    else if ((e.t==="del"&&side==="a")||(e.t==="ins"&&side==="b")) {
      flush(); hl += src[side==="a"?e.a:e.b] ?? "";
    }
  }
  flush(); flushH();
  return <>{out}</>;
}

// ─── ViewModel builder with chunking for large files ─────────────────────────

// Chunk threshold: if total lines > this, use incremental building
const CHUNK_THRESHOLD = 50000;
const CHUNK_SIZE = 10000;  // process 10K lines per chunk

function buildRowsChunked(linesA, linesB, blocks) {
  const totalLines = Math.max(linesA.length, linesB.length);
  
  // For small files, use original fast path
  if (totalLines < CHUNK_THRESHOLD) {
    return buildRows(linesA, linesB, blocks);
  }
  
  // For large files, build incrementally
  const rows = [];
  let ia = 0, ib = 0;
  
  for (const blk of blocks) {
    // Equal lines before block
    while (ia < blk.start_a && ib < blk.start_b) {
      rows.push({
        id: `eq-${ia+1}-${ib+1}`,
        type: "equal",
        la: ia + 1,
        lb: ib + 1,
        ta: linesA[ia],
        tb: linesB[ib],
      });
      ia++;
      ib++;
    }
    
    // Changed lines in block
    const na = blk.end_a - blk.start_a;
    const nb = blk.end_b - blk.start_b;
    for (let i = 0; i < Math.max(na, nb); i++) {
      const hasA = i < na, hasB = i < nb;
      if (hasA && hasB) {
        rows.push({
          id: `mod-${blk.start_a+i+1}-${blk.start_b+i+1}`,
          type: "modify",
          la: blk.start_a + i + 1,
          lb: blk.start_b + i + 1,
          ta: linesA[blk.start_a + i],
          tb: linesB[blk.start_b + i],
        });
      } else if (hasA) {
        rows.push({
          id: `rm-${blk.start_a+i+1}`,
          type: "remove",
          la: blk.start_a + i + 1,
          lb: null,
          ta: linesA[blk.start_a + i],
          tb: null,
        });
      } else {
        rows.push({
          id: `add-${blk.start_b+i+1}`,
          type: "add",
          la: null,
          lb: blk.start_b + i + 1,
          ta: null,
          tb: linesB[blk.start_b + i],
        });
      }
    }
    ia = blk.end_a;
    ib = blk.end_b;
  }
  
  // Trailing equal lines
  while (ia < linesA.length || ib < linesB.length) {
    rows.push({
      id: `eq-${ia<linesA.length?ia+1:"~"}-${ib<linesB.length?ib+1:"~"}`,
      type: "equal",
      la: ia < linesA.length ? ia + 1 : null,
      lb: ib < linesB.length ? ib + 1 : null,
      ta: linesA[ia] ?? null,
      tb: linesB[ib] ?? null,
    });
    ia++;
    ib++;
  }
  
  return rows;
}

function buildRows(linesA, linesB, blocks) {
  const rows = [];
  let ia = 0, ib = 0, rowId = 0;

  for (const blk of blocks) {
    while (ia < blk.start_a && ib < blk.start_b) {
      rows.push({ id:`eq-${ia+1}-${ib+1}`, type:"equal", la:ia+1, lb:ib+1, ta:linesA[ia], tb:linesB[ib] });
      ia++; ib++;
    }
    const na = blk.end_a - blk.start_a;
    const nb = blk.end_b - blk.start_b;
    for (let i = 0; i < Math.max(na, nb); i++) {
      const hasA = i < na, hasB = i < nb;
      if (hasA && hasB)
        rows.push({ id:`mod-${blk.start_a+i+1}-${blk.start_b+i+1}`, type:"modify", la:blk.start_a+i+1, lb:blk.start_b+i+1, ta:linesA[blk.start_a+i], tb:linesB[blk.start_b+i] });
      else if (hasA)
        rows.push({ id:`rm-${blk.start_a+i+1}`, type:"remove", la:blk.start_a+i+1, lb:null, ta:linesA[blk.start_a+i], tb:null });
      else
        rows.push({ id:`add-${blk.start_b+i+1}`, type:"add",    la:null, lb:blk.start_b+i+1, ta:null, tb:linesB[blk.start_b+i] });
    }
    ia = blk.end_a; ib = blk.end_b;
  }
  while (ia < linesA.length || ib < linesB.length) {
    rows.push({ id:`eq-${ia<linesA.length?ia+1:"~"}-${ib<linesB.length?ib+1:"~"}`, type:"equal", la:ia<linesA.length?ia+1:null, lb:ib<linesB.length?ib+1:null,
                ta:linesA[ia]??null, tb:linesB[ib]??null });
    ia++; ib++;
  }
  return rows;
}

// ─── DiffRow ──────────────────────────────────────────────────────────────────

const ROW_COLORS = {
  add:    { bg:C.addBg,    bgH:C.addBgHov,    gutter:C.addGutter,    bar:C.addLine,    sym:"+", tc:C.addText    },
  remove: { bg:C.removeBg, bgH:C.removeBgHov, gutter:C.removeGutter, bar:C.removeLine, sym:"−", tc:C.removeText },
  modify: { bg:C.modifyBg, bgH:C.modifyBgHov, gutter:C.modifyGutter, bar:C.modifyLine, sym:"~", tc:C.modifyText },
  equal:  { bg:"transparent", bgH:"#12161c", gutter:"transparent",    bar:"transparent",sym:" ", tc:C.text       },
};

function DiffRow({ row, hov, onHov, language="plaintext" }) {
  const rc = ROW_COLORS[row.type];
  const changed = row.type !== "equal";
  const bg = hov ? rc.bgH : rc.bg;

  const Gutter = ({ lineNo, sym }) => (
    <div style={{
      width:48, minWidth:48, display:"flex", alignItems:"center",
      justifyContent:"flex-end", paddingRight:8, gap:4,
      background: changed ? rc.gutter : "transparent",
      borderRight:`1px solid ${C.gutterBorder}`, flexShrink:0,
    }}>
      <span style={{ fontFamily:FONT_MONO, fontSize:11, color:hov?C.lineNumHov:C.lineNum,
                     userSelect:"none", minWidth:24, textAlign:"right" }}>
        {lineNo ?? ""}
      </span>
      <span style={{ color:rc.tc, fontSize:11, fontFamily:FONT_MONO, width:10, opacity:changed?1:0 }}>
        {sym}
      </span>
    </div>
  );

  // Highlight helper: parse hljs HTML and render with colors
  const renderHighlighted = (html) => {
    if (!html || language === "plaintext") return html;
    // Simple approach: use dangerouslySetInnerHTML but process HTML safely
    // Replace class names with style attributes
    let processedHtml = html;
    for (const [cls, color] of Object.entries(HL_THEME)) {
      const regex = new RegExp(`class="${cls}"`, "g");
      processedHtml = processedHtml.replace(regex, `style="color:${color}"`);
    }
    return (
      <span style={{ color: C.text }} dangerouslySetInnerHTML={{ __html: processedHtml }} />
    );
  };

  const Content = ({ text, side }) => {
    const displayText = row.type==="modify" && row.ta!=null && row.tb!=null
      ? null
      : (side==="a" ? row.ta : row.tb) ?? "";

    const highlighted = displayText && language !== "plaintext"
      ? highlightLine(displayText, language)
      : null;

    return (
      <div style={{
        flex:1, padding:"0 14px", overflow:"hidden", whiteSpace:"pre",
        fontFamily:FONT_MONO, fontSize:13, lineHeight:`${ROW_H}px`,
        color: row.type==="equal" ? C.text : rc.tc,
      }}>
        {row.type==="modify" && row.ta!=null && row.tb!=null
          ? <IntraLine textA={row.ta} textB={row.tb} side={side} />
          : highlighted ? renderHighlighted(highlighted) : displayText}
      </div>
    );
  };

  return (
    <div
      onMouseEnter={()=>onHov(true)}
      onMouseLeave={()=>onHov(false)}
      style={{
        display:"flex", height:ROW_H,
        background:bg,
        borderLeft:`2px solid ${changed?rc.bar:"transparent"}`,
        transition:"background 80ms ease",
      }}
    >
      <Gutter lineNo={row.la} sym={rc.sym} />
      <Content text={row.ta} side="a" />
      <div style={{width:1,background:C.border,flexShrink:0}} />
      <Gutter lineNo={row.lb} sym={rc.sym} />
      <Content text={row.tb} side="b" />
    </div>
  );
}

// ─── Virtual list ─────────────────────────────────────────────────────────────

function VirtualList({ rows, language="plaintext" }) {
  const outerRef  = useRef(null);
  const [scroll, setScroll] = useState(0);
  const [height, setHeight] = useState(600);
  const [hov,    setHov]    = useState(-1);

  useEffect(() => {
    const el = outerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setHeight(e.contentRect.height));
    ro.observe(el);
    setHeight(el.clientHeight);
    return () => ro.disconnect();
  }, []);

  const total = rows.length * ROW_H;
  const start = Math.max(0, Math.floor(scroll/ROW_H) - OVERSCAN);
  const end   = Math.min(rows.length, Math.ceil((scroll+height)/ROW_H) + OVERSCAN);

  return (
    <div ref={outerRef} onScroll={e=>setScroll(e.currentTarget.scrollTop)}
      style={{ flex:1, overflowY:"auto", overflowX:"auto", position:"relative",
               scrollbarWidth:"thin", scrollbarColor:`${C.scrollThumb} ${C.bg}` }}>
      <div style={{ height:total, position:"relative" }}>
        <div style={{ position:"absolute", top:start*ROW_H, width:"100%", minWidth:780 }}>
          {rows.slice(start,end).map((row,i) => {
            const idx = start+i;
            return <DiffRow key={row.id} row={row} hov={hov===idx} onHov={h=>setHov(h?idx:-1)} language={language} />;
          })}
        </div>
      </div>
    </div>
  );
}

// ─── Stats ────────────────────────────────────────────────────────────────────

function Stats({ blocks }) {
  const s = useMemo(()=>{
    let add=0,rm=0,mod=0;
    for (const b of blocks) {
      if (b.change_type==="Add")    add+=b.content_b.length;
      if (b.change_type==="Remove") rm +=b.content_a.length;
      if (b.change_type==="Modify") mod+=Math.max(b.content_a.length,b.content_b.length);
    }
    return {add,rm,mod,hunks:blocks.length};
  },[blocks]);

  const Tag = ({color,label,val}) => (
    <div style={{display:"flex",alignItems:"center",gap:5}}>
      <div style={{width:7,height:7,borderRadius:"50%",background:color}}/>
      <span style={{color:C.textMuted,fontSize:11,fontFamily:FONT_UI}}>{label}</span>
      <span style={{color:C.text,fontSize:11,fontFamily:FONT_MONO,fontWeight:600}}>{val}</span>
    </div>
  );
  return (
    <div style={{display:"flex",alignItems:"center",gap:18,padding:"5px 16px",
                 borderBottom:`1px solid ${C.border}`,background:C.headerBg,flexWrap:"wrap"}}>
      <Tag color={C.addLine}    label="added"    val={`+${s.add}`}/>
      <Tag color={C.removeLine} label="removed"  val={`-${s.rm}`}/>
      <Tag color={C.modifyLine} label="modified" val={`~${s.mod}`}/>
      <span style={{marginLeft:"auto",color:C.textMuted,fontSize:11,fontFamily:FONT_UI}}>
        {s.hunks} hunk{s.hunks!==1?"s":""}
      </span>
    </div>
  );
}

// ─── Header bar ───────────────────────────────────────────────────────────────

function Header({ onOpenFiles, onBack, mode, isTauri, loading, cacheHit }) {
  return (
    <div style={{display:"flex",alignItems:"center",gap:10,padding:"0 16px",
                 height:44,borderBottom:`1px solid ${C.border}`,background:C.headerBg,
                 flexShrink:0}}>
      {/* Logo */}
      <div style={{display:"flex",alignItems:"center",gap:8,marginRight:8}}>
        <div style={{width:26,height:26,background:C.accent,borderRadius:5,display:"flex",
                     alignItems:"center",justifyContent:"center"}}>
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
            <rect x="2" y="3" width="5" height="10" rx="1" stroke="#0d0f11" strokeWidth="1.5"/>
            <rect x="9" y="3" width="5" height="10" rx="1" stroke="#0d0f11" strokeWidth="1.5"/>
            <path d="M7.5 8h1" stroke="#0d0f11" strokeWidth="1.5" strokeLinecap="round"/>
          </svg>
        </div>
        <span style={{fontFamily:FONT_UI,fontSize:14,fontWeight:700,color:C.text,letterSpacing:"-0.02em"}}>
          diff<span style={{color:C.accent}}>·</span>core
        </span>
      </div>
      
      {/* P2.3: Cache hit indicator */}
      {cacheHit && mode === "diff" && (
        <div style={{
          padding:"2px 8px", borderRadius:3, fontSize:10, fontFamily:FONT_MONO,
          background: "rgba(38, 166, 65, 0.1)",
          border:"1px solid rgba(38, 166, 65, 0.3)",
          color: C.accent,
          animation: "pulse 1.5s ease-in-out infinite",
        }}>
          ⚡ cache hit
        </div>
      )}

      {/* Engine badge */}
      <div style={{
        padding:"2px 8px", borderRadius:3, fontSize:10, fontFamily:FONT_MONO,
        background: isTauri ? C.accentDim : "#1a1a2e",
        border:`1px solid ${isTauri ? C.accentBorder : "#2a2a4a"}`,
        color: isTauri ? C.accent : "#6060a0",
      }}>
        {isTauri ? "rust engine" : "js engine"}
      </div>

      <div style={{marginLeft:"auto",display:"flex",gap:8,alignItems:"center"}}>
        {loading && (
          <span style={{color:C.textMuted,fontSize:11,fontFamily:FONT_UI,
                        animation:"pulse 1s ease-in-out infinite"}}>
            computing…
          </span>
        )}
        {mode==="diff" && (
          <Btn onClick={onBack} variant="ghost">← Edit</Btn>
        )}
        {isTauri && (
          <Btn onClick={onOpenFiles} variant="primary" disabled={loading}>
            Open files…
          </Btn>
        )}
      </div>
    </div>
  );
}

// ─── Button ───────────────────────────────────────────────────────────────────

function Btn({ children, onClick, variant="ghost", disabled=false }) {
  const base = {
    padding:"5px 14px", borderRadius:4, fontSize:12, fontFamily:FONT_UI,
    fontWeight:600, cursor:disabled?"not-allowed":"pointer",
    opacity:disabled?0.5:1, transition:"opacity 120ms",
    border:"none", outline:"none",
  };
  const styles = {
    primary: { ...base, background:C.accent, color:"#0d0f11" },
    ghost:   { ...base, background:"transparent", border:`1px solid ${C.border}`, color:C.text },
  };
  return <button style={styles[variant]} onClick={onClick} disabled={disabled}>{children}</button>;
}

// ─── Editor pane ─────────────────────────────────────────────────────────────

function EditorPane({ label, badge, badgeColor, value, onChange }) {
  return (
    <div style={{flex:1,display:"flex",flexDirection:"column",minWidth:0}}>
      <div style={{display:"flex",alignItems:"center",gap:8,padding:"6px 14px",
                   borderBottom:`1px solid ${C.border}`,background:C.headerBg,flexShrink:0}}>
        <span style={{color:C.textMuted,fontSize:10,fontFamily:FONT_UI,
                      letterSpacing:"0.07em",textTransform:"uppercase"}}>{label}</span>
        <span style={{marginLeft:"auto",fontSize:10,fontFamily:FONT_UI,
                      background:`${badgeColor}18`,border:`1px solid ${badgeColor}35`,
                      borderRadius:3,padding:"1px 7px",color:badgeColor}}>{badge}</span>
      </div>
      <textarea value={value} onChange={e=>onChange(e.target.value)}
        placeholder="Paste text here…"
        style={{flex:1,resize:"none",background:C.panel,border:"none",outline:"none",
                color:C.text,fontFamily:FONT_MONO,fontSize:13,lineHeight:"22px",
                padding:"12px 16px",scrollbarWidth:"thin",
                scrollbarColor:`${C.scrollThumb} ${C.bg}`}}/>
    </div>
  );
}

// ─── File label bar ───────────────────────────────────────────────────────────

function FileLabelBar({ nameA, nameB }) {
  const Side = ({ name, badge, color }) => (
    <div style={{flex:1,display:"flex",alignItems:"center",gap:8,padding:"6px 14px",
                 borderRight:name===nameA?`1px solid ${C.border}`:"none"}}>
      <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
        <path d="M4 2h5.5L13 5.5V14H4V2z" stroke={C.accent} strokeWidth="1.2" fill="none"/>
        <path d="M9 2v4h4" stroke={C.accent} strokeWidth="1.2"/>
      </svg>
      <span style={{fontFamily:FONT_MONO,fontSize:12,color:C.text,overflow:"hidden",
                    textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{name}</span>
      <span style={{marginLeft:"auto",fontSize:10,fontFamily:FONT_UI,
                    background:`${color}18`,border:`1px solid ${color}35`,
                    borderRadius:3,padding:"1px 7px",color}}>{badge}</span>
    </div>
  );
  return (
    <div style={{display:"flex",borderBottom:`1px solid ${C.border}`,background:C.headerBg}}>
      <Side name={nameA} badge="original" color={C.removeLine}/>
      <Side name={nameB} badge="modified" color={C.addLine}/>
    </div>
  );
}

// ─── Demo data ────────────────────────────────────────────────────────────────

const DEMO = [
`fn compute_hash(data: &[u8]) -> u64 {
    let mut h: u64 = 0xcbf29ce484222325;
    for byte in data {
        h ^= *byte as u64;
        h = h.wrapping_mul(0x100000001b3);
    }
    h
}

struct Cache {
    entries: HashMap<u64, Vec<u8>>,
    capacity: usize,
}

impl Cache {
    fn new(capacity: usize) -> Self {
        Self { entries: HashMap::new(), capacity }
    }

    fn insert(&mut self, key: u64, value: Vec<u8>) {
        if self.entries.len() >= self.capacity {
            let k = *self.entries.keys().next().unwrap();
            self.entries.remove(&k);
        }
        self.entries.insert(key, value);
    }

    fn get(&self, key: u64) -> Option<&Vec<u8>> {
        self.entries.get(&key)
    }
}`,
`fn compute_hash(data: &[u8], seed: u64) -> u64 {
    let mut h: u64 = seed ^ 0xcbf29ce484222325;
    for byte in data {
        h ^= *byte as u64;
        h = h.wrapping_mul(0x100000001b3);
        h ^= h >> 33;
    }
    h
}

struct Cache<V> {
    entries: HashMap<u64, V>,
    capacity: usize,
    hits: usize,
    misses: usize,
}

impl<V> Cache<V> {
    fn new(capacity: usize) -> Self {
        Self { entries: HashMap::new(), capacity, hits: 0, misses: 0 }
    }

    fn insert(&mut self, key: u64, value: V) {
        if self.entries.len() >= self.capacity {
            let k = *self.entries.keys().next().unwrap();
            self.entries.remove(&k);
        }
        self.entries.insert(key, value);
    }

    fn get(&mut self, key: u64) -> Option<&V> {
        match self.entries.get(&key) {
            Some(v) => { self.hits += 1; Some(v) }
            None    => { self.misses += 1; None }
        }
    }

    fn hit_rate(&self) -> f64 {
        let total = self.hits + self.misses;
        if total == 0 { 0.0 } else { self.hits as f64 / total as f64 }
    }
}`,
];

// v0.9 AST Diff demo data - showcasing semantic changes
const DEMO_AST = [
  // Original Rust code
  `fn process_data(input: Vec<String>) -> u32 {
    let mut count = 0;
    for item in input {
        count += 1;
    }
    count
}

fn validate(data: &str) -> bool {
    !data.is_empty()
}

struct Config {
    timeout: u64,
    retries: u32,
}`,
  // Modified version with semantic changes
  `fn process_data(input: Vec<String>, verbose: bool) -> Result<u32, String> {
    let mut count = 0;
    for item in input {
        if verbose {
            println!("Processing: {}", item);
        }
        count += 1;
    }
    Ok(count)
}

fn validate_strict(data: &str) -> Result<bool, &'static str> {
    if data.is_empty() {
        Err("empty string")
    } else {
        Ok(true)
    }
}

struct Config {
    timeout: u64,
    retries: u32,
    max_connections: usize,
}`,
];

// ─── App ─────────────────────────────────────────────────────────────────────

export default function App() {
  const { diffText, diffFiles, diffAstText, clearCache, loading, error, isTauri } = useDiff();

  const [mode,   setMode]   = useState("edit");   // "edit" | "diff"
  const [textA,  setTextA]  = useState("");
  const [textB,  setTextB]  = useState("");
  const [nameA,  setNameA]  = useState("original");
  const [nameB,  setNameB]  = useState("modified");
  const [pathA,  setPathA]  = useState("");
  const [pathB,  setPathB]  = useState("");
  const [blocks, setBlocks] = useState([]);
  const [astMode, setAstMode] = useState(false);
  const [astResult, setAstResult] = useState(null);
  const ast = useMemo(() => {
    if (!astResult) return null;

    const normalizeNode = (node) => {
      if (!node) return null;
      return {
        kind: node.kind ?? node.node_type,
        snippet: node.snippet ?? node.text_snippet,
        startLine: node.startLine ?? node.start_line,
        endLine: node.endLine ?? node.end_line,
        identifier: node.identifier ?? node.identifier,
      };
    };

    const blocks = (astResult.blocks || []).map((block) => {
      const raw = block || {};
      return {
        changeType: raw.changeType ?? raw.change_type,
        semanticType: raw.semanticType ?? raw.semantic_type,
        severity: raw.severity,
        description: raw.description,
        oldIdentifier: raw.oldIdentifier ?? raw.old_identifier,
        newIdentifier: raw.newIdentifier ?? raw.new_identifier,
        fromNode: normalizeNode(raw.fromNode ?? raw.from_node),
        toNode: normalizeNode(raw.toNode ?? raw.to_node),
      };
    });

    return {
      language: astResult.language ?? astResult.lang,
      totalChanges: astResult.totalChanges ?? astResult.total_changes ?? blocks.length,
      majorChanges: astResult.majorChanges ?? astResult.major_changes ?? 0,
      addedElements: astResult.addedElements ?? astResult.added_elements ?? 0,
      removedElements: astResult.removedElements ?? astResult.removed_elements ?? 0,
      modifiedElements: astResult.modifiedElements ?? astResult.modified_elements ?? 0,
      blocks,
    };
  }, [astResult]);
  const [cacheHit, setCacheHit] = useState(false);  // P2.3: Track incremental diff
  const [folderMode, setFolderMode] = useState(false);  // v0.7: Folder comparison mode
  const [folderPathA, setFolderPathA] = useState("");
  const [folderPathB, setFolderPathB] = useState("");
  const [folderTree, setFolderTree] = useState(null);
  const [comparingFolder, setComparingFolder] = useState(false);
  const [loadingFile, setLoadingFile] = useState(false);  // v0.7: Track file loading from folder diff
  const [mergeMode, setMergeMode] = useState(false);  // v0.8: Merge mode flag
  const [astLanguage, setAstLanguage] = useState("js");  // v0.9: Selected language for AST diff

  useEffect(() => {
    if (pathB) {
      const detected = detectLanguage(nameB);
      const map = {
        javascript: "js",
        jsx: "js",
        typescript: "ts",
        python: "py",
        rust: "rs",
        java: "java",
        cpp: "cpp",
        go: "go",
      };
      const normalized = map[detected] || "js";
      setAstLanguage(normalized);
    }
  }, [pathB, nameB]);

  const linesA = useMemo(()=>textA.split("\n"),[textA]);
  const linesB = useMemo(()=>textB.split("\n"),[textB]);
  const rows   = useMemo(()=>mode==="diff"?buildRowsChunked(linesA,linesB,blocks):[],[linesA,linesB,blocks,mode]);
  const language = useMemo(()=>detectLanguage(nameB), [nameB]);
  const astFilePath = useMemo(() => {
    // Use the AST language selected by the user, not the raw path extension.
    const ext = astLanguage || "js";
    return `code.${ext}`;
  }, [astLanguage]);

  const astParserLanguage = useMemo(() => {
    const map = {
      js: "javascript",
      ts: "typescript",
      py: "python",
      rs: "rust",
      java: "java",
      cpp: "cpp",
      go: "go",
    };
    return map[astLanguage] || "plaintext";
  }, [astLanguage]);

  const astLanguageMismatch = useMemo(() => {
    if (!nameB) return false;
    return astParserLanguage !== detectLanguage(nameB);
  }, [astParserLanguage, nameB]);

  const runDiff = useCallback(async (a=textA, b=textB) => {
    setCacheHit(false);  // Reset cache indicator before diff
    const startTime = performance.now();
    const result = await diffText(a, b);
    const elapsed = performance.now() - startTime;
    console.log(`[P2.3] Diff completed in ${elapsed.toFixed(2)}ms`);
    
    // P2.3: Detect cache hit by measuring time
    // Cache hit: < 5ms (hash comparison only)
    // Cache miss: > 50ms (actual diff computation)
    if (elapsed < 5) {
      setCacheHit(true);
      console.log(`[P2.3] Cache hit: ${elapsed.toFixed(2)}ms`);
    } else {
      console.log(`[P2.3] Cache miss: ${elapsed.toFixed(2)}ms`);
    }
    setBlocks(result);
    setMode("diff");
  }, [diffText, textA, textB]);

  const runAstDiff = useCallback(async () => {
    setCacheHit(false);
    setAstResult(null);
    try {
      const result = await diffAstText(textA, textB, astFilePath);
      if (result) {
        setAstResult(result);
        setMode("diff");
        setAstMode(true);
      }
    } catch (err) {
      console.error("[AST] diff error:", err);
    }
  }, [diffAstText, textA, textB, astFilePath]);

  // v0.9: Handle AST file selection - open two files and run AST diff
  const handleOpenAstFiles = useCallback(async () => {
    if (!isTauri()) {
      alert("File picker requires Tauri desktop runtime");
      return;
    }
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      const dialog = await import("@tauri-apps/plugin-dialog").then(m => m);
      
      const pathA = await dialog.open({ title: "Select original file", multiple: false });
      if (!pathA) return;
      
      const pathB = await dialog.open({ title: "Select modified file", multiple: false });
      if (!pathB) return;
      
      setLoadingFile(true);
      
      // Fetch both file contents
      const [textA, textB] = await Promise.all([
        invoke("read_file_text", { path: pathA }),
        invoke("read_file_text", { path: pathB }),
      ]);
      
      // Update state
      setTextA(textA);
      setTextB(textB);
      setPathA(pathA);
      setPathB(pathB);
      
      const nameA = pathA.split(/[/\\]/).pop();
      const nameB = pathB.split(/[/\\]/).pop();
      setNameA(nameA);
      setNameB(nameB);
      
      // Trigger AST diff with file paths
      setAstResult(null);
      setAstMode(true);
      
      // Determine file path for language detection
      const filePath = pathB; // Use modified file for language detection
      
      // Call AST diff directly with loaded content
      const result = await diffAstText(textA, textB, filePath);
      if (result) {
        setAstResult(result);
        setMode("diff");
      }
      
      console.log(`[v0.9] AST diff files loaded: ${nameA} vs ${nameB}`);
    } catch (err) {
      console.error("[v0.9] AST file select error:", err);
      alert(`Error loading files: ${err?.message ?? String(err)}`);
    } finally {
      setLoadingFile(false);
    }
  }, [isTauri, diffAstText]);

  const handleOpenFiles = useCallback(async () => {
    const res = await diffFiles();
    if (!res) return;
    setFolderMode(false);  // v0.7: Reset to text diff mode
    setAstMode(false);
    setAstResult(null);
    setTextA(res.textA);
    setTextB(res.textB);
    setPathA(res.pathA);
    setPathB(res.pathB);
    setNameA(res.pathA.split(/[/\\]/).pop());
    setNameB(res.pathB.split(/[/\\]/).pop());
    setBlocks(res.blocks);
    setCacheHit(false);  // P2.3: Clear cache indicator
    setMode("diff");
  }, [diffFiles]);

  const handleDemo = useCallback(async () => {
    if (astMode) {
      // AST diff demo
      setTextA(DEMO_AST[0]);
      setTextB(DEMO_AST[1]);
      setPathA("");
      setPathB("");
      setNameA("process_v1.rs");
      setNameB("process_v2.rs");
      setCacheHit(false);
      await runAstDiff();
    } else {
      // Line diff demo
      setTextA(DEMO[0]);
      setTextB(DEMO[1]);
      setPathA("");
      setPathB("");
      setNameA("cache_v1.rs");
      setNameB("cache_v2.rs");
      setAstMode(false);
      setAstResult(null);
      setCacheHit(false);
      await runDiff(DEMO[0], DEMO[1]);
    }
  }, [runDiff, runAstDiff, astMode]);
  
  // P2.3: Clear cache when text is edited (keep AST mode if selected)
  const handleTextAChange = useCallback((val) => {
    setTextA(val);
    setAstResult(null);  // Clear result but keep AST mode
    clearCache();
    setCacheHit(false);
  }, [clearCache]);
  
  const handleTextBChange = useCallback((val) => {
    setTextB(val);
    setAstResult(null);  // Clear result but keep AST mode
    clearCache();
    setCacheHit(false);
  }, [clearCache]);

  // P3.1: Apply changes from A to B (one-way merge)
  const handleApplyChanges = useCallback(async () => {
    setTextB(textA);
    setNameB(`${nameB} (merged from ${nameA})`);
    setAstMode(false);
    setAstResult(null);
    clearCache();
    setCacheHit(false);
    // Automatically run diff to show unified view
    setTimeout(() => {
      const result = runDiff(textA, textA);
    }, 50);
    console.log(`[P3.1] Applied changes from ${nameA} to ${nameB}`);
  }, [textA, nameA, nameB, clearCache, runDiff]);

  // v0.7: Handle folder comparison
  const handleCompareFolders = useCallback(() => {
    if (!folderPathA || !folderPathB) {
      alert("Please enter both folder paths");
      return;
    }
    // Trigger FolderDiff to start comparison by setting a dummy tree object
    // This signals FolderDiff that we're ready to compare
    setFolderTree({});  // Use empty object as signal to start comparison
  }, [folderPathA, folderPathB]);

  // v0.7: Handle file selection from folder diff tree
  const handleFileSelect = useCallback(async (pathA, pathB) => {
    try {
      setLoadingFile(true);
      
      // Lazy-load Tauri invoke API
      const { invoke } = await import("@tauri-apps/api/core");
      
      // Fetch both file contents and diff in parallel
      const [textA, textB, blocks] = await Promise.all([
        invoke("read_file_text", { path: pathA }),
        invoke("read_file_text", { path: pathB }),
        invoke("diff_files", { pathA, pathB }),
      ]);
      
      // Update editor state with file contents and diff results
      setTextA(textA);
      setTextB(textB);
      setPathA(pathA);
      setPathB(pathB);
      setBlocks(blocks);
      
      // Extract file names from paths (last part after / or \)
      const nameA = pathA.split(/[/\\]/).pop();
      const nameB = pathB.split(/[/\\]/).pop();
      setNameA(nameA);
      setNameB(nameB);
      
      setAstMode(false);
      setAstResult(null);
      
      // Clear any previous state and exit folder mode
      setFolderMode(false);
      setCacheHit(false);
      
      // Switch to diff view
      setMode("diff");
      
      console.log(`[v0.7] File diff loaded: ${nameA} vs ${nameB}`);
    } catch (err) {
      console.error("[v0.7] File select error:", err);
      alert(`Error loading file: ${err?.message ?? String(err)}`);
    } finally {
      setLoadingFile(false);
    }
  }, []);

  return (
    <>
      <style>{`
        /* Local font stacks with system fonts — works offline */
        @supports (font-family: -apple-system) {
          html { --font-mono: -apple-system-monospace, 'Menlo', 'Monaco', 'Courier New', monospace; }
        }
        @supports not (font-family: -apple-system) {
          html { --font-mono: 'Courier New', 'Courier', monospace; }
        }
        *{box-sizing:border-box;margin:0;padding:0;}
        body{background:${C.bg};}
        ::-webkit-scrollbar{width:6px;height:6px;}
        ::-webkit-scrollbar-track{background:${C.bg};}
        ::-webkit-scrollbar-thumb{background:${C.scrollThumb};border-radius:3px;}
        ::-webkit-scrollbar-thumb:hover{background:#333d4a;}
        @keyframes pulse{0%,100%{opacity:1}50%{opacity:0.4}}
      `}</style>

      <div style={{height:"100vh",display:"flex",flexDirection:"column",
                   background:C.bg,color:C.text,fontFamily:FONT_UI,overflow:"hidden"}}>

        {/* v0.7: Mode selector + v0.8: Merge mode */}
        <div style={{display:"flex",gap:10,padding:"8px 16px",background:C.headerBg,
                     borderBottom:`1px solid ${C.border}`,flexShrink:0}}>
          <button onClick={()=>{setFolderMode(false);setMergeMode(false);}} 
                  style={{padding:"6px 12px",background:!folderMode&&!mergeMode?C.accent:"transparent",
                          color:C.text,border:"none",cursor:"pointer",borderRadius:4,
                          fontSize:12,fontWeight:500}}>
            Text/File Diff
          </button>
          <button onClick={()=>{setFolderMode(true);setMergeMode(false);setAstMode(false);}} 
                  style={{padding:"6px 12px",background:folderMode&&!mergeMode&&!astMode?C.accent:"transparent",
                          color:C.text,border:"none",cursor:"pointer",borderRadius:4,
                          fontSize:12,fontWeight:500}}>
            📁 Folder Diff
          </button>
          <button onClick={()=>{setFolderMode(false);setMergeMode(true);setAstMode(false);}} 
                  style={{padding:"6px 12px",background:mergeMode?C.accent:"transparent",
                          color:C.text,border:"none",cursor:"pointer",borderRadius:4,
                          fontSize:12,fontWeight:500}}>
            🔀 Merge
          </button>
        </div>

        <Header
          onOpenFiles={handleOpenFiles}
          onBack={()=>setMode("edit")}
          mode={mode} isTauri={isTauri} loading={loading} cacheHit={cacheHit}
        />

        {error && (
          <div style={{padding:"8px 16px",background:"#2d0f0f",borderBottom:`1px solid ${C.removeLine}44`,
                       color:C.removeText,fontSize:12,fontFamily:FONT_MONO}}>
            ⚠ {error}
          </div>
        )}

        {mergeMode ? (
          // v0.8: Merge mode
          <MergePanel
            sourceText={textA}
            targetText={textB}
            onMergeComplete={(result) => {
              setTextB(result.merged_text);
              setNameB(`${nameB} (merged)`);
              setMergeMode(false);
              alert('Merge completed!');
            }}
          />
        ) : folderMode ? (
          // v0.7: Folder comparison mode
          <div style={{flex:1,display:"flex",flexDirection:"column",overflow:"hidden"}}>
            {/* Path input area */}
            <div style={{display:"flex",gap:10,padding:"12px 16px",background:C.headerBg,
                         borderBottom:`1px solid ${C.border}`,flexShrink:0}}>
              <div style={{flex:1}}>
                <label style={{display:"block",fontSize:12,color:C.textMuted,marginBottom:4}}>
                  Folder A
                </label>
                <input type="text" placeholder="/path/to/folder-a"
                       value={folderPathA}
                       onChange={e => setFolderPathA(e.target.value)}
                       style={{width:"100%",padding:"6px 8px",background:C.panel,
                               border:`1px solid ${C.border}`,color:C.text,
                               borderRadius:3,fontFamily:FONT_MONO,fontSize:12,
                               boxSizing:"border-box"}}/>
              </div>
              <div style={{flex:1}}>
                <label style={{display:"block",fontSize:12,color:C.textMuted,marginBottom:4}}>
                  Folder B
                </label>
                <input type="text" placeholder="/path/to/folder-b"
                       value={folderPathB}
                       onChange={e => setFolderPathB(e.target.value)}
                       style={{width:"100%",padding:"6px 8px",background:C.panel,
                               border:`1px solid ${C.border}`,color:C.text,
                               borderRadius:3,fontFamily:FONT_MONO,fontSize:12,
                               boxSizing:"border-box"}}/>
              </div>
              <button onClick={handleCompareFolders} disabled={comparingFolder}
                      style={{padding:"6px 12px",background:C.accent,color:C.bg,
                              border:"none",cursor:"pointer",borderRadius:3,
                              fontWeight:600,alignSelf:"flex-end",fontSize:12}}>
                {comparingFolder ? "Comparing..." : "Compare"}
              </button>
            </div>

            {/* Folder tree display */}
            {folderTree ? (
              <div style={{flex:1,overflow:"auto"}}>
                <FolderDiff
                  pathA={folderPathA}
                  pathB={folderPathB}
                  onFileSelect={handleFileSelect}
                />
              </div>
            ) : (
              <div style={{flex:1,display:"flex",alignItems:"center",justifyContent:"center",
                           color:C.textMuted,fontSize:14}}>
                Enter folder paths and click "Compare"
              </div>
            )}
          </div>
        ) : mode === "edit" ? (
          <div style={{flex:1,display:"flex",flexDirection:"column",overflow:"hidden"}}>
            <div style={{flex:1,display:"flex",overflow:"hidden"}}>
              <EditorPane label="File A · Original" badge="before" badgeColor={C.removeLine}
                          value={textA} onChange={handleTextAChange}/>
              <div style={{width:1,background:C.border}}/>
              <EditorPane label="File B · Modified" badge="after" badgeColor={C.addLine}
                          value={textB} onChange={handleTextBChange}/>
            </div>
            <div style={{display:"flex",alignItems:"center",justifyContent:"center",
                         gap:10,padding:"14px 16px",background:C.headerBg,
                         borderTop:`1px solid ${C.border}`}}>
              {astMode && (
                <select value={astLanguage} onChange={(e)=>setAstLanguage(e.target.value)}
                        style={{padding:"6px 10px",borderRadius:4,border:`1px solid ${C.border}`,
                                background:C.bg,color:C.text,fontSize:12,cursor:"pointer",
                                fontFamily:FONT_UI}}>
                  <option value="js">JavaScript</option>
                  <option value="py">Python</option>
                  <option value="rs">Rust</option>
                  <option value="java">Java</option>
                  <option value="cpp">C++</option>
                  <option value="go">Go</option>
                  <option value="ts">TypeScript</option>
                </select>
              )}
              <Btn variant="primary" onClick={()=>astMode ? runAstDiff() : runDiff()} disabled={loading||(!textA&&!textB)}>
                {loading ? "Computing…" : astMode ? "Run AST Diff →" : "Run Diff →"}
              </Btn>
              <Btn variant="ghost" onClick={handleDemo}>Try demo</Btn>
              {isTauri && (
                <>
                  <Btn variant="ghost" onClick={astMode ? handleOpenAstFiles : handleOpenFiles} disabled={loading}>
                    Open files… {astMode && "🧠"}
                  </Btn>
                </>
              )}
            </div>
          </div>
        ) : mode === "diff" && astMode ? (
          <div style={{flex:1,display:"flex",flexDirection:"column",overflow:"hidden"}}>
            <FileLabelBar nameA={nameA} nameB={nameB}/>
            
            {/* AST Result Header with Stats */}
            <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:14,padding:"12px 16px",
                         background:C.headerBg,borderBottom:`1px solid ${C.border}`}}>
              <div style={{display:"flex",alignItems:"center",gap:12}}>
                <div>
                  <div style={{fontSize:13,fontFamily:FONT_UI,color:C.text,fontWeight:600}}>🧠 AST Semantic Diff</div>
                  <div style={{fontSize:11,fontFamily:FONT_MONO,color:C.textMuted,marginTop:2}}>
                    {ast?.language || "unknown"}
                    {astLanguageMismatch && (
                      <div style={{marginTop:4,color:"#f8d847"}}>
                        Warning: selected AST parser is <strong>{astParserLanguage}</strong> but file extension indicates <strong>{language}</strong>.
                      </div>
                    )}
                  </div>
                </div>
              </div>
              
              <div style={{display:"flex",gap:8,flexWrap:"wrap",alignItems:"center"}}>
                <div style={{display:"flex",gap:6}}>
                  <span style={{padding:"4px 8px",borderRadius:3,background:"rgba(38,166,65,0.15)",color:C.accent,fontSize:10,fontFamily:FONT_MONO,fontWeight:600}}>
                    {ast?.totalChanges ?? 0} changes
                  </span>
                  {ast?.majorChanges > 0 && (
                    <span style={{padding:"4px 8px",borderRadius:3,background:"rgba(227,179,65,0.15)",color:C.modifyText,fontSize:10,fontFamily:FONT_MONO,fontWeight:600}}>
                      {ast.majorChanges} major
                    </span>
                  )}
                  {ast?.removedElements > 0 && (
                    <span style={{padding:"4px 8px",borderRadius:3,background:"rgba(218,54,51,0.15)",color:C.removeText,fontSize:10,fontFamily:FONT_MONO,fontWeight:600}}>
                      -{ast.removedElements}
                    </span>
                  )}
                  {ast?.addedElements > 0 && (
                    <span style={{padding:"4px 8px",borderRadius:3,background:"rgba(45,35,18,0.15)",color:C.addText,fontSize:10,fontFamily:FONT_MONO,fontWeight:600}}>
                      +{ast.addedElements}
                    </span>
                  )}
                </div>
              </div>
            </div>
            
            {/* AST Results Scrollable Container */}
            <div style={{flex:1,overflowY:"auto",padding:"12px 16px",display:"flex",flexDirection:"column",gap:10,background:C.bg}}>
              {ast?.blocks?.length > 0 ? (
                ast.blocks.map((block, index) => {
                  const typeColor = block.changeType === "add" ? C.addBg : 
                                   block.changeType === "remove" ? C.removeBg : C.modifyBg;
                  const typeTextColor = block.changeType === "add" ? C.addText : 
                                       block.changeType === "remove" ? C.removeText : C.modifyText;
                  const severityIcon = block.severity === "major" ? "🔴" : 
                                      block.severity === "minor" ? "🟡" : "🟢";
                  
                  return (
                    <div key={index} style={{
                      padding:"12px 14px",
                      borderRadius:6,
                      background:C.panel,
                      border:`1px solid ${C.border}`,
                      transition:"all 150ms ease",
                      cursor:"pointer"
                    }} onMouseEnter={e => e.currentTarget.style.borderColor = C.accentBorder}
                       onMouseLeave={e => e.currentTarget.style.borderColor = C.border}>
                      
                      {/* Change header */}
                      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:10}}>
                        <div style={{display:"flex",alignItems:"center",gap:8}}>
                          <span style={{fontSize:11,fontFamily:FONT_MONO,color:C.textMuted,textTransform:"uppercase",letterSpacing:"0.05em"}}>
                            {block.semanticType}
                          </span>
                          <span style={{fontSize:12,fontFamily:FONT_UI,color:C.text,fontWeight:600}}>
                            {block.description}
                          </span>
                        </div>
                        <div style={{display:"flex",gap:6,alignItems:"center"}}>
                          <span style={{fontSize:10,fontFamily:FONT_MONO,color:C.textMuted}}>
                            {severityIcon} {block.severity}
                          </span>
                          <span style={{padding:"3px 7px",borderRadius:3,background:typeColor,color:typeTextColor,fontSize:9,fontFamily:FONT_MONO,fontWeight:600,textTransform:"uppercase"}}>
                            {block.changeType}
                          </span>
                        </div>
                      </div>
                      
                      {/* Meta info */}
                      <div style={{display:"flex",gap:12,flexWrap:"wrap",fontSize:10,fontFamily:FONT_MONO,color:C.textMuted,marginBottom:10}}>
                        {block.oldIdentifier && (
                          <span style={{color:C.removeText}}>from <strong>{block.oldIdentifier}</strong></span>
                        )}
                        {block.newIdentifier && (
                          <span style={{color:C.addText}}>to <strong>{block.newIdentifier}</strong></span>
                        )}
                      </div>
                      
                      {/* Node diff grid */}
                      {(block.fromNode || block.toNode) && (
                        <div style={{display:"grid",gridTemplateColumns:block.fromNode&&block.toNode?"1fr 1fr":"1fr",gap:10}}>
                          {block.fromNode && (
                            <div style={{padding:10,borderRadius:4,background:"rgba(255,0,0,0.05)",border:`1px solid ${C.removeBorder || C.border}`}}>
                              <div style={{fontSize:9,fontFamily:FONT_UI,color:C.removeText,fontWeight:600,marginBottom:6,textTransform:"uppercase"}}>
                                ← Original
                              </div>
                              <div style={{fontFamily:FONT_MONO,fontSize:11,color:C.text,whiteSpace:"pre-wrap",wordBreak:"break-word",maxHeight:"120px",overflowY:"auto",background:C.bg,padding:8,borderRadius:3,border:`1px solid ${C.border}`}}>
                                {block.fromNode?.snippet}
                              </div>
                              <div style={{fontSize:9,fontFamily:FONT_MONO,color:C.textMuted,marginTop:6}}>
                                {block.fromNode?.kind} • L{block.fromNode?.startLine}
                              </div>
                            </div>
                          )}
                          {block.toNode && (
                            <div style={{padding:10,borderRadius:4,background:"rgba(0,255,0,0.05)",border:`1px solid ${C.addBorder || C.border}`}}>
                              <div style={{fontSize:9,fontFamily:FONT_UI,color:C.addText,fontWeight:600,marginBottom:6,textTransform:"uppercase"}}>
                                Modified →
                              </div>
                              <div style={{fontFamily:FONT_MONO,fontSize:11,color:C.text,whiteSpace:"pre-wrap",wordBreak:"break-word",maxHeight:"120px",overflowY:"auto",background:C.bg,padding:8,borderRadius:3,border:`1px solid ${C.border}`}}>
                                {block.toNode?.snippet}
                              </div>
                              <div style={{fontSize:9,fontFamily:FONT_MONO,color:C.textMuted,marginTop:6}}>
                                {block.toNode?.kind} • L{block.toNode?.startLine}
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })
              ) : (
                <div style={{display:"flex",alignItems:"center",justifyContent:"center",minHeight:"200px",color:C.textMuted,fontSize:13,fontFamily:FONT_UI}}>
                  ✓ No semantic changes detected
                </div>
              )}
            </div>
            
            {/* Footer toolbar */}
            <div style={{display:"flex",alignItems:"center",gap:10,padding:"8px 16px",
                         borderTop:`1px solid ${C.border}`,background:C.headerBg,
                         flexShrink:0}}>
              <Btn onClick={()=>{setMode("edit");setAstMode(false);}} variant="ghost">
                ← Back to edit
              </Btn>
              <span style={{marginLeft:"auto",color:C.textMuted,fontSize:11,fontFamily:FONT_UI}}>
                Showing {ast?.blocks?.length ?? 0} semantic change{(ast?.blocks?.length ?? 0) !== 1 ? "s" : ""}
              </span>
            </div>
          </div>
        ) : (
          <div style={{flex:1,display:"flex",flexDirection:"column",overflow:"hidden"}}>
            <FileLabelBar nameA={nameA} nameB={nameB}/>
            <Stats blocks={blocks}/>
            
            {/* P3.1: Apply changes toolbar */}
            <div style={{display:"flex",alignItems:"center",gap:10,padding:"8px 16px",
                         borderBottom:`1px solid ${C.border}`,background:C.headerBg,
                         flexShrink:0}}>
              <Btn onClick={handleApplyChanges} variant="primary" disabled={loading}>
                📝 Apply A→B
              </Btn>
              <span style={{color:C.textMuted,fontSize:11,fontFamily:FONT_UI}}>
                Merge from {nameA} to {nameB}
              </span>
            </div>
            
            <VirtualList rows={rows} language={detectLanguage(nameB)}/>
          </div>
        )}
      </div>
    </>
  );
}
