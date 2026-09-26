"use client";

import { useEffect, useRef } from "react";

export default function AutoCopyPaste() {
  const clipboardRef = useRef<string>("");

  useEffect(() => {
    // Auto-copy selected text when mouse is released
    const handleMouseUp = () => {
      const selection = window.getSelection();
      const selectedText = selection?.toString().trim();

      if (selectedText && selectedText.length > 0) {
        clipboardRef.current = selectedText;
        navigator.clipboard.writeText(selectedText).catch(() => {
          // Fallback: just store in ref if clipboard API fails
        });
      }
    };

    // Paste on double-click (only in editable elements)
    const handleDoubleClick = async (e: MouseEvent) => {
      const target = e.target as HTMLElement;

      // Check if the target is an editable input, textarea, or contenteditable
      // Exclude input types that don't support text selection (checkbox, radio, etc.)
      const inputType = target.tagName === "INPUT" ? (target as HTMLInputElement).type : "";
      const nonTextInputs = ["checkbox", "radio", "range", "color", "file", "image", "button", "submit", "reset"];
      const isEditable =
        (target.tagName === "INPUT" && !nonTextInputs.includes(inputType)) ||
        target.tagName === "TEXTAREA" ||
        target.isContentEditable;

      if (isEditable && clipboardRef.current) {
        e.preventDefault();

        try {
          // Try to read from clipboard first (in case user copied something externally)
          const clipboardText = await navigator.clipboard.readText();
          const textToPaste = clipboardText || clipboardRef.current;

          if (target.tagName === "INPUT" || target.tagName === "TEXTAREA") {
            const input = target as HTMLInputElement | HTMLTextAreaElement;
            const start = input.selectionStart || 0;
            const end = input.selectionEnd || 0;
            const value = input.value;
            const newValue = value.slice(0, start) + textToPaste + value.slice(end);

            // Use the native setter to update value so React detects the change
            const nativeSetter = Object.getOwnPropertyDescriptor(
              target.tagName === "INPUT" ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype,
              "value"
            )?.set;
            if (nativeSetter) {
              nativeSetter.call(input, newValue);
            } else {
              input.value = newValue;
            }
            input.selectionStart = input.selectionEnd = start + textToPaste.length;

            // Dispatch native input event that React's internals will intercept
            input.dispatchEvent(new Event("input", { bubbles: true }));
          } else if (target.isContentEditable) {
            document.execCommand("insertText", false, textToPaste);
          }
        } catch {
          // Fallback to ref value if clipboard read fails
          if (clipboardRef.current) {
            if (target.tagName === "INPUT" || target.tagName === "TEXTAREA") {
              const input = target as HTMLInputElement | HTMLTextAreaElement;
              const start = input.selectionStart || 0;
              const end = input.selectionEnd || 0;
              const value = input.value;
              const newValue = value.slice(0, start) + clipboardRef.current + value.slice(end);

              const nativeSetter = Object.getOwnPropertyDescriptor(
                target.tagName === "INPUT" ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype,
                "value"
              )?.set;
              if (nativeSetter) {
                nativeSetter.call(input, newValue);
              } else {
                input.value = newValue;
              }
              input.selectionStart = input.selectionEnd = start + clipboardRef.current.length;

              input.dispatchEvent(new Event("input", { bubbles: true }));
            }
          }
        }
      }
    };

    document.addEventListener("mouseup", handleMouseUp);
    document.addEventListener("dblclick", handleDoubleClick);

    return () => {
      document.removeEventListener("mouseup", handleMouseUp);
      document.removeEventListener("dblclick", handleDoubleClick);
    };
  }, []);

  return null;
}
