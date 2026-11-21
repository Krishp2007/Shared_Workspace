const COLORS = [
  '#e57373', '#64b5f6', '#81c784', '#ffd54f',
  '#ba68c8', '#4dd0e1', '#ff8a65', '#a1a1aa',
];

const USER_NAMES = ['Alex', 'Blake', 'Casey', 'Drew', 'Ellis', 'Finn', 'Gray', 'Harper'];

function colorFor(clientId) {
  let hash = 0;
  for (let i = 0; i < clientId.length; i++) {
    hash = clientId.charCodeAt(i) + ((hash << 5) - hash);
  }
  return COLORS[Math.abs(hash) % COLORS.length];
}

function nameFor(clientId) {
  let hash = 0;
  for (let i = 0; i < clientId.length; i++) {
    hash = clientId.charCodeAt(i) + ((hash << 5) - hash);
  }
  return USER_NAMES[Math.abs(hash) % USER_NAMES.length];
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
        >
          {nameFor(id)} · {info.position}
        </span>
      ))}
    </div>
  );
}
