export function $<T extends Element>(sel: string, type: new () => T): T {
  const el = document.querySelector(sel);
  if (!(el instanceof type)) throw new Error(`missing element ${sel} or not of the expected type`);
  return el;
}
