export const activate = (element: HTMLElement, value?: string) => {
  if (value !== undefined) {
    fill(element, value);
    return;
  }
  const link = element.closest("a[href]");
  if (link instanceof HTMLAnchorElement) {
    const url = new URL(link.href, location.href);
    if (
      url.origin !== location.origin ||
      !["http:", "https:"].includes(url.protocol) ||
      link.target === "_blank" ||
      link.hasAttribute("download")
    ) {
      throw new Error("This link leaves the app. Open it yourself.");
    }
  }
  element.click();
};

const fill = (element: HTMLElement, value: string) => {
  if (element instanceof HTMLSelectElement) {
    selectOption(element, value);
    return;
  }
  if (
    !(
      element instanceof HTMLInputElement ||
      element instanceof HTMLTextAreaElement
    ) ||
    element.readOnly ||
    element.disabled
  ) {
    throw new Error("This control does not accept text.");
  }
  const prototype =
    element instanceof HTMLInputElement
      ? HTMLInputElement.prototype
      : HTMLTextAreaElement.prototype;
  Object.getOwnPropertyDescriptor(prototype, "value")!.set!.call(
    element,
    value,
  );
  element.dispatchEvent(new Event("input", { bubbles: true }));
  element.dispatchEvent(new Event("change", { bubbles: true }));
};

const selectOption = (element: HTMLSelectElement, value: string) => {
  const matches = [...element.options].filter(
    (option) => option.value === value,
  );
  const option = matches[0];
  if (
    element.disabled ||
    element.multiple ||
    matches.length !== 1 ||
    !option ||
    option.disabled ||
    option.hidden ||
    (option.parentElement instanceof HTMLOptGroupElement &&
      option.parentElement.disabled)
  ) {
    throw new Error("Choose one existing enabled option from this select.");
  }
  Object.getOwnPropertyDescriptor(
    HTMLSelectElement.prototype,
    "value",
  )!.set!.call(element, value);
  element.dispatchEvent(new Event("input", { bubbles: true }));
  element.dispatchEvent(new Event("change", { bubbles: true }));
};

/** Only for app-owned DOM. Framework views should use their stable portal API. */
export const embedView = (view: HTMLElement, outlet: HTMLElement) => {
  if (!view.parentNode || view === outlet || view.contains(outlet)) {
    throw new Error("Choose a separate outlet for a mounted view.");
  }
  const marker = document.createComment("waymode view");
  view.before(marker);
  outlet.append(view);
  return () => {
    if (marker.parentNode) {
      marker.replaceWith(view);
    }
  };
};
