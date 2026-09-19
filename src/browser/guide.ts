import type { Control } from "../contract.js";

/** Presentation only. The runtime rechecks the target before invoking its handler. */
export const createCursorGuide =
  (cursor: HTMLElement) =>
  async (_control: Control, signal: AbortSignal, target: HTMLElement) => {
    signal.throwIfAborted();
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) {
      return;
    }
    target.scrollIntoView({ block: "nearest", behavior: "instant" });
    const bounds = target.getBoundingClientRect();
    const point = `translate(${bounds.left + bounds.width / 2}px, ${bounds.top + bounds.height / 2}px)`;
    cursor.hidden = false;
    const animation = cursor.animate(
      [
        {
          transform:
            cursor.style.transform ||
            `translate(${bounds.right + 30}px, ${bounds.bottom + 30}px)`,
          opacity: 0,
        },
        { offset: 0.25, opacity: 1 },
        { offset: 0.8, transform: point, opacity: 1 },
        { transform: `${point} scale(.9)`, opacity: 1 },
      ],
      { duration: 550, easing: "ease-out" },
    );
    const cancel = () => animation.cancel();
    signal.addEventListener("abort", cancel, { once: true });
    try {
      await animation.finished;
      signal.throwIfAborted();
      cursor.style.transform = point;
    } finally {
      signal.removeEventListener("abort", cancel);
      cursor.hidden = true;
    }
  };
