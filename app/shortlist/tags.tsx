"use client";
// Client / mandate tags on one shortlisted paper: add (with suggestions from tags already used) or remove.
import { useOptimistic, useState, useTransition } from "react";
import { addShortlistTag, removeShortlistTag } from "../actions";

export function TagEditor({ paperId, tags, known }: { paperId: number; tags: string[]; known: string[] }) {
  const [list, change] = useOptimistic(tags, (cur: string[], a: { add?: string; remove?: string }) =>
    a.add ? (cur.some((t) => t.toLowerCase() === a.add!.toLowerCase()) ? cur : [...cur, a.add]) : cur.filter((t) => t.toLowerCase() !== a.remove!.toLowerCase()),
  );
  const [text, setText] = useState("");
  const [, start] = useTransition();
  const add = () => {
    const tag = text.replace(/\s+/g, " ").trim();
    if (!tag) return;
    setText("");
    start(async () => {
      change({ add: tag });
      await addShortlistTag(paperId, tag);
    });
  };
  return (
    <div className="tags-edit">
      <span className="label" style={{ margin: 0 }}>Client / mandate</span>
      {list.map((t) => (
        <span key={t} className="tagchip">
          <a href={`/shortlist?tag=${encodeURIComponent(t)}`}>{t}</a>
          <button type="button" aria-label={`Remove tag ${t}`} onClick={() => start(async () => { change({ remove: t }); await removeShortlistTag(paperId, t); })}>×</button>
        </span>
      ))}
      <form
        className="tag-add"
        onSubmit={(e) => {
          e.preventDefault();
          add();
        }}
      >
        <input list={`known-tags`} value={text} onChange={(e) => setText(e.target.value)} placeholder="Add a client or mandate…" aria-label="Add a client or mandate tag" maxLength={60} />
        <button type="submit">Tag</button>
      </form>
      <datalist id="known-tags">
        {known.map((k) => <option key={k} value={k} />)}
      </datalist>
    </div>
  );
}
