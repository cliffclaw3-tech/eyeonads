"use client";

import { useEffect, useRef, useState } from "react";

type Result = { isFinal: boolean; 0: { transcript: string } };
type Recognition = {
  lang: string; continuous: boolean; interimResults: boolean;
  onresult: ((event: { resultIndex: number; results: ArrayLike<Result> }) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void; stop(): void; abort(): void;
};
type SpeechWindow = Window & {
  SpeechRecognition?: new () => Recognition;
  webkitSpeechRecognition?: new () => Recognition;
};

/** Dictation only: never starts a scan or submits the surrounding form. */
export function VoiceInput({ onTranscript, disabled = false, label = "Speak instead of typing" }: {
  onTranscript: (text: string) => void; disabled?: boolean; label?: string;
}) {
  const [listening, setListening] = useState(false);
  const [message, setMessage] = useState("");
  const recognition = useRef<Recognition | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const callback = useRef(onTranscript);
  useEffect(() => { callback.current = onTranscript; }, [onTranscript]);
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
    const current = recognition.current;
    recognition.current = null;
    if (current) {
      current.onresult = null; current.onerror = null; current.onend = null;
      current.abort();
    }
  }, []);
  useEffect(() => { if (disabled) recognition.current?.stop(); }, [disabled]);

  function toggle() {
    if (recognition.current) { recognition.current.stop(); return; }
    const browser = window as SpeechWindow;
    const Constructor = browser.SpeechRecognition || browser.webkitSpeechRecognition;
    if (!window.isSecureContext || !Constructor) {
      setMessage("Voice input is unavailable in this browser. Use your keyboard’s microphone, or type your text.");
      return;
    }
    const current = new Constructor();
    recognition.current = current;
    current.lang = "en-US";
    current.continuous = false;
    current.interimResults = true;
    let receivedText = false;
    let failed = false;
    const delivered = new Set<number>();
    current.onresult = (event) => {
      if (recognition.current !== current) return;
      let preview = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        const text = result[0].transcript.trim();
        if (result.isFinal && text && !delivered.has(i)) {
          delivered.add(i); receivedText = true; callback.current(text);
        } else if (!result.isFinal) preview += text + " ";
      }
      setMessage(preview.trim() || "Text added. Review it before scanning.");
    };
    current.onerror = ({ error }) => {
      failed = true;
      setMessage(error === "not-allowed" || error === "service-not-allowed"
        ? "Microphone access was blocked. Allow microphone access in your browser and try again."
        : error === "audio-capture"
          ? "No microphone was found. Connect a microphone and try again."
          : error === "no-speech"
            ? "No speech was heard. Tap the microphone and try again."
            : "Voice input could not finish. Check your connection and try again, or type your text.");
    };
    current.onend = () => {
      if (recognition.current !== current) return;
      recognition.current = null;
      if (timer.current) clearTimeout(timer.current);
      timer.current = null;
      setListening(false);
      if (!failed) setMessage(receivedText ? "Text added. Review it before scanning." : "No speech was heard. Tap the microphone to try again.");
    };
    try {
      current.start();
      setListening(true);
      setMessage("Listening… Speak, then pause. You can also tap Stop.");
      timer.current = setTimeout(() => current.stop(), 60_000);
    } catch {
      recognition.current = null;
      setListening(false);
      setMessage("Voice input could not start. Try again or use your keyboard’s microphone.");
    }
  }

  return (
    <div className="mt-2 mb-3 text-left">
      <button type="button" onClick={toggle} disabled={disabled} aria-pressed={listening}
        className="min-h-11 rounded-lg border border-white/20 px-4 py-2 text-sm text-white hover:bg-white/10 disabled:opacity-50">
        {listening ? "■ Stop listening" : `🎙 ${label}`}
      </button>
      <p role="status" aria-live="polite" className="mt-2 text-xs text-white/70">{message || "Tap to dictate. Review the text before scanning."}</p>
      <p className="mt-1 text-xs text-white/50">Your browser’s speech service processes your voice.</p>
    </div>
  );
}
