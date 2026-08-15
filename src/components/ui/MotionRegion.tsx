"use client";

import { useEffect, useRef, type HTMLAttributes, type PointerEvent } from "react";

const DAMPING = 1;
const RESPONSE_SECONDS = 0.4;
const START_OFFSET_PX = 8;

export type MotionRegionProps = HTMLAttributes<HTMLDivElement>;

export function MotionRegion({ className = "", onPointerDown, ...props }: MotionRegionProps) {
  const elementRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<number | null>(null);

  useEffect(() => {
    const element = elementRef.current;
    const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    if (!element || reduceMotion) return;

    const startedAt = performance.now();
    const angularFrequency = 4 / RESPONSE_SECONDS;
    element.style.transform = `translateY(${START_OFFSET_PX}px)`;

    const step = (now: number) => {
      const elapsed = Math.max(0, (now - startedAt) / 1_000);
      const progress = 1 - (1 + angularFrequency * elapsed) * Math.exp(-angularFrequency * elapsed);
      const remaining = Math.max(0, 1 - progress);
      element.style.transform = `translateY(${START_OFFSET_PX * remaining}px)`;

      if (remaining > 0.001) {
        frameRef.current = window.requestAnimationFrame(step);
      } else {
        element.style.transform = "";
        frameRef.current = null;
      }
    };

    frameRef.current = window.requestAnimationFrame(step);
    return () => {
      if (frameRef.current !== null) window.cancelAnimationFrame(frameRef.current);
    };
  }, []);

  const interrupt = (event: PointerEvent<HTMLDivElement>) => {
    if (frameRef.current !== null) {
      window.cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    }
    if (elementRef.current) {
      elementRef.current.style.transform = "";
    }
    onPointerDown?.(event);
  };

  return (
    <div
      ref={elementRef}
      className={`motion-region ${className}`.trim()}
      data-damping={DAMPING}
      data-response={RESPONSE_SECONDS}
      onPointerDown={interrupt}
      {...props}
    />
  );
}
