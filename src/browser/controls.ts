import {
  computeAccessibleDescription,
  computeAccessibleName,
  getRole,
} from "dom-accessibility-api";
import type { Control } from "../contract.js";

export const selectors =
  'button,a[href],input,textarea,select,[role="button"],[role="checkbox"],[role="switch"],[role="radio"],[role="tab"],[role="menuitem"],[role="menuitemradio"],[role="menuitemcheckbox"],[role="option"]';
const privateInput =
  'input[type="password"],input[type="hidden"],input[type="file"],[autocomplete~="one-time-code" i],[autocomplete*="cc-" i],[autocomplete*="password" i]';
const ignored = '[data-waymode-ignore],[hidden],[inert],[aria-hidden="true"]';

const visuallyHidden = (element: HTMLElement) => {
  const style = getComputedStyle(element);
  return (
    style.display === "none" ||
    style.visibility === "hidden" ||
    style.opacity === "0"
  );
};

const directlyVisible = (element: HTMLElement, exclude?: string) => {
  if (
    !element.isConnected ||
    element.closest(ignored) ||
    element.matches(privateInput) ||
    Boolean(exclude && element.closest(exclude))
  ) {
    return false;
  }
  if (!element.getClientRects().length) {
    return false;
  }
  let parent: HTMLElement | null = element;
  while (parent) {
    if (visuallyHidden(parent)) {
      return false;
    }
    parent = parent.parentElement;
  }
  return true;
};

const allowsLabelInteraction = (
  element: HTMLElement,
  exclude?: string,
): element is HTMLInputElement =>
  element instanceof HTMLInputElement &&
  ["checkbox", "radio"].includes(element.type) &&
  element.isConnected &&
  !element.matches(privateInput) &&
  !element.closest("[data-waymode-ignore],[inert]") &&
  !element.parentElement?.closest(ignored) &&
  !(exclude && element.closest(exclude));

export const interactionTarget = (
  element: HTMLElement,
  exclude?: string,
  scope?: HTMLElement,
): HTMLElement | undefined => {
  if (directlyVisible(element, exclude)) {
    return element;
  }
  if (!allowsLabelInteraction(element, exclude)) {
    return undefined;
  }
  return [...(element.labels ?? [])].find(
    (label) =>
      (!scope || scope.contains(label)) && directlyVisible(label, exclude),
  );
};

export const visible = (
  element: HTMLElement,
  exclude?: string,
  scope?: HTMLElement,
) => interactionTarget(element, exclude, scope) !== undefined;

const editable = (element: HTMLElement) => {
  return (
    element.matches(
      'select:not([multiple]),textarea,input:not([type]),input[type="text"],input[type="search"],input[type="email"],input[type="url"],input[type="tel"],input[type="number"]',
    ) && !element.matches("[readonly]")
  );
};

const valueFields =
  'input,textarea,select,[contenteditable],[role="textbox"],[role="combobox"],[role="listbox"],[role="slider"],[role="spinbutton"]';
const references = (element: Element, attribute: string): Element[] => {
  const root = element.getRootNode() as Document | ShadowRoot;
  return (element.getAttribute(attribute) ?? "")
    .split(/\s+/)
    .filter(Boolean)
    .map((id) => root.getElementById(id))
    .filter((node) => node !== null);
};

const hasPrivateSource = (
  source: Element,
  owner: Element,
  seen = new Set<Element>(),
): boolean => {
  if (seen.has(source)) {
    return false;
  }
  seen.add(source);
  if (
    source.closest("[data-waymode-ignore]") ||
    source.querySelector("[data-waymode-ignore]")
  ) {
    return true;
  }
  if (source !== owner && source.matches(valueFields)) {
    return true;
  }
  if (
    [...source.querySelectorAll(valueFields)].some((field) => field !== owner)
  ) {
    return true;
  }
  return [
    source,
    ...source.querySelectorAll("[aria-labelledby],[aria-owns]"),
  ].some((node) =>
    [
      ...references(node, "aria-labelledby"),
      ...references(node, "aria-owns"),
    ].some(
      (reference) =>
        reference.matches(valueFields) ||
        hasPrivateSource(reference, owner, seen),
    ),
  );
};

// Use static label text when accessible-name rules would include private content.
const staticText = (node: Node, seen = new Set<Node>()): string => {
  if (seen.has(node)) {
    return "";
  }
  seen.add(node);
  if (!(node instanceof Element)) {
    return node.textContent ?? "";
  }
  if (
    node.matches(`${valueFields},script,style`) ||
    node.closest("[data-waymode-ignore]")
  ) {
    return "";
  }
  return staticElementText(node, seen);
};

const staticElementText = (node: Element, seen: Set<Node>): string => {
  const labelledBy = references(node, "aria-labelledby");
  if (labelledBy.length) {
    return labelledBy.map((label) => staticText(label, seen)).join(" ");
  }
  const label = node.getAttribute("aria-label")?.trim();
  if (label) {
    return label;
  }
  if (node.tagName === "IMG") {
    return node.getAttribute("alt") ?? "";
  }
  return [...node.childNodes, ...references(node, "aria-owns")]
    .map((child) => staticText(child, seen))
    .join(" ");
};

const safeDescription = (element: HTMLElement) => {
  const sources = references(element, "aria-describedby");
  if (
    sources.some(
      (source) =>
        source.matches(valueFields) || hasPrivateSource(source, element),
    )
  ) {
    return sources
      .map((source) => staticText(source))
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
  }
  return computeAccessibleDescription(element);
};

const safeName = (element: HTMLElement) => {
  const labelledBy = references(element, "aria-labelledby");
  const labels = [...((element as HTMLInputElement).labels ?? [])];
  const explicit = element.getAttribute("aria-label")?.trim() ?? "";
  const sources = nameSources(element, labelledBy, labels, explicit);
  const hasPrivateContent = sources.some(
    (source) =>
      (labelledBy.length > 0 && source.matches(valueFields)) ||
      hasPrivateSource(source, element),
  );
  const name = hasPrivateContent
    ? sources
        .map((source) => staticText(source))
        .join(" ")
        .replace(/\s+/g, " ")
        .trim()
    : computeAccessibleName(element, { hidden: !directlyVisible(element) });
  return name || explicit;
};

const nameSources = (
  element: HTMLElement,
  labelledBy: Element[],
  labels: Element[],
  explicit: string,
) => {
  if (labelledBy.length) {
    return labelledBy;
  }
  return !explicit && labels.length ? labels : [element];
};

const checkedState = (element: HTMLElement, checked: string | null) => {
  if (
    element instanceof HTMLInputElement &&
    ["checkbox", "radio"].includes(element.type)
  ) {
    return { checked: element.checked };
  }
  return checked !== null ? { checked: checked === "true" } : {};
};

export const describe = (element: HTMLElement, id: string): Control => {
  const checked = element.getAttribute("aria-checked");
  const expanded = element.getAttribute("aria-expanded");
  return {
    id,
    name: safeName(element).slice(0, 300),
    description: safeDescription(element).slice(0, 500),
    role: getRole(element) ?? element.tagName.toLowerCase(),
    disabled:
      element.matches(":disabled") ||
      Boolean(element.closest('[aria-disabled="true"]')),
    editable: editable(element),
    ...checkedState(element, checked),
    ...(expanded !== null ? { expanded: expanded === "true" } : {}),
  };
};

/** Accessible view names give navigation context without copying page contents. */
export const describeContext = (root: HTMLElement) => {
  const parent = root.parentElement?.closest<HTMLElement>(
    "[aria-label],[aria-labelledby]",
  );
  return {
    view: root.matches("[aria-label],[aria-labelledby]")
      ? safeName(root).slice(0, 300)
      : "",
    location: parent ? safeName(parent).slice(0, 300) : "",
  };
};

export const signature = (element: HTMLElement) => {
  const value =
    element instanceof HTMLInputElement ||
    element instanceof HTMLTextAreaElement ||
    element instanceof HTMLSelectElement
      ? element.value
      : undefined;
  return JSON.stringify([
    describe(element, ""),
    value,
    element.closest("a[href]")?.getAttribute("href"),
    element.getAttribute("type"),
    element.getAttribute("formaction"),
    element instanceof HTMLSelectElement
      ? [...element.options].map((option) => [
          option.value,
          option.label,
          option.disabled,
          option.parentElement instanceof HTMLOptGroupElement &&
            option.parentElement.disabled,
          option.hidden,
        ])
      : undefined,
  ]);
};
