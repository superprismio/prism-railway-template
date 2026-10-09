/** Serialize prompts per conversation without storing a rejecting promise. */
export function createPromptQueue(): (key: string, run: () => Promise<void>) => Promise<void> {
  const tails = new Map<string, Promise<void>>();
  return (key, run) => {
    const result = (tails.get(key) ?? Promise.resolve()).then(run);
    const tail = result.then(() => undefined, () => undefined);
    tails.set(key, tail);
    void tail.then(() => {
      if (tails.get(key) === tail) tails.delete(key);
    });
    return result;
  };
}
