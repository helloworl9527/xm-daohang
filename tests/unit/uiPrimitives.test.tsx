import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { MaterialSurface } from "@/components/ui/MaterialSurface";
import { MotionRegion } from "@/components/ui/MotionRegion";
import { Pressable } from "@/components/ui/Pressable";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("shared UI primitives", () => {
  it("starts and clears pointer-down feedback immediately", () => {
    render(<Pressable>Ask</Pressable>);
    const button = screen.getByRole("button", { name: "Ask" });

    fireEvent.pointerDown(button);
    expect(button).toHaveAttribute("data-pressed", "true");

    fireEvent.pointerUp(button);
    expect(button).not.toHaveAttribute("data-pressed");

    fireEvent.pointerDown(button);
    fireEvent.pointerCancel(button);
    expect(button).not.toHaveAttribute("data-pressed");
  });

  it("does not expose pressed feedback for disabled buttons", () => {
    render(<Pressable disabled>Ask</Pressable>);
    const button = screen.getByRole("button", { name: "Ask" });

    fireEvent.pointerDown(button);
    expect(button).toBeDisabled();
    expect(button).not.toHaveAttribute("data-pressed");
  });

  it("clears pressed feedback when disabled changes after pointer down", () => {
    const view = render(<Pressable>Ask</Pressable>);
    const button = screen.getByRole("button", { name: "Ask" });

    fireEvent.pointerDown(button);
    expect(button).toHaveAttribute("data-pressed", "true");

    view.rerender(<Pressable disabled>Ask</Pressable>);
    expect(button).toBeDisabled();
    expect(button).not.toHaveAttribute("data-pressed");
  });

  it("does not schedule motion frames when reduced motion is enabled", () => {
    vi.spyOn(window, "matchMedia").mockImplementation((query) => ({
      matches: query === "(prefers-reduced-motion: reduce)",
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));
    const requestAnimationFrame = vi.spyOn(window, "requestAnimationFrame");

    render(<MotionRegion>Reduced</MotionRegion>);

    expect(requestAnimationFrame).not.toHaveBeenCalled();
  });

  it("exposes critically damped motion and interrupts it on pointer down", () => {
    const cancelAnimationFrame = vi.spyOn(window, "cancelAnimationFrame");
    vi.spyOn(window, "requestAnimationFrame").mockReturnValue(17);

    render(<MotionRegion>Result</MotionRegion>);
    const region = screen.getByText("Result");

    expect(region).toHaveAttribute("data-damping", "1");
    expect(region).toHaveAttribute("data-response", "0.4");

    fireEvent.pointerDown(region);
    expect(cancelAnimationFrame).toHaveBeenCalledWith(17);
    expect(region).toHaveStyle({ transform: "" });
  });

  it("uses a named material surface contract", () => {
    render(<MaterialSurface as="aside" variant="structural">Navigation</MaterialSurface>);

    expect(screen.getByText("Navigation")).toHaveClass(
      "material-surface",
      "material-surface--structural",
    );
  });

  it("defines only the approved palette and all preference fallbacks", () => {
    const css = readFileSync(join(process.cwd(), "src/app/globals.css"), "utf8");
    const colors = ["#F5F7F4", "#FFFFFF", "#17211D", "#087F6C", "#265FAF", "#D15A3C"];

    for (const color of colors) expect(css).toContain(color);
    expect(css).toContain("prefers-reduced-motion: reduce");
    expect(css).toContain("prefers-reduced-transparency: reduce");
    expect(css).toContain("prefers-contrast: more");
    expect(css).toContain(":focus-visible");
  });
});
