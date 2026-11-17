/**
 * Affiche un texte juridique écrit simplement : « ## » pour un titre, « - » pour une liste,
 * une ligne vide entre deux paragraphes. Les passages [entre crochets] restant à compléter sont surlignés.
 */
function Inline({ text }) {
  const parts = text.split(/(\[[^\]]+\])/g);
  return parts.map((p, i) =>
    /^\[[^\]]+\]$/.test(p) ? (
      <mark key={i} className="rounded bg-progress-soft px-1 text-progress">
        {p}
      </mark>
    ) : (
      p
    )
  );
}

export default function LegalText({ text }) {
  const blocks = [];
  let list = null;
  let para = [];
  const flushPara = () => {
    if (para.length) blocks.push({ type: 'p', text: para.join(' ') });
    para = [];
  };
  const flushList = () => {
    if (list) blocks.push({ type: 'ul', items: list });
    list = null;
  };
  for (const raw of String(text || '').split('\n')) {
    const line = raw.trim();
    if (!line) {
      flushPara();
      flushList();
    } else if (line.startsWith('## ')) {
      flushPara();
      flushList();
      blocks.push({ type: 'h', text: line.slice(3) });
    } else if (line.startsWith('- ')) {
      flushPara();
      (list ||= []).push(line.slice(2));
    } else {
      flushList();
      para.push(line);
    }
  }
  flushPara();
  flushList();

  return (
    <div className="space-y-4 leading-relaxed text-ink-soft">
      {blocks.map((b, i) => {
        if (b.type === 'h')
          return (
            <h2 key={i} className="pt-4 text-lg font-bold text-ink first:pt-0">
              <Inline text={b.text} />
            </h2>
          );
        if (b.type === 'ul')
          return (
            <ul key={i} className="list-disc space-y-1 pl-6">
              {b.items.map((it, j) => (
                <li key={j}>
                  <Inline text={it} />
                </li>
              ))}
            </ul>
          );
        return (
          <p key={i}>
            <Inline text={b.text} />
          </p>
        );
      })}
    </div>
  );
}
