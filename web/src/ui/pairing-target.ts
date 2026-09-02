// One of the two modules in web/src/ permitted to touch the DOM (see
// dom-target.ts for the other). Kept separate because this view renders
// before any conversation UI exists: the app has no credential yet, and
// every API call dom-target.ts could make would 401. Plain DOM calls, no
// framework, no innerHTML with interpolated content.

export type PairingSubmitResult = { ok: true } | { ok: false; message: string };

export interface PairingTargetDeps {
  onSubmit(pastedText: string): PairingSubmitResult;
}

export interface PairingTarget {
  showMessage(message: string | null): void;
  destroy(): void;
}

const EMPTY_INPUT_MESSAGE = "Paste the pairing URL or token from your Mac.";
const SUBMIT_THREW_MESSAGE =
  "Pairing failed. Check the URL or token and try again.";

export function createPairingTarget(
  root: HTMLElement,
  deps: PairingTargetDeps
): PairingTarget {
  const doc = root.ownerDocument;

  const section = doc.createElement("section");
  section.setAttribute("data-testid", "pairing");

  const heading = doc.createElement("h1");
  heading.textContent = "Pair this app with your Mac";

  const instructions = doc.createElement("p");
  instructions.setAttribute("data-testid", "pairing-instructions");
  instructions.textContent =
    "On your Mac, run: bun run pair --show-url — then copy the URL it " +
    "prints and paste it below. A bare token works too.";

  const input = doc.createElement("input");
  input.setAttribute("type", "text");
  input.setAttribute("data-testid", "pairing-input");
  input.setAttribute("autocapitalize", "off");
  input.setAttribute("autocorrect", "off");
  input.setAttribute("autocomplete", "off");
  input.setAttribute("spellcheck", "false");

  const submitBtn = doc.createElement("button");
  submitBtn.setAttribute("data-testid", "pairing-submit");
  submitBtn.textContent = "Pair";

  const message = doc.createElement("p");
  message.setAttribute("data-testid", "pairing-message");

  submitBtn.addEventListener("click", () => {
    const trimmedValue = input.value.trim();
    if (trimmedValue === "") {
      message.textContent = EMPTY_INPUT_MESSAGE;
      return;
    }

    let result: PairingSubmitResult;
    try {
      result = deps.onSubmit(trimmedValue);
    } catch {
      message.textContent = SUBMIT_THREW_MESSAGE;
      return;
    }

    if (result.ok) {
      input.value = "";
      message.textContent = "";
    } else {
      message.textContent = result.message;
    }
  });

  section.appendChild(heading);
  section.appendChild(instructions);
  section.appendChild(input);
  section.appendChild(submitBtn);
  section.appendChild(message);

  root.replaceChildren(section);

  return {
    showMessage(text: string | null): void {
      message.textContent = text ?? "";
    },
    destroy(): void {
      section.remove();
    },
  };
}
