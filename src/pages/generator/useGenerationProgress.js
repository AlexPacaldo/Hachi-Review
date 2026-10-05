import { useCallback, useEffect, useRef, useState } from "react";
import { holdBusyWork } from "../../utils/busyWork.js";

// The running state a generation has: how long it has been going, the steps it has
// been through, and whether it should be treated as in flight.
//
// The progress list is a report of what has been attempted, not a promise about what
// is happening inside the endpoint. The request is a single JSON response, so there is
// nothing to stream, and inventing a percentage bar would be fiction. A list of steps
// that really did happen is honest; a bar that fills at a fixed rate is not.
export function useGenerationProgress() {
  const [isRunning, setIsRunning] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [steps, setSteps] = useState([]);
  const runningRef = useRef(false);

  useEffect(() => {
    if (!isRunning) {
      setElapsed(0);
      return undefined;
    }

    const timer = window.setInterval(() => setElapsed((value) => value + 1), 1000);
    return () => window.clearInterval(timer);
  }, [isRunning]);

  // A running generation holds the update reload. Everything else on the page is
  // autosaved into the draft and survives a reload, but the request in flight does
  // not: it would be cancelled part-way and the provider quota it spent would be gone
  // with nothing to show for it.
  useEffect(() => {
    if (!isRunning) return undefined;
    return holdBusyWork("generation");
  }, [isRunning]);

  const recordStep = useCallback((step) => {
    setSteps((current) => (current.includes(step) ? current : [...current, step]));
  }, []);

  const begin = useCallback((firstStep) => {
    runningRef.current = true;
    setSteps(firstStep ? [firstStep] : []);
    setElapsed(0);
    setIsRunning(true);
  }, []);

  const end = useCallback(() => {
    runningRef.current = false;
    setIsRunning(false);
  }, []);

  const reset = useCallback(() => {
    runningRef.current = false;
    setSteps([]);
    setElapsed(0);
    setIsRunning(false);
  }, []);

  return { isRunning, elapsed, steps, recordStep, begin, end, reset };
}

// Progress for the two requests that are not a generation: adding questions to a
// reviewer that already exists, and importing a paper. Same shape, no shared state,
// because a person cannot run both at once and giving them one counter would make the
// elapsed time lie.
export function useTaskProgress() {
  const [isRunning, setIsRunning] = useState(false);
  const runningRef = useRef(false);

  useEffect(() => {
    if (!isRunning) return undefined;
    return holdBusyWork("generation");
  }, [isRunning]);

  const begin = useCallback(() => {
    runningRef.current = true;
    setIsRunning(true);
  }, []);

  const end = useCallback(() => {
    runningRef.current = false;
    setIsRunning(false);
  }, []);

  return { isRunning, begin, end };
}