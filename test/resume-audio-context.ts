import { userEvent } from "vitest/browser";

export async function resumeAudioContext(context: AudioContext): Promise<void> {
  const button = document.createElement("button");
  button.textContent = "Start audio";
  document.body.append(button);

  const resumed = new Promise<void>((resolve, reject) => {
    button.addEventListener(
      "click",
      () => {
        void context.resume().then(resolve, reject);
      },
      { once: true }
    );
  });

  try {
    await userEvent.click(button);
    await resumed;
  } finally {
    button.remove();
  }
}
