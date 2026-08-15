"use client";

import { useEffect, useState, type ButtonHTMLAttributes, type PointerEvent } from "react";

export type PressableProps = ButtonHTMLAttributes<HTMLButtonElement>;

export function Pressable({ className = "", disabled = false, onPointerDown, onPointerUp, onPointerCancel, onPointerLeave, ...props }: PressableProps) {
  const [pressed, setPressed] = useState(false);

  useEffect(() => {
    if (disabled) setPressed(false);
  }, [disabled]);

  const startPress = (event: PointerEvent<HTMLButtonElement>) => {
    if (!disabled) setPressed(true);
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
      data-pressed={pressed && !disabled ? "true" : undefined}
      disabled={disabled}
      onPointerCancel={endPress(onPointerCancel)}
      onPointerDown={startPress}
      onPointerLeave={endPress(onPointerLeave)}
      onPointerUp={endPress(onPointerUp)}
      {...props}
    />
  );
}
