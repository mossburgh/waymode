import {
  useCallback,
  useRef,
  useState,
  type ReactNode,
  type ReactPortal,
  type RefCallback,
} from "react";
import { createPortal } from "react-dom";

type OutletClaim = { element: HTMLElement };

export type LiveView = {
  content: ReactPortal | null;
  outletRef: RefCallback<HTMLElement>;
  root: () => HTMLElement;
};

const assertOutletAvailable = (
  outlet: HTMLElement,
  claim: OutletClaim | null,
  container: HTMLElement | null,
) => {
  if (claim && claim.element !== outlet) {
    throw new Error(
      "A live view supports one active outlet. Release the previous outlet first.",
    );
  }
  if ([...outlet.childNodes].some((child) => child !== container)) {
    throw new Error("A live view outlet must be empty.");
  }
};

/** Mount at the first outlet; retain the same view between outlets. Requires React 19. */
export const useLiveView = (children: ReactNode): LiveView => {
  const containerRef = useRef<HTMLElement | null>(null);
  const claimRef = useRef<OutletClaim | null>(null);
  const [container, setContainer] = useState<HTMLElement | null>(null);

  const outletRef = useCallback<RefCallback<HTMLElement>>((outlet) => {
    if (!outlet) {
      return;
    }
    assertOutletAvailable(outlet, claimRef.current, containerRef.current);
    const claim = { element: outlet };
    claimRef.current = claim;
    if (!containerRef.current) {
      containerRef.current = outlet.ownerDocument.createElement("div");
      setContainer(containerRef.current);
    }
    outlet.append(containerRef.current);
    return () => {
      if (claimRef.current !== claim) {
        return;
      }
      claimRef.current = null;
      containerRef.current?.remove();
    };
  }, []);

  const root = useCallback((): HTMLElement => {
    if (!containerRef.current) {
      throw new Error("The live view has not mounted yet.");
    }
    return containerRef.current;
  }, []);

  return {
    content: container ? createPortal(children, container) : null,
    outletRef,
    root,
  };
};
