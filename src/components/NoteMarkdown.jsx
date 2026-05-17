import ReactMarkdown from "react-markdown";
import remarkGfm    from "remark-gfm";
import remarkBreaks from "remark-breaks";

const PLUGINS = [remarkGfm, remarkBreaks];

const COMPONENTS = {
  p:          ({ children }) => <p style={{ margin:"0 0 .45rem", fontSize:".82rem", color:"#5c6470", fontFamily:"inherit", lineHeight:1.55 }}>{children}</p>,
  a:          ({ href, children }) => <a href={href} target="_blank" rel="noopener noreferrer" style={{ color:"#2563eb" }}>{children}</a>,
  ul:         ({ children }) => <ul style={{ margin:"0 0 .45rem", paddingLeft:"1.25rem", fontSize:".82rem", color:"#5c6470", fontFamily:"inherit", lineHeight:1.55 }}>{children}</ul>,
  ol:         ({ children }) => <ol style={{ margin:"0 0 .45rem", paddingLeft:"1.25rem", fontSize:".82rem", color:"#5c6470", fontFamily:"inherit", lineHeight:1.55 }}>{children}</ol>,
  li:         ({ children }) => <li style={{ marginBottom:".15rem" }}>{children}</li>,
  h1:         ({ children }) => <h1 style={{ fontSize:"1rem",   fontWeight:600, color:"#0e1014", margin:"0 0 .3rem", fontFamily:"inherit" }}>{children}</h1>,
  h2:         ({ children }) => <h2 style={{ fontSize:".9rem",  fontWeight:600, color:"#0e1014", margin:"0 0 .3rem", fontFamily:"inherit" }}>{children}</h2>,
  h3:         ({ children }) => <h3 style={{ fontSize:".82rem", fontWeight:600, color:"#0b3d6b", margin:"0 0 .3rem", fontFamily:"inherit" }}>{children}</h3>,
  strong:     ({ children }) => <strong style={{ color:"#0e1014", fontWeight:600 }}>{children}</strong>,
  em:         ({ children }) => <em style={{ color:"#9ba1ac" }}>{children}</em>,
  code:       ({ children }) => <code style={{ background:"#f0f4f8", color:"#0b3d6b", padding:"1px 5px", borderRadius:3, fontSize:".78rem", fontFamily:"monospace" }}>{children}</code>,
  blockquote: ({ children }) => <blockquote style={{ margin:"0 0 .45rem", paddingLeft:".75rem", borderLeft:"3px solid #2e5070", color:"#5c6470", fontStyle:"italic" }}>{children}</blockquote>,
  hr:         () => <hr style={{ border:"none", borderTop:"1px solid #1e3a52", margin:".6rem 0" }} />,
};

export default function NoteMarkdown({ children }) {
  if (!children) return null;
  return <ReactMarkdown remarkPlugins={PLUGINS} components={COMPONENTS}>{children}</ReactMarkdown>;
}
