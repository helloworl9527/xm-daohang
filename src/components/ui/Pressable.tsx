"use client";

import { useState, type ButtonHTMLAttributes, type PointerEvent } from "react";

export type PressableProps = ButtonHTMLAttributes<HTMLButtonElement>;

export function Pressable({ className = "", onPointerDown, onPointerUp, onPointerCancel, onPointerLeave, ...props }: PressableProps) {
  const [pressed, setPressed] = useState(false);

  const startPress = (event: PointerEvent<HTMLButtonElement>) => {
    setPressed(true);
    onPointerDown?.(event);
  };

  const endPress = (handler?: (event: PointerEvent<HTMLButtonElement>) => void) =>
    (event: PointerEvent<HTMLButtonElement>) => {
      setPressed(false);
      handler?.(event);
    };

  return (
    <button
      className={`pressable ${className}`.trim()}
      data-pressed={pressed ? "true" : undefined}
      onPointerCancel={endPress(onPointerCancel)}
      onPointerDown={startPress}
      onPointerLeave={endPress(onPointerLeave)}
      onPointerUp={endPress(onPointerUp)}
      {...props}
    />
  );
}
