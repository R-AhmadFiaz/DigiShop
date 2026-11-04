import { useEffect, useState } from "react";
import { api } from "./client";
export function useLoad(url, enabled = true) {
  const [data, setData] = useState(null),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(true),
    [revision, setRevision] = useState(0);
  useEffect(() => {
    if (!enabled) { setData(null); setError(""); setLoading(false); return; }
    const controller = new AbortController();
    setLoading(true);
    setError("");
    setData(null);
    api(url, { signal: controller.signal })
      .then((result) => {
        if (!controller.signal.aborted) setData(result);
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(e.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [url, revision, enabled]);
  return { data, error, loading, reload: () => setRevision((v) => v + 1) };
}
export function useDebounce(value, delay = 250) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}
