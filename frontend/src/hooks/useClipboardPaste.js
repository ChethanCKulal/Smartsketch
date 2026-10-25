import { useEffect, useState } from "react";
import { ACTIONS } from "../canvas/commands/types";
import { isSupportedDiagramXml, parseDrawioXml } from "../import/drawioXml";
import { useDiagramStore } from "../state/diagramStore";

function isTypingTarget(target) {
  if (!target || typeof target !== "object") return false;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target.isContentEditable;
}

/**
 * One paste handler for the whole editor.
 *
 * Supported diagram XML is parsed and offered in a dialog. Anything else keeps
 * the previous behaviour: the editor's own clipboard is pasted as shapes. Text
 * fields are left completely alone.
 */
export function useClipboardPaste() {
  const [request, setRequest] = useState(null);

  useEffect(() => {
    let cancelled = false;

    const onPaste = async (event) => {
      if (isTypingTarget(event.target)) return;
      const text = event.clipboardData?.getData("text/plain") || "";

      if (isSupportedDiagramXml(text)) {
        event.preventDefault();
        setRequest({ status: "parsing" });
        try {
          const parsed = await parseDrawioXml(text);
          if (!cancelled) setRequest({ status: "ready", ...parsed });
        } catch (error) {
          if (!cancelled) {
            setRequest({
              status: "error",
              message: error?.message || "The XML could not be read.",
              details: error?.details || [],
            });
          }
        }
        return;
      }

      const store = useDiagramStore.getState();
      if (store.clipboard.nodes?.length) {
        event.preventDefault();
        store.dispatch({ action: ACTIONS.PASTE, payload: store.clipboard });
      }
    };

    window.addEventListener("paste", onPaste);
    return () => {
      cancelled = true;
      window.removeEventListener("paste", onPaste);
    };
  }, []);

  return { request, close: () => setRequest(null) };
}
