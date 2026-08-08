import { createElement, type HTMLAttributes } from "react";

type MaterialElement = "aside" | "div" | "footer" | "header" | "nav" | "section";
type MaterialVariant = "floating" | "structural" | "toast";

export interface MaterialSurfaceProps extends HTMLAttributes<HTMLElement> {
  as?: MaterialElement;
  variant?: MaterialVariant;
}

export function MaterialSurface({
  as = "div",
  className = "",
  variant = "floating",
  ...props
}: MaterialSurfaceProps) {
  return createElement(as, {
    className: `material-surface material-surface--${variant} ${className}`.trim(),
    ...props,
  });
}
