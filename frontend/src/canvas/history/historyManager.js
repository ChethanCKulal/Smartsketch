const MAX = 100;

export function createHistory(initialSnapshot) {
  return {
    past: [],
    present: clone(initialSnapshot),
    future: [],
  };
}

export function clone(value) {
  return structuredClone(value);
}

export function pushSnapshot(history, nextPresent) {
  const present = clone(history.present);
  const past = [...history.past, present].slice(-MAX);
  return {
    past,
    present: clone(nextPresent),
    future: [],
  };
}

export function undo(history) {
  if (!history.past.length) return history;
  const previous = history.past[history.past.length - 1];
  return {
    past: history.past.slice(0, -1),
    present: clone(previous),
    future: [clone(history.present), ...history.future].slice(0, MAX),
  };
}

export function redo(history) {
  if (!history.future.length) return history;
  const next = history.future[0];
  return {
    past: [...history.past, clone(history.present)].slice(-MAX),
    present: clone(next),
    future: history.future.slice(1),
  };
}
