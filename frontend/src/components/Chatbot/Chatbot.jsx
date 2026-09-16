import { useState } from "react";
import { parseChatCommand } from "./parser";
import { ACTIONS } from "../../canvas/commands/types";
import { enforceFamily } from "../../schema/canonical";
import { useDiagramStore } from "../../state/diagramStore";

export default function Chatbot() {
  const [text, setText] = useState("");
  const log = useDiagramStore((s) => s.chatbotLog);
  const pushChat = useDiagramStore((s) => s.pushChat);
  const dispatch = useDiagramStore((s) => s.dispatch);
  const undo = useDiagramStore((s) => s.undo);
  const redo = useDiagramStore((s) => s.redo);
  const selectedIds = useDiagramStore((s) => s.selectedIds);
  const diagram = useDiagramStore((s) => s.diagram);

  const run = (raw) => {
    const parsed = parseChatCommand(raw);
    pushChat({ role: "user", text: raw });
    if (!parsed.ok) {
      pushChat({ role: "bot", text: parsed.error });
      return;
    }
    if (parsed.help) {
      pushChat({ role: "bot", text: parsed.message });
      return;
    }
    if (parsed.meta?.history === "undo") {
      undo();
      pushChat({ role: "bot", text: "Undid last action." });
      return;
    }
    if (parsed.meta?.history === "redo") {
      redo();
      pushChat({ role: "bot", text: "Redid last action." });
      return;
    }
    const command = parsed.command;
    // Chatbot-provided types join the active family's vocabulary, same as
    // mouse and properties-panel edits.
    if (command.payload?.type && diagram.diagram_type) {
      command.payload.type = enforceFamily(command.payload.type, diagram.diagram_type);
    }
    if (command.action === ACTIONS.DELETE_BY_TYPE) {
      command.payload.type = enforceFamily(command.payload.type, diagram.diagram_type);
    }
    if (command.action === ACTIONS.GROUP) command.payload.ids = selectedIds;
    if (command.action === ACTIONS.UNGROUP) command.payload.ids = selectedIds;
    if (command.action === ACTIONS.MOVE_NODE && command.payload.relativeTo) {
      const other = diagram.nodes.find(
        (n) => n.label.toLowerCase() === String(command.payload.relativeTo).toLowerCase()
      );
      const self = diagram.nodes.find(
        (n) => n.label.toLowerCase() === String(command.payload.label).toLowerCase()
      );
      if (other && self) {
        const dir = command.payload.direction;
        const position = { ...self.position };
        if (dir === "below") {
          position.x = other.position.x;
          position.y = other.position.y + other.size.height + 60;
        } else if (dir === "above") {
          position.x = other.position.x;
          position.y = other.position.y - self.size.height - 60;
        }
        command.payload.position = position;
      }
    }
    const result = dispatch(command);
    pushChat({ role: "bot", text: result.ok ? result.message || "Done." : result.error });
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", minHeight: 0, flex: 1 }}>
      <div className="chat-log">
        {log.length === 0 ? (
          <div className="chat-bubble bot">
            Rule-based assistant. Try: Add Student entity, Connect Student to Course, Move Student left.
          </div>
        ) : (
          log.map((m, i) => (
            <div key={i} className={`chat-bubble ${m.role}`}>
              {m.text}
            </div>
          ))
        )}
      </div>
      <form
        className="chat-input"
        onSubmit={(e) => {
          e.preventDefault();
          if (!text.trim()) return;
          run(text);
          setText("");
        }}
      >
        <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Type a command…" />
        <button type="submit">Send</button>
      </form>
    </div>
  );
}
