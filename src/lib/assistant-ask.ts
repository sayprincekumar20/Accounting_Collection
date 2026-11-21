/** Opens the AI assistant and asks it this question (the assistant listens for this event). */
export function askAssistant(text: string) {
  window.dispatchEvent(new CustomEvent("rgf-assistant-ask", { detail: { text } }));
}
