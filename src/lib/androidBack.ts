type BackHandler = () => boolean;

const handlers: BackHandler[] = [];

let authInProgress = false;

export function registerBackHandler(fn: BackHandler): () => void {
  handlers.push(fn);
  return () => {
    const idx = handlers.indexOf(fn);
    if (idx !== -1) handlers.splice(idx, 1);
  };
}

export function handleBack(): boolean {
  for (let i = handlers.length - 1; i >= 0; i--) {
    if (handlers[i]()) return true;
  }
  return false;
}

export function setBackAuthInProgress(v: boolean) {
  authInProgress = v;
}

export function isBackAuthInProgress() {
  return authInProgress;
}
