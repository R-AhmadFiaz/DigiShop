import { useEffect, useRef, useState } from "react";
import { api } from "../api/client";
import { Notice, PageTitle } from "../components/Common";

export default function VoiceStock() {
  const [text, setText] = useState("");
  const [messages, setMessages] = useState([]);
  const [recording, setRecording] = useState(false);
  const [starting, setStarting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const recorder = useRef(null), stream = useRef(null), timer = useRef(null);
  const mounted = useRef(true), locked = useRef(false), abortRecording = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      clearTimeout(timer.current);
      if (recorder.current?.state === "recording") recorder.current.stop();
      stream.current?.getTracks().forEach(track => track.stop());
    };
  }, []);
  async function ask(body) {
    if (locked.current) return;
    locked.current = true;
    setBusy(true);
    setError("");
    try {
      const result = await api("/ai/query", { method: "POST", body, timeout: 120000 });
      if (mounted.current) {
        setMessages(current => [...current.slice(-19), { question: result.question, answer: result.answer }]);
        if (!(body instanceof FormData)) setText("");
      }
    } catch (failure) {
      if (mounted.current) setError(failure.message);
    } finally {
      locked.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  function submit(event) {
    event.preventDefault();
    if (!text.trim() || recording || starting) return;
    ask({ text: text.trim() });
  }
  async function start() {
    if (locked.current || starting || recording) return;
    setError("");
    if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
      setError("Microphone recording is unavailable. You can type your question instead.");
      return;
    }
    setStarting(true);
    try {
      const media = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (!mounted.current) { media.getTracks().forEach(track => track.stop()); return; }
      stream.current = media;
      abortRecording.current = false;
      const mime = ["audio/webm", "audio/mp4"].find(type => MediaRecorder.isTypeSupported(type));
      const active = new MediaRecorder(media, mime ? { mimeType: mime } : undefined);
      recorder.current = active;
      const chunks = [];
      active.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
      active.onstop = () => {
        clearTimeout(timer.current);
        media.getTracks().forEach(track => track.stop());
        if (!mounted.current) return;
        setRecording(false);
        if (abortRecording.current) return;
        const type = active.mimeType || "audio/webm";
        const audio = new File(chunks, "question." + (type.includes("mp4") ? "m4a" : "webm"), { type });
        if (!audio.size || audio.size > 10 * 1024 * 1024) {
          setError("Recording is empty or too large. Please record again or type your question.");
          return;
        }
        const body = new FormData();
        body.append("audio", audio);
        ask(body);
      };
      active.onerror = () => {
        abortRecording.current = true;
        clearTimeout(timer.current);
        if (active.state === "recording") active.stop();
        media.getTracks().forEach(track => track.stop());
        if (mounted.current) { setRecording(false); setError("Recording failed. You can type your question instead."); }
      };
      active.start();
      setRecording(true);
      timer.current = setTimeout(() => { if (active.state === "recording") active.stop(); }, 45000);
    } catch {
      stream.current?.getTracks().forEach(track => track.stop());
      if (mounted.current) setError("Microphone access was not available. You can type your question instead.");
    } finally { if (mounted.current) setStarting(false); }
  }
  return (
    <>
      <PageTitle title="AI Assistant" />
      <section className="panel assistant fill-panel">
        <p className="text-body-secondary">Ask questions about your shop using text or voice.</p>
        <div className="assistant-conversation fill-scroll" role="log" aria-label="Assistant conversation" aria-live="polite">
          {!messages.length && <p className="text-body-secondary small">Ask about product stock, selling prices or a customer balance.</p>}
          {messages.map((message, index) => (
            <div className="assistant-exchange" key={index}>
              <p className="assistant-question"><strong>You:</strong> {message.question}</p>
              <p className="assistant-answer"><strong>Assistant:</strong> {message.answer}</p>
            </div>
          ))}
        </div>
        <Notice error={error} />
        <form onSubmit={submit}>
          <fieldset disabled={busy || recording || starting}>
            <div className="d-flex gap-2">
              <input className="form-control" aria-label="Ask about your shop" placeholder="Ask about your shop..." maxLength={1000} value={text} onChange={event => setText(event.target.value)} />
              <button className="btn btn-primary" type="submit" disabled={!text.trim() || busy}>Send</button>
            </div>
          </fieldset>
        </form>
        <div className="d-flex gap-3 align-items-center mt-3">
          <button className={recording ? "btn btn-outline-danger" : "btn btn-outline-primary"} disabled={busy || starting} onClick={recording ? () => recorder.current?.stop() : start}>
            <svg aria-hidden="true" width="16" height="18" viewBox="0 0 16 20" fill="none" stroke="currentColor" strokeWidth="1.5" className="me-2"><rect x="5" y="1" width="6" height="11" rx="3"/><path d="M2 8v2a6 6 0 0 0 12 0V8M8 16v3M4 19h8"/></svg>
            {recording ? "Stop and send" : "Speak"}
          </button>
          <span className="small text-body-secondary" role="status">{busy ? "Processing..." : starting ? "Opening microphone..." : recording ? "Listening... (up to 45 seconds)" : "Ready"}</span>
        </div>
      </section>
    </>
  );
}
