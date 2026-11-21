/**
 * CursorLayer
 *
 * Shows coloured name badges for every remote cursor.
 * `cursors` is a Map<clientId, { position, name? }>
 *
 * We render badges in a row at the top of the editor rather than
 * trying to position them inside the textarea (which would need a
 * mirror DOM).  Good enough for the demo; can be upgraded later.
 */

const COLORS = [
  '#e57373', '#64b5f6', '#81c784', '#ffd54f',
  '#ba68c8', '#4dd0e1', '#ff8a65', '#a1a1aa',
];

function colorFor(clientId) {
  let hash = 0;
  for (let i = 0; i < clientId.length; i++) {
    hash = clientId.charCodeAt(i) + ((hash << 5) - hash);
  }
  return COLORS[Math.abs(hash) % COLORS.length];
}

export default function CursorLayer({ cursors, myClientId }) {
  const others = [...cursors.entries()].filter(([id]) => id !== myClientId);

  if (others.length === 0) return null;

  return (
    <div className="cursor-layer">
      {others.map(([id, info]) => (
        <span
          key={id}
          className="cursor-badge"
          style={{ background: colorFor(id) }}
          title={`cursor position: ${info.position}`}
        >
          {info.name || id.slice(0, 6)}
        </span>
      ))}
    </div>
  );
}
