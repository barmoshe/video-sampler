import { useSyncExternalStore } from 'react'

export interface Store<T> {
  get(): T
  set(patch: Partial<T> | ((s: T) => Partial<T>)): void
  subscribe(l: () => void): () => void
}

export function createStore<T extends object>(init: T): Store<T> {
  let s = init
  const ls = new Set<() => void>()
  return {
    get: () => s,
    set: (patch) => { s = { ...s, ...(typeof patch === 'function' ? patch(s) : patch) }; for (const l of ls) l() },
    subscribe: (l) => { ls.add(l); return () => { ls.delete(l) } },
  }
}

/** Subscribe to one slice. The selector must return something already in the state (no new objects). */
export function useStore<T extends object, U>(store: Store<T>, sel: (s: T) => U): U {
  return useSyncExternalStore(store.subscribe, () => sel(store.get()))
}
